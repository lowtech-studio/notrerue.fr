import { define } from "../utils.ts";
import {
  expireCookie,
  parseCookies,
  serializeCookie,
} from "../utils/cookies.ts";
import { isSecureRequest } from "../utils/http.ts";
import { nextTheme, parseTheme, THEME_COOKIE } from "../utils/theme.ts";

/** Un an : assez long pour ne pas redemander le choix à chaque visite, sans prétendre à une préférence "permanente". */
const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Chemin de retour : l'en-tête `Referer` plutôt qu'un champ caché — ce
 * bouton vit dans le menu de compte, présent sur toutes les pages, sans
 * qu'aucune ne lui fournisse son propre chemin. Same-origin, donc envoyé
 * malgré la `Referrer-Policy` restrictive du site (qui ne masque que les
 * navigations vers un site tiers, cf. routes/_middleware.ts) ; l'origine est
 * revérifiée ici (pas d'open redirect si jamais falsifiée) et repliée sur
 * l'accueil à défaut ou en cas d'URL invalide.
 */
function resolveRefererPath(req: Request, currentUrl: URL): string {
  const referer = req.headers.get("referer");
  if (!referer) return "/";
  try {
    const refererUrl = new URL(referer);
    return refererUrl.origin === currentUrl.origin
      ? refererUrl.pathname + refererUrl.search
      : "/";
  } catch {
    return "/";
  }
}

/**
 * Bascule l'apparence du site (système → sombre → clair → système...) —
 * cf. Header.tsx pour le bouton, assets/common.css pour l'application du
 * choix via `[data-theme]`. Un seul bouton POST suffit à couvrir les trois
 * états sans île ni JS (règle Fresh n°1), chaque clic avance d'un cran.
 */
export const handler = define.handlers({
  POST(ctx) {
    const cookies = parseCookies(ctx.req.headers.get("cookie"));
    const current = parseTheme(cookies[THEME_COOKIE]);
    const next = nextTheme(current);
    const secure = isSecureRequest(ctx.req, ctx.url);

    const res = ctx.redirect(resolveRefererPath(ctx.req, ctx.url));
    res.headers.append(
      "set-cookie",
      next === null
        ? expireCookie(THEME_COOKIE, { secure })
        : serializeCookie(THEME_COOKIE, next, {
          maxAge: THEME_COOKIE_MAX_AGE_SECONDS,
          secure,
        }),
    );
    return res;
  },
});
