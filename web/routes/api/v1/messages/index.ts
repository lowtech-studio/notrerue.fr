import { define } from "../../../../utils.ts";
import { getStreetHousesStatus } from "../../../../db/streets.ts";
import { listConversations } from "../../../../db/messages.ts";
import { toConversationDto } from "./dto.ts";

/**
 * GET /api/v1/messages — boîte de réception de l'habitant connecté (cf.
 * routes/messages.tsx, vue « inbox »), pour l'app mobile (backlog mobile
 * « toutes les fonctionnalités de la page /messages »). Réutilise
 * `listConversations` telle quelle : une ligne par interlocuteur, la
 * conversation la plus récente d'abord.
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

    const streetStatus = await getStreetHousesStatus(user.street.id);
    if (!streetStatus.isAwake) {
      // Même garde que /messages côté web (redirection vers `/`) : aucune
      // conversation n'a pu démarrer avant l'éveil de la rue.
      return Response.json({ isStreetAwake: false, conversations: [] });
    }

    const conversations = await listConversations(user.id);
    return Response.json({
      isStreetAwake: true,
      conversations: conversations.map(toConversationDto),
    });
  },
});
