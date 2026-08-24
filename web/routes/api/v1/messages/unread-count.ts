import { define } from "../../../../utils.ts";
import { hasUnreadMessages } from "../../../../db/messages.ts";

/**
 * GET /api/v1/messages/unread-count — pour la pastille sur l'entrée « Mes
 * messages » du menu mobile (cf. web/components/Header.tsx, même besoin ;
 * endpoint dédié plutôt que glissé dans le fil ou l'inbox, cf.
 * `_doc/architecture-mobile.md` : un écran mobile qui n'a besoin que de ça
 * ne doit pas payer le coût de charger tout le reste).
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
    return Response.json({ hasUnread: await hasUnreadMessages(user.id) });
  },
});
