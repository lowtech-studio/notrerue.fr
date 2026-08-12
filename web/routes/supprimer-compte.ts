import { define } from "../utils.ts";
import { deleteUserAccount } from "../db/account.ts";
import { expireCookie } from "../utils/cookies.ts";
import { SESSION_COOKIE } from "../utils/session.ts";

/**
 * Suppression de compte (cf. backlog « rester maître de mes données ») —
 * soft delete du compte, du foyer et de toutes les publications/réponses
 * (cf. db/account.ts#deleteUserAccount), puis déconnexion immédiate. Un
 * clic suffit une fois soumis, mais l'action n'est proposée qu'après un
 * premier clic sur « Supprimer mon compte » qui déplie une confirmation sur
 * /profil (cf. routes/fil.tsx, <details> sans JS, même logique que la
 * suppression d'une demande).
 */
export const handler = define.handlers({
  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.redirect("/connexion");

    await deleteUserAccount(user.id);

    const res = ctx.redirect("/?compte_supprime=1");
    res.headers.append("set-cookie", expireCookie(SESSION_COOKIE));
    return res;
  },
});
