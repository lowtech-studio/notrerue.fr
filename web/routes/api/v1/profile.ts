import { define, type SessionUser } from "../../../utils.ts";
import { isUniqueViolation } from "../../../db/errors.ts";
import {
  findSessionUserById,
  setPushNotificationsPaused,
  updateUserProfile,
} from "../../../db/users.ts";
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
  pushNotificationsPaused: boolean;
}

function toProfileDto(user: SessionUser): ProfileDto {
  return {
    login: user.login,
    email: user.email,
    houseNumber: user.houseNumber ?? "",
    streetName: user.street.name,
    cityName: user.street.city.name,
    pushNotificationsPaused: user.pushNotificationsPaused ?? false,
  };
}

/**
 * GET/PATCH/DELETE /api/v1/profile — gestion du profil pour l'app mobile
 * (cf. routes/profil.tsx, mêmes règles pour login/numéro de foyer/e-mail).
 * `pushNotificationsPaused` (cf. backlog mobile « pouvoir configurer la
 * mise en pause des notifications dans ma gestion de profil mobile ») est
 * propre au mobile, sans équivalent web — PATCH accepte donc une mise à
 * jour partielle : `login` (+`houseNumber`) et/ou `pushNotificationsPaused`
 * peuvent être envoyés indépendamment, pour qu'un simple interrupteur
 * n'ait pas besoin de renvoyer tout le formulaire d'identité.
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
    const parsed = typeof body === "object" && body !== null
      ? body as Record<string, unknown>
      : {};

    const hasLogin = "login" in parsed;
    const hasPaused = typeof parsed.pushNotificationsPaused === "boolean";

    if (!hasLogin && !hasPaused) {
      return Response.json(
        { error: "Rien à mettre à jour." },
        { status: 400 },
      );
    }

    if (hasLogin) {
      const login = String(parsed.login ?? "").trim().slice(
        0,
        MAX_LOGIN_LENGTH,
      );
      const houseNumber = String(parsed.houseNumber ?? "").trim().slice(
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
    }

    if (hasPaused) {
      await setPushNotificationsPaused(
        user.id,
        parsed.pushNotificationsPaused as boolean,
      );
    }

    const updated = await findSessionUserById(user.id);
    // `updated` ne peut être `null` ici : le compte vient d'être lu via
    // `ctx.state.user` (donc actif) et rien ci-dessus ne le supprime.
    return Response.json(toProfileDto(updated!));
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
