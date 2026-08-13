import { define } from "../utils.ts";
import { getPostSummary, softDeletePost } from "../db/posts.ts";
import { resolvePostBackPath } from "../utils/validation.ts";

/**
 * Supprime (soft delete) une demande et revient à sa page d'origine (cf.
 * backlog « corriger des erreurs de saisie » — supprimer en est l'autre
 * moitié). Un clic suffit pour supprimer, mais l'action n'est proposée
 * qu'après un premier clic sur « Supprimer » qui déplie une confirmation
 * (cf. routes/fil.tsx, bascule case à cocher + `:has()`, sans JS) — pas un
 * simple bouton qu'un clic accidentel déclenche.
 */
export const handler = define.handlers({
  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.redirect("/connexion");

    const form = await ctx.req.formData();
    const postId = Number(form.get("postId"));
    const rawBack = String(form.get("back") ?? "");

    // Revalidé ici plutôt que de faire confiance à l'UI, même précaution que
    // /modifier et /taps : un postId forgé ne doit rien supprimer chez un
    // autre habitant.
    const summary = Number.isInteger(postId) && postId > 0
      ? await getPostSummary(postId)
      : null;
    const back = resolvePostBackPath(rawBack, "/fil");

    if (!summary || summary.authorId !== user.id) {
      return ctx.redirect(back);
    }

    await softDeletePost(postId, user.id);

    return ctx.redirect(back);
  },
});
