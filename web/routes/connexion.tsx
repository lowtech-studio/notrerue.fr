import { Head } from "fresh/runtime";
import "../assets/pages/connexion.css" with { type: "css" };
import { define } from "../utils.ts";
import { Header } from "../components/Header.tsx";
import { startLogin, verifyLoginCode } from "../db/users.ts";
import { sendLoginCodeEmail } from "../email/brevo.ts";
import {
  createSessionValue,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "../utils/session.ts";
import { serializeCookie } from "../utils/cookies.ts";
import { isSecureRequest } from "../utils/http.ts";
import { MAX_EMAIL_LENGTH } from "../utils/validation.ts";
import CodeInput from "../islands/CodeInput.tsx";

const CODE_LENGTH = 6;

interface ConnexionData {
  email: string;
  error: string | null;
  step: "email" | "code";
  sent: boolean;
}

export const handler = define.handlers({
  GET(ctx) {
    if (ctx.state.user) return ctx.redirect("/");
    const email = (ctx.url.searchParams.get("email") ?? "").trim().slice(
      0,
      MAX_EMAIL_LENGTH,
    );
    const sent = ctx.url.searchParams.get("sent") === "1";
    return {
      data: { email, error: null, step: email ? "code" : "email", sent },
    };
  },
  async POST(ctx) {
    if (ctx.state.user) return ctx.redirect("/");

    const form = await ctx.req.formData();
    const email = String(form.get("email") ?? "").trim().toLowerCase().slice(
      0,
      MAX_EMAIL_LENGTH,
    );

    // Étape 1 (et renvoi depuis l'étape code) : demande d'un code — pas de
    // champ `code` dans ce formulaire.
    if (!form.has("code")) {
      if (!email.includes("@")) {
        return {
          data: {
            email,
            step: "email",
            sent: false,
            error: "Merci de renseigner un e-mail valide.",
          },
        };
      }

      // La réponse est volontairement identique que l'e-mail soit inscrit,
      // inconnu, ou qu'un code vienne déjà d'être envoyé (throttle) : ne pas
      // laisser deviner quelles adresses sont inscrites (énumération de
      // comptes). Seul un envoi effectif ("sent") déclenche un e-mail.
      const outcome = await startLogin(email);
      if (outcome.status === "sent") {
        try {
          await sendLoginCodeEmail(
            email,
            outcome.code,
            `${ctx.url.origin}/connexion?email=${encodeURIComponent(email)}`,
          );
        } catch (error) {
          // Contrairement aux notifications (taps/reponses/messages), cet
          // e-mail est indispensable pour se connecter : un échec ne peut
          // pas être toléré en silence (l'utilisateur resterait bloqué sans
          // code ni explication). On l'affiche plutôt que de laisser Fresh
          // renvoyer une 500 brute (cf. AGENTS.md « jamais de message
          // d'erreur détaillé en production ») — le détail réel reste dans
          // les logs serveur, jamais exposé tel quel à l'utilisateur.
          console.error("Échec de l'envoi du code de connexion :", error);
          return {
            data: {
              email,
              step: "email",
              sent: false,
              error:
                "Erreur d'envoi de l'e-mail — réessayez dans quelques instants.",
            },
          };
        }
      }

      return ctx.redirect(
        `/connexion?email=${encodeURIComponent(email)}&sent=1`,
      );
    }

    // Étape 2 : vérification du code.
    const code = String(form.get("code") ?? "").trim();

    if (!email.includes("@") || code.length !== CODE_LENGTH) {
      return {
        data: {
          email,
          step: "code",
          sent: false,
          error: "Merci de renseigner votre e-mail et le code à 6 chiffres.",
        },
      };
    }

    const user = await verifyLoginCode(email, code);
    if (!user) {
      return {
        data: {
          email,
          step: "code",
          sent: false,
          error: "Code incorrect ou expiré. Redemandez un code.",
        },
      };
    }

    const sessionValue = await createSessionValue(user.id);
    const res = ctx.redirect("/");
    res.headers.append(
      "set-cookie",
      serializeCookie(SESSION_COOKIE, sessionValue, {
        maxAge: SESSION_TTL_SECONDS,
        secure: isSecureRequest(ctx.req, ctx.url),
      }),
    );
    return res;
  },
});

export default define.page<typeof handler>(function Connexion({ data }) {
  const { email, error, step, sent } = data as ConnexionData;

  return (
    <>
      <Head>
        <title>Se connecter — NotreRue.fr</title>
        <meta
          name="description"
          content="Connectez-vous à NotreRue.fr avec un simple code à 6 chiffres envoyé par e-mail, sans mot de passe à retenir."
        />
      </Head>
      <Header />
      <main>
        <section class="container hero hero--single">
          <div class="lookup-card">
            <h1 class="hero__title">Se connecter</h1>

            {step === "email"
              ? (
                <>
                  <p class="hero__subtitle">
                    Recevez un code de connexion à 6 chiffres par e-mail.
                  </p>

                  {error && <p class="form-error" role="alert">{error}</p>}

                  <form method="POST" class="registration-form">
                    <div class="form-field">
                      <label class="lookup-card__label" for="email">
                        E-mail
                      </label>
                      <input
                        id="email"
                        name="email"
                        type="email"
                        class="lookup-form__input"
                        autocomplete="email"
                        value={email}
                        required
                      />
                    </div>

                    <button type="submit" class="button">
                      Recevoir mon code
                    </button>
                  </form>
                </>
              )
              : (
                <>
                  <p class="hero__subtitle">
                    {sent
                      ? "Si cet e-mail est inscrit, vous allez recevoir un code à 6 chiffres. Saisissez-le ci-dessous."
                      : "Saisissez le code à 6 chiffres reçu par e-mail."}
                  </p>

                  {error && <p class="form-error" role="alert">{error}</p>}

                  <form method="POST" class="registration-form">
                    <input type="hidden" name="email" value={email} />

                    <div class="form-field">
                      <span class="lookup-card__label">E-mail</span>
                      <p class="code-step__email">{email}</p>
                    </div>

                    <div class="form-field">
                      <span class="lookup-card__label">
                        Code à 6 chiffres
                      </span>
                      <CodeInput name="code" length={CODE_LENGTH} />
                    </div>

                    <button type="submit" class="button">
                      Se connecter
                    </button>
                  </form>

                  <form method="POST" class="code-step__resend">
                    <input type="hidden" name="email" value={email} />
                    <button type="submit" class="link-button">
                      Renvoyer le code
                    </button>
                  </form>

                  <p class="hero__note">
                    <a href="/connexion">Utiliser un autre e-mail</a>
                  </p>
                </>
              )}
          </div>
        </section>
      </main>
    </>
  );
});
