import { define } from "../../../../utils.ts";
import { registerPushToken } from "../../../../db/push.ts";
import { MAX_PUSH_TOKEN_LENGTH } from "../../../../utils/validation.ts";

/**
 * POST /api/v1/push/register — enregistre le jeton de push Expo de
 * l'appareil (cf. push/expo.ts, _doc/architecture-mobile.md). Appelé par
 * l'app mobile après avoir obtenu la permission et le jeton
 * (`Notifications.getExpoPushTokenAsync`, cf. mobile/lib/notifications.ts)
 * — au lancement de l'app et après connexion, un jeton pouvant changer
 * d'un lancement à l'autre.
 */
export const handler = define.handlers({
  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return Response.json(
        { error: "Authentification requise." },
        { status: 401 },
      );
    }

    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return Response.json(
        { error: "Corps JSON invalide." },
        { status: 400 },
      );
    }
    const token = String(
      (body as Record<string, unknown> | null)?.token ?? "",
    ).trim().slice(0, MAX_PUSH_TOKEN_LENGTH);

    if (!token) {
      return Response.json(
        { error: "Jeton de push manquant." },
        { status: 400 },
      );
    }

    await registerPushToken(user.id, token);
    return Response.json({ ok: true });
  },
});
