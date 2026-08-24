import { define, isUserVerified } from "../../../../../utils.ts";
import { getPostSummary } from "../../../../../db/posts.ts";
import {
  createComment,
  MAX_COMMENT_CONTENT_LENGTH,
} from "../../../../../db/comments.ts";
import { containsBlockedContent } from "../../../../../moderation/blocklist.ts";
import { getStreetHousesStatus } from "../../../../../db/streets.ts";
import { findSessionUserById } from "../../../../../db/users.ts";
import { sendReplyNotificationEmail } from "../../../../../email/brevo.ts";
import { createCooldown } from "../../../../../utils/rate_limit.ts";
import type { CommentDto } from "../dto.ts";

function parsePostId(raw: string | undefined): number | null {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/** Même raisonnement que le cooldown de publication (cf. posts/index.ts). */
const COMMENT_COOLDOWN_MS = 3000;
const commentCooldown = createCooldown(COMMENT_COOLDOWN_MS);

/**
 * POST /api/v1/posts/:id/comments — publie une réponse publique à une
 * demande, quel que soit son type (cf. routes/reponses.ts, mêmes règles).
 * Contrairement au tap, une réponse ici reste visible aux prochains
 * habitants qui posent la même question (cf. db/comments.ts).
 */
export const handler = define.handlers({
  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return Response.json(
        { error: "Authentification requise." },
        { status: 401 },
      );
    }

    const postId = parsePostId(ctx.params.id);
    if (!postId) {
      return Response.json({ error: "Identifiant invalide." }, {
        status: 400,
      });
    }

    // Même porte que /fil et routes/reponses.ts : un postId forgé et
    // deviné ne doit pas permettre de répondre depuis une rue endormie.
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
            "Votre compte doit être vérifié par un voisin avant de répondre.",
        },
        { status: 403 },
      );
    }
    if (commentCooldown.isActive(user.id)) {
      return Response.json(
        { error: "Merci de patienter avant de répondre à nouveau." },
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
    const content = String(
      (body as Record<string, unknown> | null)?.content ?? "",
    )
      .trim().slice(0, MAX_COMMENT_CONTENT_LENGTH);
    if (!content) {
      return Response.json(
        { error: "Le contenu ne peut pas être vide." },
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

    // On ne répond qu'à une demande de sa propre rue — vérifié côté serveur
    // même si l'UI ne montre ce formulaire que là où c'est légitime (même
    // précaution que routes/reponses.ts).
    const summary = await getPostSummary(postId);
    if (!summary || summary.streetId !== user.street.id) {
      return Response.json({ error: "Demande introuvable." }, {
        status: 404,
      });
    }

    commentCooldown.record(user.id);
    const created = await createComment({ userId: user.id, postId, content });

    // Notifie l'auteur (sauf s'il se répond à lui-même) — tolérant à
    // l'échec, la réponse est déjà enregistrée.
    if (summary.authorId !== user.id) {
      const author = await findSessionUserById(summary.authorId);
      if (author) {
        try {
          await sendReplyNotificationEmail({
            to: author.email,
            recipientLogin: author.login,
            replierLogin: user.login,
            postContent: summary.content,
            replyContent: content,
            threadUrl: `${ctx.url.origin}/fil`,
          });
        } catch (error) {
          console.error(
            "Échec de la notification de réponse (API mobile) :",
            error,
          );
        }
      }
    }

    const dto: CommentDto = {
      id: created.id,
      content: created.content,
      createdAt: created.createdAt.toISOString(),
      authorId: user.id,
      authorLogin: user.login,
    };
    return Response.json({ comment: dto }, { status: 201 });
  },
});
