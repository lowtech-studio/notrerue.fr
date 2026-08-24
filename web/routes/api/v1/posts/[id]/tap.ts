import { define, isUserVerified } from "../../../../../utils.ts";
import { getPostSummary } from "../../../../../db/posts.ts";
import { countTapsByPost, toggleTap } from "../../../../../db/taps.ts";
import { findSessionUserById } from "../../../../../db/users.ts";
import { sendTapNotificationEmail } from "../../../../../email/brevo.ts";

function parsePostId(raw: string | undefined): number | null {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * POST /api/v1/posts/:id/tap — bascule un tap sur une demande (« J'ai » /
 * « Intéressé » / 👍 selon le type — cf. routes/taps.ts, mêmes règles :
 * réservé aux comptes vérifiés, jamais sur sa propre demande ni celle d'une
 * autre rue). Renvoie l'état à jour (`tapped`/`tapCount`) plutôt qu'une
 * redirection : l'app met à jour l'écran sans refaire un aller-retour
 * complet sur `GET /posts`.
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

    if (!isUserVerified(user)) {
      return Response.json(
        {
          error:
            "Votre compte doit être vérifié par un voisin avant de répondre.",
        },
        { status: 403 },
      );
    }

    const summary = await getPostSummary(postId);
    if (!summary || summary.streetId !== user.street.id) {
      return Response.json({ error: "Demande introuvable." }, {
        status: 404,
      });
    }
    if (summary.authorId === user.id) {
      return Response.json(
        { error: "Vous ne pouvez pas répondre à votre propre demande." },
        { status: 403 },
      );
    }

    const tapped = await toggleTap(user.id, postId);

    // Notifie l'auteur seulement à la création du tap, jamais au retrait
    // (cf. routes/taps.ts) — tolérant à l'échec, le tap est déjà acquis.
    if (tapped) {
      const author = await findSessionUserById(summary.authorId);
      if (author) {
        try {
          await sendTapNotificationEmail({
            to: author.email,
            recipientLogin: author.login,
            tapperLogin: user.login,
            postType: summary.type,
            postContent: summary.content,
            threadUrl:
              `${ctx.url.origin}/messages?with=${user.id}&postId=${postId}`,
          });
        } catch (error) {
          console.error(
            "Échec de la notification de tap (API mobile) :",
            error,
          );
        }
      }
    }

    const counts = await countTapsByPost([postId]);
    return Response.json({ tapped, tapCount: counts.get(postId) ?? 0 });
  },
});
