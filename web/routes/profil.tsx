import { Head } from "fresh/runtime";
import "../assets/pages/profil.css" with { type: "css" };
import { define } from "../utils.ts";
import { Header } from "../components/Header.tsx";
import { isUniqueViolation } from "../db/errors.ts";
import { updateUserProfile } from "../db/users.ts";
import {
  MAX_HOUSE_NUMBER_LENGTH,
  MAX_LOGIN_LENGTH,
} from "../utils/validation.ts";

interface ProfilData {
  login: string;
  email: string;
  houseNumber: string;
  streetName: string;
  cityName: string;
  error: string | null;
  updated: boolean;
}

/**
 * Édition du profil (cf. Header : lien « Gérer mon profil » du menu de
 * compte) — login et numéro de foyer, seuls champs modifiables. Ni l'e-mail
 * (identifiant de connexion, affiché en lecture seule) ni la rue/ville
 * (rattacher un compte à une autre rue touche au statut d'ambassadeur, hors
 * scope ici) : cf. db/users.ts#updateUserProfile.
 */
export const handler = define.handlers({
  GET(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.redirect("/connexion");

    return {
      data: {
        login: user.login,
        email: user.email,
        houseNumber: user.houseNumber ?? "",
        streetName: user.street.name,
        cityName: user.street.city.name,
        error: null,
        updated: ctx.url.searchParams.get("updated") === "1",
      },
    };
  },

  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.redirect("/connexion");

    const form = await ctx.req.formData();
    const login = String(form.get("login") ?? "").trim().slice(
      0,
      MAX_LOGIN_LENGTH,
    );
    const houseNumber = String(form.get("houseNumber") ?? "").trim().slice(
      0,
      MAX_HOUSE_NUMBER_LENGTH,
    );

    // Re-servi tel quel en cas d'erreur — la rue/ville ne se modifient pas
    // ici, elles viennent donc toujours de la session plutôt que du formulaire.
    const resubmitted = {
      login,
      email: user.email,
      houseNumber,
      streetName: user.street.name,
      cityName: user.street.city.name,
      updated: false,
    };

    if (!login) {
      return {
        data: { ...resubmitted, error: "Merci de renseigner un login." },
      };
    }

    try {
      await updateUserProfile(user.id, {
        login,
        houseNumber: houseNumber || null,
      });
    } catch (error) {
      if (isUniqueViolation(error, "user_login_unique")) {
        return {
          data: { ...resubmitted, error: "Ce login est déjà utilisé." },
        };
      }
      throw error;
    }

    return ctx.redirect("/profil?updated=1");
  },
});

export default define.page<typeof handler>(function Profil({ data, state }) {
  const { login, email, houseNumber, streetName, cityName, error, updated } =
    data as ProfilData;

  return (
    <>
      <Head>
        <title>Mon profil — NotreRue.fr</title>
      </Head>
      <Header
        user={state.user}
        isStreetAwake={state.isStreetAwake}
        theme={state.theme}
        hasUnreadMessages={state.hasUnreadMessages}
      />
      <main>
        <section class="container hero hero--single">
          <div class="lookup-card">
            <h1 class="hero__title">Mon profil</h1>
            <p class="hero__subtitle">
              {streetName}, {cityName}
            </p>

            {updated && (
              <p class="hero__confirmation">
                Votre profil a été mis à jour.
              </p>
            )}
            {error && <p class="form-error" role="alert">{error}</p>}

            <form method="POST" class="registration-form">
              <div class="form-field">
                <label class="lookup-card__label" for="login">Login</label>
                <input
                  id="login"
                  name="login"
                  type="text"
                  class="lookup-form__input"
                  maxlength={MAX_LOGIN_LENGTH}
                  value={login}
                  autocomplete="off"
                  required
                />
              </div>

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
                  value={houseNumber}
                  autocomplete="off"
                />
                <p class="autocomplete-field__hint">
                  Seuls les foyers que vous choisirez pourront le voir.
                </p>
              </div>

              <div class="form-field">
                <span class="lookup-card__label">E-mail</span>
                <p class="profil-email">{email}</p>
              </div>

              <button type="submit" class="button">Enregistrer</button>
            </form>
          </div>

          {
            /* Suppression de compte (cf. backlog « rester maître de mes
              données ») — repliée derrière un <details> pour ne pas être le
              premier bouton visible de la page, avec une confirmation
              explicite (même logique que "Supprimer" sur /fil). */
          }
          <div class="lookup-card profil-danger-zone">
            <details>
              <summary class="profil-danger-zone__summary">
                Supprimer mon compte
              </summary>
              <p class="profil-danger-zone__warning">
                Votre foyer et toutes vos publications (demandes, réponses)
                seront supprimés. Cette action est irréversible.
              </p>
              <form method="POST" action="/supprimer-compte">
                <button type="submit" class="button button--danger">
                  Oui, supprimer définitivement mon compte
                </button>
              </form>
            </details>
          </div>
        </section>
      </main>
    </>
  );
});
