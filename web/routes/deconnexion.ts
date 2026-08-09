import { define } from "../utils.ts";
import { expireCookie } from "../utils/cookies.ts";
import { SESSION_COOKIE } from "../utils/session.ts";

/**
 * Déconnexion : expire le cookie de session et renvoie vers l'accueil.
 * Idempotent (fonctionne même sans session active). Pas de token anti-CSRF
 * ici : aucune route de ce dépôt n'en pose encore (cf. AGENTS.md R38, à
 * traiter globalement) et l'impact d'une déconnexion forcée est mineur.
 */
export const handler = define.handlers({
  POST(ctx) {
    const res = ctx.redirect("/");
    res.headers.append("set-cookie", expireCookie(SESSION_COOKIE));
    return res;
  },
});
