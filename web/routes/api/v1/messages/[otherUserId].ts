import { define, isUserVerified } from "../../../../utils.ts";
import { getStreetHousesStatus } from "../../../../db/streets.ts";
import {
  getConversation,
  markConversationRead,
  MAX_MESSAGE_CONTENT_LENGTH,
  sendMessage,
} from "../../../../db/messages.ts";
import { resolvePostContext } from "../../../../db/message_context.ts";
import {
  findSessionUserById,
  findUserLoginForDisplay,
} from "../../../../db/users.ts";
import { containsBlockedContent } from "../../../../moderation/blocklist.ts";
import { sendMessageNotificationEmail } from "../../../../email/brevo.ts";
import { createCooldown } from "../../../../utils/rate_limit.ts";
import { toThreadMessageDto } from "./dto.ts";

function parseId(raw: string | undefined | null): number | null {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Même raisonnement que le cooldown de publication (cf.
 * routes/api/v1/posts/index.ts) : l'API mobile n'est protégée que par un
 * jeton Bearer, plus exposée au spam qu'un formulaire web classique — cf.
 * `_doc/architecture-mobile.md` « rate limiting sur les actions
 * sensibles ». */
const MESSAGE_COOLDOWN_MS = 3000;
const messageCooldown = createCooldown(MESSAGE_COOLDOWN_MS);

/**
 * GET/POST /api/v1/messages/:otherUserId — conversation avec un voisin (cf.
 * routes/messages.tsx, vue « thread ») : lire les messages échangés (marque
 * comme lus au passage, même règle que le web) et en envoyer un nouveau.
 * Même contexte de demande (cf. db/message_context.ts) que le web quand la
 * conversation démarre depuis un bouton « Message privé » sur une demande.
 */
export const handler = define.handlers({
  async GET(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return Response.json(
        { error: "Authentification requise." },
        { status: 401 },
      );
    }

    const otherUserId = parseId(ctx.params.otherUserId);
    if (!otherUserId || otherUserId === user.id) {
      return Response.json(
        { error: "Identifiant invalide." },
        { status: 400 },
      );
    }

    const streetStatus = await getStreetHousesStatus(user.street.id);
    if (!streetStatus.isAwake) {
      return Response.json(
        { error: "Votre rue n'est pas encore allumée." },
        { status: 403 },
      );
    }

    // `findUserLoginForDisplay` plutôt que `findSessionUserById` : une
    // conversation déjà existante avec un habitant qui a depuis supprimé
    // son compte doit rester consultable, sous son pseudonyme anonymisé
    // (cf. db/users.ts, même raisonnement que routes/messages.tsx).
    const otherUser = await findUserLoginForDisplay(otherUserId);
    if (!otherUser || otherUser.streetId !== user.street.id) {
      return Response.json(
        { error: "Conversation introuvable." },
        { status: 404 },
      );
    }

    const rawPostId = parseId(ctx.url.searchParams.get("postId"));
    const postContext = await resolvePostContext(
      rawPostId,
      user.street.id,
      user.id,
      otherUserId,
    );
    const messages = await getConversation(user.id, otherUserId);
    // Ouvrir la conversation vaut lecture (cf. backlog « pastille sur
    // l'enveloppe du menu ») : elle ne doit disparaître que lorsque les
    // messages sont vraiment lus, pas juste listés dans l'inbox.
    await markConversationRead(user.id, otherUserId);

    return Response.json({
      otherUserId,
      otherUserLogin: otherUser.login,
      otherUserDeleted: otherUser.isDeleted,
      postContext,
      messages: messages.map(toThreadMessageDto),
    });
  },

  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return Response.json(
        { error: "Authentification requise." },
        { status: 401 },
      );
    }

    const otherUserId = parseId(ctx.params.otherUserId);
    if (!otherUserId || otherUserId === user.id) {
      return Response.json(
        { error: "Identifiant invalide." },
        { status: 400 },
      );
    }

    const streetStatus = await getStreetHousesStatus(user.street.id);
    if (!streetStatus.isAwake) {
      return Response.json(
        { error: "Votre rue n'est pas encore allumée." },
        { status: 403 },
      );
    }
    if (!isUserVerified(user)) {
      return Response.json(
        {
          error:
            "Votre compte doit d'abord être validé par un voisin avant de pouvoir envoyer un message.",
        },
        { status: 403 },
      );
    }
    if (messageCooldown.isActive(user.id)) {
      return Response.json(
        { error: "Merci de patienter avant d'envoyer un autre message." },
        { status: 429 },
      );
    }

    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return Response.json(
        { error: "Corps JSON invalide." },
        { status: 400 },
      );
    }
    const parsed = body as Record<string, unknown> | null;
    const content = String(parsed?.content ?? "").trim().slice(
      0,
      MAX_MESSAGE_CONTENT_LENGTH,
    );
    const rawPostId = parseId(String(parsed?.postId ?? ""));

    if (!content) {
      return Response.json(
        { error: "Écrivez votre message avant de l'envoyer." },
        { status: 400 },
      );
    }
    if (containsBlockedContent(content)) {
      return Response.json(
        {
          error:
            "Merci de reformuler : ce message contient des termes non autorisés.",
        },
        { status: 422 },
      );
    }

    // `findSessionUserById` (pas `findUserLoginForDisplay`) : on n'écrit
    // jamais un nouveau message à un compte supprimé, contrairement à la
    // lecture d'une conversation déjà existante ci-dessus (même
    // distinction que routes/messages.tsx).
    const otherUser = await findSessionUserById(otherUserId);
    if (!otherUser || otherUser.street.id !== user.street.id) {
      return Response.json(
        { error: "Destinataire introuvable." },
        { status: 404 },
      );
    }

    // Revalidé ici plutôt que de faire confiance au `postId` brut envoyé
    // par le client : un id forgé (inexistant, d'une autre rue, sans
    // rapport avec les deux participants) ne doit pas être stocké sans
    // contrôle (cf. routes/messages.tsx, même précaution).
    const postContext = await resolvePostContext(
      rawPostId,
      user.street.id,
      user.id,
      otherUserId,
    );

    messageCooldown.record(user.id);
    const created = await sendMessage({
      fromUserId: user.id,
      toUserId: otherUserId,
      postId: postContext?.id ?? null,
      content,
    });

    // Tolérant à l'échec : le message est déjà enregistré, un souci
    // d'e-mail ne doit pas remonter comme une erreur à l'utilisateur (cf.
    // routes/messages.tsx, même logique).
    try {
      await sendMessageNotificationEmail({
        to: otherUser.email,
        recipientLogin: otherUser.login,
        senderLogin: user.login,
        threadUrl: `${ctx.url.origin}/messages?with=${user.id}`,
      });
    } catch (error) {
      console.error(
        "Échec de la notification de message (API mobile) :",
        error,
      );
    }

    return Response.json({
      message: toThreadMessageDto({
        id: created.id,
        content: created.content,
        createdAt: created.createdAt,
        fromViewer: true,
      }),
      postContext,
    }, { status: 201 });
  },
});
