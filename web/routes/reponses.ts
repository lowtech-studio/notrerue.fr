import { define } from "../utils.ts";
import { getPostSummary, MAX_SEARCH_LENGTH } from "../db/posts.ts";
import { createComment, MAX_COMMENT_CONTENT_LENGTH } from "../db/comments.ts";
import { containsBlockedContent } from "../moderation/blocklist.ts";
import { getStreetHousesStatus } from "../db/streets.ts";
import { withQueryParam } from "../utils/validation.ts";

/**
 * Publie une réponse publique à une demande de recommandation et revient à
 * /recommandations, page préservée via un champ caché du formulaire plutôt
 * qu'une redirection en clair (même logique que /taps).
 *
 * Réservé aux demandes de type "recommandation" : c'est le seul type qui se
 * répond publiquement (cf. schema.ts) — les trois autres types du fil se
 * répondent par tap + message privé, pas par commentaire.
 */
export const handler = define.handlers({
  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.redirect("/connexion");

    // Même porte que /recommandations (cf. backlog « une seule action
    // possible tant que la rue n'est pas allumée ») : sans ce contrôle, un
    // postId de recommandation forgé et deviné (ids séquentiels) permettait
    // de publier une réponse publique depuis une rue encore endormie.
    const streetStatus = await getStreetHousesStatus(user.street.id);
    if (!streetStatus.isAwake) return ctx.redirect("/");

    const form = await ctx.req.formData();
    const postId = Number(form.get("postId"));
    const content = String(form.get("content") ?? "").trim().slice(
      0,
      MAX_COMMENT_CONTENT_LENGTH,
    );
    const rawPage = String(form.get("page") ?? "");
    const rawSearch = String(form.get("q") ?? "").trim().slice(
      0,
      MAX_SEARCH_LENGTH,
    );

    const params = new URLSearchParams();
    if (rawPage) params.set("page", rawPage);
    if (rawSearch) params.set("q", rawSearch);
    const back = params.size > 0
      ? `/recommandations?${params}`
      : "/recommandations";

    if (!Number.isInteger(postId) || postId <= 0 || !content) {
      return ctx.redirect(back);
    }
    if (containsBlockedContent(content)) {
      // `reponse_error=1` plutôt qu'une redirection silencieuse : sans lui,
      // la réponse tapée disparaît sans aucune explication (cf. revue). Lu
      // par /recommandations pour afficher un message d'erreur.
      return ctx.redirect(withQueryParam(back, "reponse_error", "1"));
    }

    // On ne répond qu'à une demande de recommandation visible par
    // l'utilisateur (même ville) — vérifié côté serveur même si l'UI ne
    // montre ce formulaire que là où c'est légitime (postId manipulable
    // dans le formulaire, cf. /taps pour la même précaution sur la rue).
    const summary = await getPostSummary(postId);
    if (
      !summary || summary.type !== "recommandation" ||
      summary.cityId !== user.street.city.id
    ) {
      return ctx.redirect(back);
    }

    await createComment({ userId: user.id, postId, content });

    return ctx.redirect(back);
  },
});
