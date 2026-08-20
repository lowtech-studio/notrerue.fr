import { define } from "../../../../utils.ts";
import { clearLoginCodeSentAt, startLogin } from "../../../../db/users.ts";
import { sendLoginCodeEmail } from "../../../../email/brevo.ts";
import { MAX_EMAIL_LENGTH } from "../../../../utils/validation.ts";

/**
 * POST /api/v1/auth/code — demande un code de connexion à 6 chiffres par
 * e-mail, pour l'app mobile (cf. _doc/architecture-mobile.md). Même logique
 * que `routes/connexion.tsx` (étape e-mail) côté web, réutilisée telle
 * quelle : réponse volontairement identique que l'adresse soit inscrite,
 * inconnue, ou déjà throttlée (`db/users.ts#startLogin`), pour ne pas
 * laisser deviner quels e-mails sont inscrits (énumération de comptes).
 */
export const handler = define.handlers({
  async POST(ctx) {
    let body: unknown;
    try {
      body = await ctx.req.json();
    } catch {
      return Response.json(
        { error: "Corps JSON invalide." },
        { status: 400 },
      );
    }

    const rawEmail = (body as Record<string, unknown> | null)?.email;
    const email = typeof rawEmail === "string"
      ? rawEmail.trim().toLowerCase().slice(0, MAX_EMAIL_LENGTH)
      : "";

    if (!email.includes("@")) {
      return Response.json({ error: "E-mail invalide." }, { status: 400 });
    }

    const outcome = await startLogin(email);
    if (outcome.status === "sent") {
      try {
        await sendLoginCodeEmail(
          email,
          outcome.code,
          `${ctx.url.origin}/connexion?email=${encodeURIComponent(email)}`,
        );
      } catch (error) {
        // Même raisonnement que connexion.tsx : cet e-mail est indispensable
        // pour se connecter, un échec ne peut pas être toléré en silence —
        // et sans `clearLoginCodeSentAt`, le throttle de `startLogin`
        // resterait armé alors qu'aucun code n'est jamais arrivé (cf. revue
        // déjà faite côté web).
        console.error(
          "Échec de l'envoi du code de connexion (API mobile) :",
          error,
        );
        await clearLoginCodeSentAt(email);
        return Response.json(
          {
            error:
              "Erreur d'envoi de l'e-mail — réessayez dans quelques instants.",
          },
          { status: 502 },
        );
      }
    }

    // Réponse uniforme quel que soit le statut réel (sent/throttled/
    // not_found) : cf. commentaire de fonction.
    return Response.json({ ok: true });
  },
});
