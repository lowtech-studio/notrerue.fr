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

const BEARER_PREFIX = "Bearer ";

/**
 * Valeur de session côté web (cookie) ou mobile (en-tête `Authorization:
 * Bearer <jeton>`, cf. _doc/architecture-mobile.md) — même jeton, même
 * vérification des deux côtés. Le cookie est prioritaire si les deux sont
 * présents, cas qui ne devrait jamais se produire en pratique (un client
 * envoie l'un ou l'autre, jamais les deux).
 */
function extractSessionValue(
  req: Request,
  cookies: Record<string, string>,
): string | undefined {
  const cookieValue = cookies[SESSION_COOKIE];
  if (cookieValue) return cookieValue;

  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith(BEARER_PREFIX)) {
    return authHeader.slice(BEARER_PREFIX.length).trim();
  }
  return undefined;
}

export const handler = define.middleware(async (ctx) => {
  ctx.state.user = null;
  ctx.state.isStreetAwake = null;
  ctx.state.hasUnreadMessages = false;

  const cookies = parseCookies(ctx.req.headers.get("cookie"));
  ctx.state.theme = parseTheme(cookies[THEME_COOKIE]);
  const sessionValue = extractSessionValue(ctx.req, cookies);

  if (sessionValue) {
    const verified = await verifySessionValue(sessionValue);
    if (verified) {
      ctx.state.user = await findSessionUserById(
        verified.userId,
        verified.issuedAt,
      );
      // `isStreetAwake`/`hasUnreadMessages` n'alimentent que le `<Header>`
      // web (une page = un rendu, coût accepté) : les appels JSON sous
      // `/api/` n'en ont jamais besoin (aucune route API ne rend de
      // `<Header>`) — les épargner évite 2 requêtes DB gratuites sur
      // chaque appel mobile (cf. revue de _doc/architecture-mobile.md, un
      // écran peut déclencher 3-5 appels). Un client mobile qui a besoin de
      // ces informations les demande explicitement via un endpoint dédié.
      if (ctx.state.user && !ctx.url.pathname.startsWith("/api/")) {
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
