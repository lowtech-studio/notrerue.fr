import { define, isUserVerified } from "../utils.ts";
import { getPostSummary, isPostType, MAX_SEARCH_LENGTH } from "../db/posts.ts";
import { toggleTap } from "../db/taps.ts";
import { findSessionUserById } from "../db/users.ts";
import { sendTapNotificationEmail } from "../email/brevo.ts";
import { withQueryParam } from "../utils/validation.ts";

/**
 * Bascule un tap sur une demande (« J'ai » / « Intéressé » / 👍 selon le
 * type — cf. backlog) et revient au fil, filtre et page préservés via des
 * champs cachés du formulaire plutôt qu'une redirection en clair (pas
 * d'open-redirect possible).
 */
export const handler = define.handlers({
  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.redirect("/connexion");

    const form = await ctx.req.formData();
    const postId = Number(form.get("postId"));
    const rawType = String(form.get("type") ?? "");
    const rawPage = String(form.get("page") ?? "");
    const rawSearch = String(form.get("q") ?? "").trim().slice(
      0,
      MAX_SEARCH_LENGTH,
    );

    const params = new URLSearchParams();
    if (isPostType(rawType)) params.set("type", rawType);
    if (rawPage) params.set("page", rawPage);
    if (rawSearch) params.set("q", rawSearch);
    const backToFil = params.size > 0 ? `/fil?${params}` : "/fil";

    // Cf. db/vouches.ts : tapper est réservé aux comptes vérifiés par un
    // voisin — l'UI masque déjà le bouton, ce garde-fou couvre une page
    // restée ouverte pendant la validation ou un POST forgé.
    if (!isUserVerified(user)) {
      return ctx.redirect(withQueryParam(backToFil, "verif_error", "1"));
    }

    if (!Number.isInteger(postId) || postId <= 0) {
      return ctx.redirect(backToFil);
    }

    // On ne tape que sur une demande de sa propre rue (jamais visible
    // ailleurs de toute façon, mais vérifié aussi côté serveur), ni sur sa
    // propre demande (l'UI masque déjà le bouton, mais rien n'empêchait un
    // POST forgé — cf. revue) ; `getPostSummary` ignore aussi les demandes
    // supprimées.
    const summary = await getPostSummary(postId);
    if (!summary || summary.streetId !== user.street.id) {
      return ctx.redirect(backToFil);
    }
    if (summary.authorId === user.id) {
      return ctx.redirect(backToFil);
    }

    const tapped = await toggleTap(user.id, postId);

    // Notifie l'auteur seulement à la création du tap (pas au retrait) —
    // cf. backlog « être notifié immédiatement quand quelqu'un répond à ma
    // demande ». Tolérant à l'échec : le tap est déjà acquis en base, un
    // souci d'e-mail ne doit pas remonter comme une erreur à l'utilisateur.
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
          console.error("Échec de la notification de tap :", error);
        }
      }
    }

    return ctx.redirect(backToFil);
  },
});
