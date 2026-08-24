import { define } from "../../../../utils.ts";
import {
  getStreetHousesStatus,
  STREET_AWAKENING_THRESHOLD,
} from "../../../../db/streets.ts";

/**
 * GET /api/v1/streets/status — statut d'éveil de la rue de l'habitant
 * connecté (cf. `_doc/architecture-mobile.md`, endpoint prévu dès la
 * fondation mais pas encore écrit). Réutilise `getStreetHousesStatus` telle
 * quelle (même logique que le sous-titre de web/routes/inviter.tsx et
 * le garde-fou de web/routes/fil.tsx) : `housesCount`, combien il en
 * manque, et si la rue est déjà allumée.
 */
export const handler = define.handlers({
  async GET(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return Response.json(
        { error: "Authentification requise." },
        { status: 401 },
      );
    }

    const status = await getStreetHousesStatus(user.street.id);

    return Response.json({
      streetName: user.street.name,
      cityId: user.street.city.id,
      cityName: user.street.city.name,
      threshold: STREET_AWAKENING_THRESHOLD,
      housesCount: status.housesCount,
      remaining: status.remaining,
      isAmbassadorSlot: status.isAmbassadorSlot,
      isAwake: status.isAwake,
    });
  },
});
