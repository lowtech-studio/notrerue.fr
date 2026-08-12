import { define } from "../utils.ts";
import { findSessionUserById } from "../db/users.ts";
import { getStreetHousesStatus } from "../db/streets.ts";
import { parseCookies } from "../utils/cookies.ts";
import { SESSION_COOKIE, verifySessionValue } from "../utils/session.ts";

/**
 * En-têtes de sécurité posés sur toute réponse (cf. AGENTS.md « Cyber
 * sécurité », ANSSI-PA-009 R13-R22) :
 * - CSP stricte, uniquement des ressources same-origin, sans
 *   `unsafe-inline`/`unsafe-eval`/`data:` — l'app ne charge aucune
 *   ressource externe (pas de police/CDN/analytics tiers, cf.
 *   éco-conception) et ne rend aucun style ni script inline (vérifié : pas
 *   de `style={{...}}`, pas de `<script>` dans les routes/composants).
 * - `frame-ancestors 'none'` + `X-Frame-Options: DENY` : bloque
 *   l'inclusion du site dans une frame tierce (clickjacking).
 * - `Referrer-Policy` : n'expose l'URL complète qu'en navigation
 *   same-origin, l'origine seule vers un site externe.
 *
 * `import.meta.env?.DEV` relâche `script-src`/`style-src` uniquement en
 * développement (`deno task dev`) : le rafraîchissement à chaud de Vite
 * (`@prefresh`) évalue du JS généré dynamiquement et injecte du CSS via des
 * balises `<style>` créées en JS — deux pratiques qu'une CSP stricte
 * bloquerait à raison, mais qui ne concernent jamais un build livré
 * (`deno task build` / `deno task start`, seul chemin qui sert de vrais
 * utilisateurs). Accès optionnel (`?.`) : `import.meta.env` n'existe que
 * pour du code passé par Vite (dev ou build) — sous `deno test`/`deno
 * check`, qui exécutent ce fichier directement sans Vite, il est
 * `undefined`, et on retombe alors sur la CSP stricte (comportement sûr par
 * défaut).
 */
function applySecurityHeaders(headers: Headers): void {
  const isDev = import.meta.env?.DEV === true;
  const scriptSrc = isDev ? "'self' 'unsafe-eval'" : "'self'";
  const styleSrc = isDev ? "'self' 'unsafe-inline'" : "'self'";
  headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      `script-src ${scriptSrc}`,
      `style-src ${styleSrc}`,
      "img-src 'self'",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  );
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
}

export const handler = define.middleware(async (ctx) => {
  ctx.state.user = null;
  ctx.state.isStreetAwake = null;

  const cookies = parseCookies(ctx.req.headers.get("cookie"));
  const sessionValue = cookies[SESSION_COOKIE];

  if (sessionValue) {
    const userId = await verifySessionValue(sessionValue);
    if (userId) {
      ctx.state.user = await findSessionUserById(userId);
      if (ctx.state.user) {
        const status = await getStreetHousesStatus(ctx.state.user.street.id);
        ctx.state.isStreetAwake = status.isAwake;
      }
    }
  }

  const res = await ctx.next();
  applySecurityHeaders(res.headers);
  return res;
});
