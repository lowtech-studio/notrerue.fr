import { define } from "../utils.ts";
import { vouchForNeighbor } from "../db/vouches.ts";

/**
 * Un habitant déjà vérifié confirme qu'un voisin de sa rue y habite bien
 * (cf. backlog « prouver que les voisins habitent bien dans la même rue »,
 * db/vouches.ts) — un clic depuis la page d'accueil (cf. routes/index.tsx),
 * revient toujours à `/`. Toutes les conditions (même rue, voucher déjà
 * vérifié, vouchee pas déjà vérifié...) sont revérifiées par
 * `vouchForNeighbor` ; l'UI ne propose ce bouton que là où c'est légitime,
 * mais un `voucheeId` forgé ne doit rien valider à tort.
 */
export const handler = define.handlers({
  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.redirect("/connexion");

    const form = await ctx.req.formData();
    const voucheeId = Number(form.get("voucheeId"));
    if (Number.isInteger(voucheeId) && voucheeId > 0) {
      await vouchForNeighbor(user.id, voucheeId);
    }

    return ctx.redirect("/");
  },
});
