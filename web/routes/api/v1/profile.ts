import { define, type SessionUser } from "../../../utils.ts";
import { isUniqueViolation } from "../../../db/errors.ts";
import { updateUserProfile } from "../../../db/users.ts";
import { deleteUserAccount } from "../../../db/account.ts";
import {
  MAX_HOUSE_NUMBER_LENGTH,
  MAX_LOGIN_LENGTH,
} from "../../../utils/validation.ts";

interface ProfileDto {
  login: string;
  email: string;
  houseNumber: string;
  streetName: string;
  cityName: string;
}

function toProfileDto(user: SessionUser): ProfileDto {
  return {
    login: user.login,
    email: user.email,
    houseNumber: user.houseNumber ?? "",
    streetName: user.street.name,
    cityName: user.street.city.name,
  };
}

/**
 * GET/PATCH/DELETE /api/v1/profile — gestion du profil pour l'app mobile
 * (cf. routes/profil.tsx, mêmes règles). Login et numéro de foyer sont les
 * seuls champs modifiables (ni l'e-mail — identifiant de connexion — ni la
 * rue/ville, cf. db/users.ts#updateUserProfile) ; la suppression de compte
 * réutilise `deleteUserAccount` telle quelle.
 *
 * Pas de déconnexion de toutes les sessions ici (`revokeAllSessions`
 * existe déjà côté db mais n'est branchée sur aucune route, web comme
 * mobile) : item de backlog mobile distinct (« déconnecter toutes mes
 * sessions actives »), pas cette story.
 */
export const handler = define.handlers({
  GET(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return Response.json(
        { error: "Authentification requise." },
        { status: 401 },
      );
    }
    return Response.json(toProfileDto(user));
  },

  async PATCH(ctx) {
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
    const parsed = body as Record<string, unknown> | null;
    const login = String(parsed?.login ?? "").trim().slice(
      0,
      MAX_LOGIN_LENGTH,
    );
    const houseNumber = String(parsed?.houseNumber ?? "").trim().slice(
      0,
      MAX_HOUSE_NUMBER_LENGTH,
    );

    if (!login) {
      return Response.json(
        { error: "Merci de renseigner un login." },
        { status: 400 },
      );
    }

    try {
      await updateUserProfile(user.id, {
        login,
        houseNumber: houseNumber || null,
      });
    } catch (error) {
      if (isUniqueViolation(error, "user_login_unique")) {
        return Response.json(
          { error: "Ce login est déjà utilisé." },
          { status: 409 },
        );
      }
      throw error;
    }

    return Response.json({
      login,
      email: user.email,
      houseNumber,
      streetName: user.street.name,
      cityName: user.street.city.name,
    });
  },

  async DELETE(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return Response.json(
        { error: "Authentification requise." },
        { status: 401 },
      );
    }

    await deleteUserAccount(user.id);
    // Contrairement au web (cookie de session, effacé ici via
    // `expireCookie`) : le jeton mobile vit dans le Keychain/Keystore de
    // l'appareil, hors de portée du serveur — c'est à l'appelant
    // (mobile/lib/auth.ts#clearToken) de l'effacer après ce 200, comme
    // pour une déconnexion classique.
    return Response.json({ ok: true });
  },
});
