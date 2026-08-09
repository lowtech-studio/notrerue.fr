import { Head } from "fresh/runtime";
import postgres from "postgres";
import { define } from "../utils.ts";
import { Header } from "../components/Header.tsx";
import { findCityById } from "../db/cities.ts";
import { findOrCreateStreet } from "../db/streets.ts";
import { registerInhabitant } from "../db/users.ts";
import { sendLoginCodeEmail } from "../email/brevo.ts";
import { MAX_EMAIL_LENGTH } from "../utils/validation.ts";
import RegistrationAddressFields from "../islands/RegistrationAddressFields.tsx";

const MAX_LOGIN_LENGTH = 40;
const MAX_STREET_LENGTH = 80;
const MAX_HOUSE_NUMBER_LENGTH = 10;

interface RejoindreData {
  error: string | null;
  login: string;
  email: string;
  houseNumber: string;
  streetName: string;
  cityId: number | null;
  /** Libellé affiché dans le champ ville, ex. "Nantes (Loire-Atlantique)". */
  cityLabel: string;
}

const EMPTY_FORM: Omit<RejoindreData, "error"> = {
  login: "",
  email: "",
  houseNumber: "",
  streetName: "",
  cityId: null,
  cityLabel: "",
};

export const handler = define.handlers({
  GET(ctx) {
    if (ctx.state.user) return ctx.redirect("/");
    return { data: { error: null, ...EMPTY_FORM } };
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

    // Valeurs re-soumises telles quelles en cas d'erreur : évite de faire
    // ressaisir le formulaire en entier (login/e-mail perdus au moindre
    // faux pas). La ville est retrouvée ci-dessous pour reconstituer son
    // libellé affiché (RegistrationAddressFields n'a que l'id en entrée).
    const resubmitted = {
      login,
      email,
      houseNumber,
      streetName,
      cityId: Number.isInteger(cityIdRaw) && cityIdRaw > 0 ? cityIdRaw : null,
      cityLabel: "",
    };

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
      const { code } = await registerInhabitant({
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
    } catch (error) {
      if (error instanceof postgres.PostgresError && error.code === "23505") {
        if (error.constraint_name === "user_login_unique") {
          return {
            data: { ...resubmitted, error: "Ce login est déjà utilisé." },
          };
        }
        if (error.constraint_name === "user_email_unique") {
          return {
            data: {
              ...resubmitted,
              error:
                "Cet e-mail est déjà inscrit. Connectez-vous avec le code reçu par e-mail.",
            },
          };
        }
      }
      throw error;
    }

    return ctx.redirect(`/connexion?email=${encodeURIComponent(email)}`);
  },
});

export default define.page<typeof handler>(function Rejoindre({ data }) {
  const { error, login, email, houseNumber, streetName, cityId, cityLabel } =
    data as RejoindreData;

  return (
    <>
      <Head>
        <title>Rejoindre ma rue — NotreRue.fr</title>
      </Head>
      <Header />
      <main>
        <section class="container hero hero--single">
          <div class="lookup-card">
            <h1 class="hero__title">Rejoindre ma rue</h1>
            <p class="hero__subtitle">
              Devenez le premier ambassadeur de votre rue. Vous recevrez un code
              à 6 chiffres par e-mail pour vous connecter.
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

              <button type="submit" class="button">
                Devenir ambassadeur de ma rue
              </button>
            </form>
          </div>
        </section>
      </main>
    </>
  );
});
