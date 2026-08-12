import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import { Header } from "../components/Header.tsx";
import { findCityById } from "../db/cities.ts";
import { isUniqueViolation } from "../db/errors.ts";
import { findOrCreateStreet, getStreetAwakeningStatus } from "../db/streets.ts";
import { findStreetUsers, registerInhabitant } from "../db/users.ts";
import {
  sendLoginCodeEmail,
  sendStreetAwakeningEmail,
} from "../email/brevo.ts";
import {
  MAX_EMAIL_LENGTH,
  MAX_HOUSE_NUMBER_LENGTH,
  MAX_LOGIN_LENGTH,
} from "../utils/validation.ts";
import RegistrationAddressFields from "../islands/RegistrationAddressFields.tsx";

const MAX_STREET_LENGTH = 80;

interface RejoindreData {
  error: string | null;
  login: string;
  email: string;
  houseNumber: string;
  streetName: string;
  cityId: number | null;
  /** Libellé affiché dans le champ ville, ex. "Nantes (Loire-Atlantique)". */
  cityLabel: string;
  /**
   * Premier foyer de la rue au moment de l'affichage ⇒ deviendra ambassadeur.
   * Vrai par défaut (ville/rue pas encore choisies) : c'est le cas le plus
   * fréquent et l'ancien comportement de cette page.
   */
  willBeAmbassador: boolean;
  /**
   * Case à cocher re-soumise telle quelle en cas d'erreur ailleurs dans le
   * formulaire, pour ne pas faire recocher une déclaration déjà faite
   * (cf. backlog « préciser qu'il faut avoir plus de 15 ans »).
   */
  ageConfirmed: boolean;
}

const EMPTY_FORM: Omit<RejoindreData, "error"> = {
  login: "",
  email: "",
  houseNumber: "",
  streetName: "",
  cityId: null,
  cityLabel: "",
  willBeAmbassador: true,
  ageConfirmed: false,
};

/**
 * Vrai si le prochain inscrit sur cette rue en deviendrait l'ambassadeur
 * (aucun foyer encore inscrit). Ville/rue inconnues ⇒ `true` par défaut :
 * on ne peut pas encore savoir, et c'est le cas le plus fréquent (arrivée
 * directe sur /rejoindre, sans être passé par la page d'accueil).
 */
async function resolveWillBeAmbassador(
  cityId: number | null,
  streetName: string,
): Promise<boolean> {
  if (!cityId || !streetName) return true;
  const status = await getStreetAwakeningStatus(cityId, streetName);
  return status.isAmbassadorSlot;
}

