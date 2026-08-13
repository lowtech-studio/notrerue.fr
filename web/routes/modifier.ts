import { define } from "../utils.ts";
import {
  getPostSummary,
  MAX_POST_CONTENT_LENGTH,
  updatePostContent,
} from "../db/posts.ts";
import { containsBlockedContent } from "../moderation/blocklist.ts";
import { resolvePostBackPath, withQueryParam } from "../utils/validation.ts";

/**
 * Corrige le contenu d'une demande (cf. backlog « corriger des erreurs de
 * saisie ») et revient à sa page d'origine, filtre et page préservés via le
 * champ cachée `back` plutôt qu'une redirection en clair (même logique que
 * /taps et /reponses). Le type et la durée ne se modifient pas ici — seul le
 * texte, la coquille à corriger.
 */
export const handler = define.handlers({
  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.redirect("/connexion");

    const form = await ctx.req.formData();
    const postId = Number(form.get("postId"));
    const content = String(form.get("content") ?? "").trim().slice(
      0,
      MAX_POST_CONTENT_LENGTH,
    );
    const rawBack = String(form.get("back") ?? "");

    // Pas encore de `summary` ici pour calculer le fallback : à défaut, /fil
    // (le cas le plus courant) — remplacé ci-dessous dès que possible.
    if (!Number.isInteger(postId) || postId <= 0 || !content) {
      return ctx.redirect(resolvePostBackPath(rawBack, "/fil"));
    }

    // Revalidé ici plutôt que de faire confiance à l'UI (qui ne montre ce
    // formulaire que sur ses propres demandes) : un postId forgé ne doit
    // rien modifier chez un autre habitant (cf. /taps, même précaution).
    const summary = await getPostSummary(postId);
    const back = resolvePostBackPath(rawBack, "/fil");

    if (!summary || summary.authorId !== user.id) {
      return ctx.redirect(back);
    }
    if (containsBlockedContent(content)) {
      // `edit_error=1` plutôt qu'une redirection silencieuse : sans lui,
      // l'utilisateur croit sa correction enregistrée alors qu'elle est
      // ignorée (cf. revue). Lu par /fil (les deux onglets) pour afficher
      // un message d'erreur.
      return ctx.redirect(withQueryParam(back, "edit_error", "1"));
    }

    await updatePostContent(postId, user.id, content);

    return ctx.redirect(back);
  },
});
