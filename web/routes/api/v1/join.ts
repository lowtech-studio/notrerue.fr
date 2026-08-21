import { define } from "../../../utils.ts";
import { findCityById } from "../../../db/cities.ts";
import { findOrCreateStreet } from "../../../db/streets.ts";
import { isUniqueViolation } from "../../../db/errors.ts";
import {
  findStreetAmbassador,
  findStreetUsers,
  registerInhabitant,
} from "../../../db/users.ts";
import {
  sendLoginCodeEmail,
  sendPendingNeighborEmail,
  sendStreetAwakeningEmail,
} from "../../../email/brevo.ts";
import {
  MAX_EMAIL_LENGTH,
  MAX_HOUSE_NUMBER_LENGTH,
  MAX_LOGIN_LENGTH,
  MAX_STREET_LENGTH,
} from "../../../utils/validation.ts";

interface JoinBody {
  login: string;
  email: string;
  houseNumber: string | null;
  street: string;
  cityId: number | null;
  ageConfirmed: boolean;
}

function parseBody(raw: unknown): JoinBody {
  const body = raw as Record<string, unknown> | null;
  const login = typeof body?.login === "string"
    ? body.login.trim().slice(0, MAX_LOGIN_LENGTH)
    : "";
  const email = typeof body?.email === "string"
    ? body.email.trim().toLowerCase().slice(0, MAX_EMAIL_LENGTH)
    : "";
  const houseNumberRaw = typeof body?.houseNumber === "string"
    ? body.houseNumber.trim().slice(0, MAX_HOUSE_NUMBER_LENGTH)
    : "";
  const street = typeof body?.street === "string"
    ? body.street.trim().slice(0, MAX_STREET_LENGTH)
    : "";
  const cityIdRaw = Number(body?.cityId);
  const cityId = Number.isInteger(cityIdRaw) && cityIdRaw > 0
    ? cityIdRaw
    : null;
  const ageConfirmed = body?.ageConfirmed === true;

  return {
    login,
    email,
    houseNumber: houseNumberRaw || null,
    street,
    cityId,
    ageConfirmed,
  };
}

/**
 * POST /api/v1/join — inscription depuis l'app mobile (cf.
 * _doc/architecture-mobile.md, backlog mobile MVP). Réutilise telle quelle
 * la logique de `routes/rejoindre.tsx` (POST) : `findOrCreateStreet`,
 * `registerInhabitant`, mêmes notifications tolérantes à l'échec.
 *
 * Ne renvoie jamais le code de connexion dans la réponse JSON — seulement
 * par e-mail (`sendLoginCodeEmail`) : la vérification passe obligatoirement
 * par `POST /api/v1/auth/verify` ensuite, même chemin qu'un renvoi de code.
 * Court-circuiter cette étape en renvoyant le code ici romprait la
 * vérification d'adresse e-mail que ce flux est censé garantir.
 */
export const handler = define.handlers({
  async POST(ctx) {
    if (ctx.state.user) {
      return Response.json(
        { error: "Vous êtes déjà connecté." },
        { status: 409 },
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await ctx.req.json();
    } catch {
      return Response.json(
        { error: "Corps JSON invalide." },
        { status: 400 },
      );
    }
    const { login, email, houseNumber, street, cityId, ageConfirmed } =
      parseBody(rawBody);

    // Contrôlé avant le reste : seuil légal du consentement numérique en
    // France (15 ans), distinct d'un simple champ manquant (cf.
    // routes/rejoindre.tsx, même règle).
    if (!ageConfirmed) {
      return Response.json(
        {
          error:
            "Merci de confirmer avoir plus de 15 ans pour vous inscrire (seuil légal du consentement numérique en France).",
        },
        { status: 400 },
      );
    }

    if (!login || !email.includes("@") || !street || !cityId) {
      return Response.json(
        {
          error:
            "Merci de renseigner un login, un e-mail valide, une rue et une ville (cityId).",
        },
        { status: 400 },
      );
    }

    const selectedCity = await findCityById(cityId);
    if (!selectedCity) {
      return Response.json({ error: "Ville inconnue." }, { status: 400 });
    }

    let createdStreet: Awaited<ReturnType<typeof findOrCreateStreet>>;
    let newInhabitant: Awaited<ReturnType<typeof registerInhabitant>>;
    try {
      createdStreet = await findOrCreateStreet(street, selectedCity.id);
      newInhabitant = await registerInhabitant({
        login,
        email,
        houseNumber,
        streetId: createdStreet.id,
      });
    } catch (error) {
      if (isUniqueViolation(error, "user_login_unique")) {
        return Response.json(
          { error: "Ce login est déjà utilisé." },
          { status: 409 },
        );
      }
      if (isUniqueViolation(error, "user_email_unique")) {
        return Response.json(
          {
            error:
              "Cet e-mail est déjà inscrit. Connectez-vous avec /api/v1/auth/code.",
          },
          { status: 409 },
        );
      }
      throw error;
    }

    try {
      await sendLoginCodeEmail(
        email,
        newInhabitant.code,
        `${ctx.url.origin}/connexion?email=${encodeURIComponent(email)}`,
      );
    } catch (error) {
      // Contrairement à routes/rejoindre.tsx (pas de filet ici aujourd'hui,
      // remonterait en 500 Fresh brute) : le compte existe déjà à ce
      // stade, un échec d'envoi ne doit pas se traduire par une erreur
      // opaque. L'habitant peut redemander un code via /api/v1/auth/code
      // une fois le souci d'envoi passé (cf. AGENTS.md, jamais d'erreur
      // détaillée exposée en production).
      console.error(
        "Échec de l'envoi du code de connexion (inscription mobile) :",
        error,
      );
      return Response.json(
        {
          error:
            "Compte créé, mais l'envoi du code a échoué — redemandez-en un via /api/v1/auth/code.",
        },
        { status: 502 },
      );
    }

    // Notifications à part, tolérantes à l'échec — même logique que
    // routes/rejoindre.tsx : l'inscription et le code de connexion ont
    // déjà réussi, un souci Brevo ici ne doit jamais faire échouer la
    // requête.
    if (newInhabitant.streetJustAwakened) {
      const streetUsers = await findStreetUsers(createdStreet.id);
      const results = await Promise.allSettled(
        streetUsers.map((inhabitant) =>
          sendStreetAwakeningEmail({
            to: inhabitant.email,
            recipientLogin: inhabitant.login,
            streetName: createdStreet.name,
            cityName: selectedCity.name,
            homeUrl: ctx.url.origin,
          })
        ),
      );
      for (const result of results) {
        if (result.status === "rejected") {
          console.error(
            "Échec de la notification d'éveil de rue (inscription mobile) :",
            result.reason,
          );
        }
      }
    }

    if (!newInhabitant.user.isAmbassador) {
      const ambassador = await findStreetAmbassador(createdStreet.id);
      if (ambassador) {
        try {
          await sendPendingNeighborEmail({
            to: ambassador.email,
            recipientLogin: ambassador.login,
            newcomerLogin: newInhabitant.user.login,
            streetName: createdStreet.name,
            homeUrl: ctx.url.origin,
          });
        } catch (error) {
          console.error(
            "Échec de la notification de nouveau voisin à valider (inscription mobile) :",
            error,
          );
        }
      }
    }

    return Response.json({
      ok: true,
      isAmbassador: newInhabitant.user.isAmbassador,
    });
  },
});
