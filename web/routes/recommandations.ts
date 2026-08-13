import { define } from "../utils.ts";

/**
 * Route historique : le type "recommandation" a été supprimé (cf. revue
 * « simplifier la navigation ») — "cherche" en tient désormais lieu, et
 * toute demande peut recevoir des réponses publiques (cf. db/comments.ts,
 * routes/reponses.ts). Ne fait plus que rediriger vers /fil, `q`/`page`
 * préservés, pour ne pas casser les liens/favoris déjà partagés vers
 * /recommandations.
 */
export const handler = define.handlers({
  GET(ctx) {
    const params = new URLSearchParams(ctx.url.search);
    params.delete("type");
    const qs = params.toString();
    return ctx.redirect(qs ? `/fil?${qs}` : "/fil");
  },
});
