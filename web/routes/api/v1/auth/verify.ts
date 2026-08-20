import { define } from "../../../../utils.ts";
import { verifyLoginCode } from "../../../../db/users.ts";
import {
  createSessionValue,
  SESSION_TTL_SECONDS,
} from "../../../../utils/session.ts";
import { MAX_EMAIL_LENGTH } from "../../../../utils/validation.ts";
import { createCooldown } from "../../../../utils/rate_limit.ts";

const CODE_LENGTH = 6;

/**
 * Anti brute-force additionnel, en défense en profondeur du verrou déjà en
 * base (`MAX_LOGIN_CODE_ATTEMPTS`, cf. db/users.ts#verifyLoginCode) : sans
 * lui, un script peut enchaîner les 5 tentatives autorisées en quelques
 * millisecondes. Clé = e-mail (pas d'IP fiable établie ailleurs dans ce
 * dépôt) — cf. revue de _doc/architecture-mobile.md.
 */
const VERIFY_COOLDOWN_MS = 2000;
const verifyCooldown = createCooldown(VERIFY_COOLDOWN_MS);

/**
 * POST /api/v1/auth/verify — vérifie le code à 6 chiffres et émet le jeton
 * de session mobile (même format que le cookie web, cf.
 * `utils/session.ts#createSessionValue` et _doc/architecture-mobile.md).
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

    const parsed = body as Record<string, unknown> | null;
    const rawEmail = parsed?.email;
    const rawCode = parsed?.code;
    const email = typeof rawEmail === "string"
      ? rawEmail.trim().toLowerCase().slice(0, MAX_EMAIL_LENGTH)
      : "";
    const code = typeof rawCode === "string" ? rawCode.trim() : "";

    if (!email.includes("@") || code.length !== CODE_LENGTH) {
      return Response.json(
        { error: "E-mail et code à 6 chiffres requis." },
        { status: 400 },
      );
    }

    if (verifyCooldown.isActive(email)) {
      return Response.json(
        { error: "Merci de patienter avant de réessayer." },
        { status: 429 },
      );
    }
    verifyCooldown.record(email);

    const user = await verifyLoginCode(email, code);
    if (!user) {
      return Response.json(
        { error: "Code incorrect ou expiré." },
        { status: 401 },
      );
    }

    const token = await createSessionValue(user.id);
    return Response.json({ token, expiresIn: SESSION_TTL_SECONDS });
  },
});
