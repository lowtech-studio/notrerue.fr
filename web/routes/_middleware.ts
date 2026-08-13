import { define } from "../utils.ts";
import { findSessionUserById } from "../db/users.ts";
import { getStreetHousesStatus } from "../db/streets.ts";
import { hasUnreadMessages } from "../db/messages.ts";
import { parseCookies } from "../utils/cookies.ts";
import { SESSION_COOKIE, verifySessionValue } from "../utils/session.ts";
import { parseTheme, THEME_COOKIE } from "../utils/theme.ts";

/**
 * En-têtes de sécurité posés sur toute réponse, complémentaires à la CSP
 * (posée par le middleware `csp()` de Fresh dans main.ts — pas ici, car elle
 * a besoin du nonce généré au rendu, cf. commentaire là-bas) — cf. AGENTS.md
 * « Cyber sécurité », ANSSI-PA-009 R13-R22 :
 * - `frame-ancestors 'none'` (posé côté CSP) + `X-Frame-Options: DENY` :
 *   bloque l'inclusion du site dans une frame tierce (clickjacking).
 * - `Referrer-Policy` : n'expose l'URL complète qu'en navigation
 *   same-origin, l'origine seule vers un site externe.
 */
function applySecurityHeaders(headers: Headers): void {
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
}

export const handler = define.middleware(async (ctx) => {
  ctx.state.user = null;
  ctx.state.isStreetAwake = null;
  ctx.state.hasUnreadMessages = false;

  const cookies = parseCookies(ctx.req.headers.get("cookie"));
  ctx.state.theme = parseTheme(cookies[THEME_COOKIE]);
  const sessionValue = cookies[SESSION_COOKIE];

  if (sessionValue) {
    const userId = await verifySessionValue(sessionValue);
    if (userId) {
      ctx.state.user = await findSessionUserById(userId);
      if (ctx.state.user) {
        // Deux requêtes indépendantes sur le même habitant, lancées en
        // parallèle plutôt qu'en série (cf. revue sur le coût déjà accepté
        // d'une requête par page pour `isStreetAwake`).
        const [status, unread] = await Promise.all([
          getStreetHousesStatus(ctx.state.user.street.id),
          hasUnreadMessages(ctx.state.user.id),
        ]);
        ctx.state.isStreetAwake = status.isAwake;
        ctx.state.hasUnreadMessages = unread;
      }
    }
  }

  const res = await ctx.next();
  applySecurityHeaders(res.headers);
  return res;
});
