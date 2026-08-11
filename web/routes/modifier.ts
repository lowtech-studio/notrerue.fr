import { define } from "../utils.ts";
import {
  getPostSummary,
  MAX_POST_CONTENT_LENGTH,
  postListPath,
  updatePostContent,
} from "../db/posts.ts";
import { containsBlockedContent } from "../moderation/blocklist.ts";

/**
 * Chemin de retour : seuls /fil et /recommandations affichent des demandes
 * éditables, donc seuls ces deux préfixes sont acceptés — un `back` forgé
 * pointant ailleurs (voire vers un autre domaine, `//evil.example`) retombe
 * sur la page où vit réellement la demande plutôt que d'être suivi tel
 * quel (open redirect).
 */
function resolveBack(raw: string, fallback: string): string {
  return raw.startsWith("/fil") || raw.startsWith("/recommandations")
    ? raw
    : fallback;
}

/**
 * Corrige le contenu d'une demande ou d'une recommandation (cf. backlog
 * « corriger des erreurs de saisie ») et revient à sa page d'origine, filtre
 * et page préservés via le champ cachée `back` plutôt qu'une redirection en
 * clair (même logique que /taps et /reponses). Le type et la durée ne se
 * modifient pas ici — seul le texte, la coquille à corriger.
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
      return ctx.redirect(resolveBack(rawBack, "/fil"));
    }

    // Revalidé ici plutôt que de faire confiance à l'UI (qui ne montre ce
    // formulaire que sur ses propres demandes) : un postId forgé ne doit
    // rien modifier chez un autre habitant (cf. /taps, même précaution).
    const summary = await getPostSummary(postId);
    const back = resolveBack(rawBack, postListPath(summary?.type ?? "cherche"));

    if (!summary || summary.authorId !== user.id) {
      return ctx.redirect(back);
    }
    if (containsBlockedContent(content)) {
      return ctx.redirect(back);
    }

    await updatePostContent(postId, user.id, content);

    return ctx.redirect(back);
  },
});