export const handler = define.handlers({
  async GET(ctx) {
    if (ctx.state.user) return ctx.redirect("/");

    // Pré-remplissage depuis la page d'accueil ou le lien de partage
    // d'/inviter (« Rejoindre ma rue » sur une rue déjà repérée) :
    // cityId/street portés dans l'URL. Le libellé ville affiché est
    // reconstruit ci-dessous depuis la base plutôt que porté par un
    // paramètre `city` séparé — plus court à saisir/imprimer (cf. revue :
    // raccourcir le lien de partage), et un `city` d'un ancien lien déjà
    // distribué reste sans effet (simplement ignoré) plutôt que de casser.
    const cityIdRaw = Number(ctx.url.searchParams.get("cityId"));
    const cityId = Number.isInteger(cityIdRaw) && cityIdRaw > 0
      ? cityIdRaw
      : null;
    const streetName = (ctx.url.searchParams.get("street") ?? "").trim()
      .slice(0, MAX_STREET_LENGTH);

    const selectedCity = cityId ? await findCityById(cityId) : null;
    const cityLabel = selectedCity
      ? `${selectedCity.name} (${selectedCity.department})`
      : "";

    return {
      data: {
        ...EMPTY_FORM,
        error: null,
        // `cityId` retombe à `null` si l'identifiant ne correspond à aucune
        // ville réelle (lien forgé/périmé) : le formulaire se comporte
        // alors comme sans pré-remplissage plutôt que de pointer vers une
        // ville inexistante.
        cityId: selectedCity ? cityId : null,
        cityLabel,
        streetName,
        willBeAmbassador: await resolveWillBeAmbassador(
          selectedCity ? cityId : null,
          streetName,
        ),
      },
    };
  },
  async POST(ctx) {
    if (ctx.state.user) return ctx.redirect("/");

    const form = await ctx.req.formData();
    const login = String(form.get("login") ?? "").trim().slice(
      0,
      MAX_LOGIN_LENGTH,
    );
    const email = String(form.get("email") ?? "").trim().toLowerCase().slice(
      0,
      MAX_EMAIL_LENGTH,
    );
    const houseNumber = String(form.get("houseNumber") ?? "").trim().slice(
      0,
      MAX_HOUSE_NUMBER_LENGTH,
    );
    const streetName = String(form.get("street") ?? "").trim().slice(
      0,
      MAX_STREET_LENGTH,
    );
    const cityIdRaw = Number(form.get("cityId"));
    const submittedCityId = Number.isInteger(cityIdRaw) && cityIdRaw > 0
      ? cityIdRaw
      : null;
    // Déclaratif (pas de date de naissance demandée) : cohérent avec
    // « rester maître de mes données » — pas de donnée personnelle
    // supplémentaire pour un contrôle que la plupart des services en ligne
    // traitent aussi par simple déclaration (cf. backlog).
    const ageConfirmed = form.get("ageConfirmed") === "on";

    // Valeurs re-soumises telles quelles en cas d'erreur : évite de faire
    // ressaisir le formulaire en entier (login/e-mail perdus au moindre
    // faux pas). La ville est retrouvée ci-dessous pour reconstituer son
    // libellé affiché (RegistrationAddressFields n'a que l'id en entrée).
    const resubmitted = {
      login,
      email,
      houseNumber,
      streetName,
      cityId: submittedCityId,
      cityLabel: "",
      willBeAmbassador: await resolveWillBeAmbassador(
        submittedCityId,
        streetName,
      ),
      ageConfirmed,
    };

    // Contrôlé avant le reste : seuil légal du consentement numérique en
    // France (15 ans), distinct d'un simple champ manquant — message dédié
    // plutôt que noyé dans l'erreur générique ci-dessous.
    if (!ageConfirmed) {
      return {
        data: {
          ...resubmitted,
          error:
            "Merci de confirmer avoir plus de 15 ans pour vous inscrire (seuil légal du consentement numérique en France).",
        },
      };
    }

    if (!login || !email.includes("@") || !streetName || !cityIdRaw) {
      return {
        data: {
          ...resubmitted,
          error:
            "Merci de renseigner un login, un e-mail valide, et de choisir votre ville et votre rue dans les suggestions.",
        },
      };
    }

    const selectedCity = await findCityById(cityIdRaw);
    if (!selectedCity) {
      return {
        data: {
          ...resubmitted,
          cityId: null,
          error: "Merci de choisir votre ville dans la liste proposée.",
        },
      };
    }
    resubmitted.cityLabel = `${selectedCity.name} (${selectedCity.department})`;

    try {
      const street = await findOrCreateStreet(streetName, selectedCity.id);
      const { code, streetJustAwakened } = await registerInhabitant({
        login,
        email,
        houseNumber: houseNumber || null,
        streetId: street.id,
      });
      await sendLoginCodeEmail(
        email,
        code,
        `${ctx.url.origin}/connexion?email=${encodeURIComponent(email)}`,
      );

      // Notifications à part, tolérantes à l'échec : l'inscription et le
      // code de connexion viennent de réussir, un souci Brevo ici ne doit
      // pas faire échouer la requête (contrairement à sendLoginCodeEmail
      // ci-dessus, pas de retry côté utilisateur possible pour ces
      // messages). Tous les inscrits de la rue sont prévenus, pas seulement
      // l'ambassadeur.
      if (streetJustAwakened) {
        const streetUsers = await findStreetUsers(street.id);
        const results = await Promise.allSettled(
          streetUsers.map((inhabitant) =>
            sendStreetAwakeningEmail({
              to: inhabitant.email,
              recipientLogin: inhabitant.login,
              streetName: street.name,
              cityName: selectedCity.name,
              homeUrl: ctx.url.origin,
            })
          ),
        );
        for (const result of results) {
          if (result.status === "rejected") {
            console.error(
              "Échec de la notification d'éveil de rue :",
              result.reason,
            );
          }
        }
      }
    } catch (error) {
      if (isUniqueViolation(error, "user_login_unique")) {
        return {
          data: { ...resubmitted, error: "Ce login est déjà utilisé." },
        };
      }
      if (isUniqueViolation(error, "user_email_unique")) {
        return {
          data: {
            ...resubmitted,
            error:
              "Cet e-mail est déjà inscrit. Connectez-vous avec le code reçu par e-mail.",
          },
        };
      }
      throw error;
    }

    return ctx.redirect(`/connexion?email=${encodeURIComponent(email)}`);
  },
});

