import { define, isUserVerified } from "../utils.ts";
import { getPostSummary, MAX_SEARCH_LENGTH } from "../db/posts.ts";
import { createComment, MAX_COMMENT_CONTENT_LENGTH } from "../db/comments.ts";
import { containsBlockedContent } from "../moderation/blocklist.ts";
import { getStreetHousesStatus } from "../db/streets.ts";
import { withQueryParam } from "../utils/validation.ts";
import { findSessionUserById } from "../db/users.ts";
import { sendReplyNotificationEmail } from "../email/brevo.ts";

/**
 * Publie une réponse publique à une demande, quel que soit son type (cf.
 * revue « supprimer la recommandation, ajouter les commentaires partout ») —
 * en plus du tap, pas à sa place : contrairement au tap, une réponse ici
 * reste visible aux prochains habitants qui posent la même question (cf.
 * db/comments.ts). Revient à /fil, page/recherche/filtre préservés via des
 * champs cachés du formulaire plutôt qu'une redirection en clair (même
 * logique que /taps).
 */
export const handler = define.handlers({
  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.redirect("/connexion");

    // Même porte que /fil (cf. backlog « une seule action possible tant que
    // la rue n'est pas allumée ») : sans ce contrôle, un postId forgé et
    // deviné (ids séquentiels) permettait de publier une réponse publique
    // depuis une rue encore endormie.
    const streetStatus = await getStreetHousesStatus(user.street.id);
    if (!streetStatus.isAwake) return ctx.redirect("/");

    const form = await ctx.req.formData();
    const postId = Number(form.get("postId"));
    const content = String(form.get("content") ?? "").trim().slice(
      0,
      MAX_COMMENT_CONTENT_LENGTH,
    );
    const rawType = String(form.get("type") ?? "");
    const rawPage = String(form.get("page") ?? "");
    const rawSearch = String(form.get("q") ?? "").trim().slice(
      0,
      MAX_SEARCH_LENGTH,
    );

    const params = new URLSearchParams();
    if (rawType) params.set("type", rawType);
    if (rawPage) params.set("page", rawPage);
    if (rawSearch) params.set("q", rawSearch);
    const back = params.size > 0 ? `/fil?${params}` : "/fil";

    // Cf. db/vouches.ts : répondre publiquement est réservé aux comptes
    // vérifiés par un voisin — l'UI masque déjà ce formulaire, ce garde-fou
    // couvre une page restée ouverte pendant la validation ou un POST forgé.
    if (!isUserVerified(user)) {
      return ctx.redirect(withQueryParam(back, "verif_error", "1"));
    }

    if (!Number.isInteger(postId) || postId <= 0 || !content) {
      return ctx.redirect(back);
    }
    if (containsBlockedContent(content)) {
      // `reponse_error=1` plutôt qu'une redirection silencieuse : sans lui,
      // la réponse tapée disparaît sans aucune explication (cf. revue). Lu
      // par /fil pour afficher un message d'erreur.
      return ctx.redirect(withQueryParam(back, "reponse_error", "1"));
    }

    // On ne répond qu'à une demande visible par l'utilisateur (même rue) —
    // vérifié côté serveur même si l'UI ne montre ce formulaire que là où
    // c'est légitime (postId manipulable dans le formulaire, cf. /taps pour
    // la même précaution).
    const summary = await getPostSummary(postId);
    if (!summary || summary.streetId !== user.street.id) {
      return ctx.redirect(back);
    }

    await createComment({ userId: user.id, postId, content });

    // Notifie l'auteur de la demande (sauf s'il se répond à lui-même, cf.
    // backlog notification) — tolérant à l'échec : la réponse est déjà
    // enregistrée, un souci d'e-mail ne doit pas remonter comme une erreur à
    // l'utilisateur.
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
          console.error("Échec de la notification de réponse :", error);
        }
      }
    }

    return ctx.redirect(back);
  },
});
