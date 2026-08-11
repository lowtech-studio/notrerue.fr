import { define } from "../utils.ts";
import { isPostType } from "../db/posts.ts";
import { getPostStreetId, toggleTap } from "../db/taps.ts";

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

    const params = new URLSearchParams();
    if (isPostType(rawType)) params.set("type", rawType);
    if (rawPage) params.set("page", rawPage);
    const backToFil = params.size > 0 ? `/fil?${params}` : "/fil";

    if (!Number.isInteger(postId) || postId <= 0) {
      return ctx.redirect(backToFil);
    }

    // On ne tape que sur une demande de sa propre rue (jamais visible
    // ailleurs de toute façon, mais vérifié aussi côté serveur).
    const streetId = await getPostStreetId(postId);
    if (streetId !== user.street.id) {
      return ctx.redirect(backToFil);
    }

    await toggleTap(user.id, postId);

    return ctx.redirect(backToFil);
  },
});