export default define.page<typeof handler>(function Rejoindre({ data }) {
  const {
    error,
    login,
    email,
    houseNumber,
    streetName,
    cityId,
    cityLabel,
    willBeAmbassador,
    ageConfirmed,
  } = data as RejoindreData;

  return (
    <>
      <Head>
        <title>Rejoindre ma rue — NotreRue.fr</title>
      </Head>
      <Header />
      <main>
        <section class="container hero hero--single">
          <div class="lookup-card">
            <h1 class="hero__title">
              {willBeAmbassador ? "Rejoindre ma rue" : "Rejoindre les voisins"}
            </h1>
            <p class="hero__subtitle">
              {willBeAmbassador
                ? "Devenez le premier ambassadeur de votre rue. Vous recevrez un code à 6 chiffres par e-mail pour vous connecter."
                : "Un ou plusieurs voisins ont déjà rejoint cette rue. Vous recevrez un code à 6 chiffres par e-mail pour vous connecter."}
            </p>

            {error && <p class="form-error" role="alert">{error}</p>}

            <form method="POST" class="registration-form">
              <div class="form-field">
                <label class="lookup-card__label" for="login">Login</label>
                <input
                  id="login"
                  name="login"
                  type="text"
                  class="lookup-form__input"
                  placeholder="Camille"
                  maxlength={MAX_LOGIN_LENGTH}
                  autocomplete="off"
                  value={login}
                  required
                />
              </div>

              <div class="form-field">
                <label class="lookup-card__label" for="email">E-mail</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  class="lookup-form__input"
                  placeholder="camille@example.fr"
                  maxlength={MAX_EMAIL_LENGTH}
                  autocomplete="email"
                  value={email}
                  required
                />
              </div>

              <RegistrationAddressFields
                initialCityId={cityId}
                initialCityLabel={cityLabel}
                initialStreet={streetName}
              />

              <div class="form-field">
                <label class="lookup-card__label" for="houseNumber">
                  Numéro de rue (facultatif)
                </label>
                <input
                  id="houseNumber"
                  name="houseNumber"
                  type="text"
                  class="lookup-form__input"
                  placeholder="14"
                  maxlength={MAX_HOUSE_NUMBER_LENGTH}
                  autocomplete="off"
                  value={houseNumber}
                />
                <p class="autocomplete-field__hint">
                  Seuls les foyers que vous choisirez pourront le voir.
                </p>
              </div>

              <div class="form-field form-field--checkbox">
                <input
                  id="ageConfirmed"
                  name="ageConfirmed"
                  type="checkbox"
                  checked={ageConfirmed}
                  required
                />
                <label class="lookup-card__label" for="ageConfirmed">
                  Je certifie avoir plus de 15 ans (seuil légal du consentement
                  numérique en France)
                </label>
              </div>

              <button type="submit" class="button">
                {willBeAmbassador
                  ? "Devenir ambassadeur de ma rue"
                  : "Rejoindre ma rue"}
              </button>
            </form>
          </div>
        </section>
      </main>
    </>
  );
});
