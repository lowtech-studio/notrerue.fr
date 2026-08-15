import { Head } from "fresh/runtime";
import "../assets/pages/inviter.css" with { type: "css" };
import { define } from "../utils.ts";
import type { SessionUser } from "../utils.ts";
import { Header } from "../components/Header.tsx";
import { ChatBubbleIcon, MailIcon, PrinterIcon } from "../components/icons.tsx";
import { QrCode } from "../components/QrCode.tsx";
import { StreetProgress } from "../components/StreetProgress.tsx";
import {
  getStreetHousesStatus,
  STREET_AWAKENING_THRESHOLD,
  type StreetHousesStatus,
} from "../db/streets.ts";
import { sendInviteEmail } from "../email/brevo.ts";
import { MAX_EMAIL_LENGTH } from "../utils/validation.ts";
import { createCooldown } from "../utils/rate_limit.ts";
import { pluralizeCount } from "../utils/pluralize.ts";
import PrintButton from "../islands/PrintButton.tsx";

/** Délai minimal entre deux invitations envoyées par un même habitant (anti-spam). */
const INVITE_RESEND_MIN_SECONDS = 10;
const inviteCooldown = createCooldown(INVITE_RESEND_MIN_SECONDS * 1000);

interface InviterCore {
  streetName: string;
  cityName: string;
  status: StreetHousesStatus;
  /** Lien absolu (nécessaire hors du site : e-mail, WhatsApp, QR code). */
  joinUrl: string;
  message: string;
}

interface InviterData extends InviterCore {
  inviteError: string | null;
  /** Adresse à laquelle une invitation vient d'être envoyée (bandeau de confirmation). */
  invitedEmail: string | null;
}

async function loadInviterCore(
  user: SessionUser,
  origin: string,
): Promise<InviterCore> {
  const status = await getStreetHousesStatus(user.street.id);
  // Pas de paramètre `city` séparé : /rejoindre reconstruit le libellé
  // ville depuis `cityId` (base de données), donc inutile ici — lien plus
  // court à recopier depuis un flyer imprimé (cf. revue). `URLSearchParams`
  // encode aussi les espaces en `+` plutôt qu'en `%20`, plus court que
  // l'`encodeURIComponent` manuel précédent, sans rien changer au décodage
  // côté serveur (`URLSearchParams`/`ctx.url.searchParams` des deux côtés).
  const joinParams = new URLSearchParams({
    cityId: String(user.street.city.id),
    street: user.street.name,
  });
  const joinUrl = `${origin}/rejoindre?${joinParams}`;

  const message = `Salut ! Je m'inscris sur NotreRue.fr pour qu'on ` +
    `s'entraide entre voisins de la ${user.street.name} ` +
    `(${user.street.city.name}) : partage, coup de main, bons plans. ` +
    `Rejoins-moi ici : ${joinUrl}`;

  return {
    streetName: user.street.name,
    cityName: user.street.city.name,
    status,
    joinUrl,
    message,
  };
}

export const handler = define.handlers({
  async GET(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.redirect("/connexion");

    const core = await loadInviterCore(user, ctx.url.origin);
    const invitedEmail = ctx.url.searchParams.get("invited");

    return { data: { ...core, inviteError: null, invitedEmail } };
  },

  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.redirect("/connexion");

    const form = await ctx.req.formData();
    const neighborEmail = String(form.get("neighborEmail") ?? "").trim()
      .slice(0, MAX_EMAIL_LENGTH);
    const core = await loadInviterCore(user, ctx.url.origin);

    if (!neighborEmail.includes("@")) {
      return {
        data: {
          ...core,
          inviteError: "Merci de renseigner un e-mail valide.",
          invitedEmail: null,
        },
      };
    }

    if (inviteCooldown.isActive(user.id)) {
      return {
        data: {
          ...core,
          inviteError:
            "Merci de patienter quelques secondes avant d'envoyer une autre invitation.",
          invitedEmail: null,
        },
      };
    }

    try {
      await sendInviteEmail({
        to: neighborEmail,
        inviterLogin: user.login,
        inviterEmail: user.email,
        streetName: user.street.name,
        cityName: user.street.city.name,
        joinUrl: core.joinUrl,
      });
      inviteCooldown.record(user.id);
    } catch (error) {
      console.error("Échec d'envoi d'invitation via Brevo :", error);
      return {
        data: {
          ...core,
          inviteError:
            "Impossible d'envoyer l'invitation pour le moment. Réessayez " +
            "plus tard, ou utilisez WhatsApp ou le kit papier.",
          invitedEmail: null,
        },
      };
    }

    return ctx.redirect(
      `/inviter?invited=${encodeURIComponent(neighborEmail)}`,
    );
  },
});

/**
 * Sous-titre de /inviter : rappelle honnêtement où en est la rue, et pourquoi
 * inviter est la seule action qui compte tant qu'elle n'est pas allumée.
 */
function buildSubtitle(streetName: string, status: StreetHousesStatus) {
  const { housesCount, remaining, isAwake } = status;
  if (isAwake) {
    return `${
      pluralizeCount(
        housesCount,
        "foyer est déjà inscrit",
        "foyers sont déjà inscrits",
      )
    } sur la ${streetName}. Continuez à inviter pour que l'entraide reste vivante.`;
  }
  if (remaining === 1) {
    return `Il manque un seul foyer pour que la ${streetName} s'allume. ` +
      "Tant qu'elle dort, la seule chose à faire ici : inviter.";
  }
  return `${pluralizeCount(housesCount, "foyer inscrit", "foyers inscrits")} ` +
    `sur ${STREET_AWAKENING_THRESHOLD} sur la ${streetName}. Tant qu'elle ` +
    "dort, la seule chose à faire ici : inviter.";
}

export default define.page<typeof handler>(function Inviter({ data, state }) {
  const {
    streetName,
    cityName,
    status,
    joinUrl,
    message,
    inviteError,
    invitedEmail,
  } = data as InviterData;
  const { housesCount, isAwake } = status;
  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(message)}`;

  return (
    <>
      <Head>
        <title>Inviter mes voisins — NotreRue.fr</title>
        {
          /* Contenu personnalisé et privé : jamais indexable (cf. fil.tsx
          pour le raisonnement complet). */
        }
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <div class="no-print">
        <Header
          user={state.user}
          isStreetAwake={state.isStreetAwake}
          theme={state.theme}
          hasUnreadMessages={state.hasUnreadMessages}
        />
      </div>
      <main>
        <section class="container hero hero--single page-wide">
          <div class="no-print">
            <h1 class="hero__title">Invitez vos voisins</h1>
            <p class="hero__subtitle">{buildSubtitle(streetName, status)}</p>

            {!isAwake && (
              <StreetProgress
                housesCount={housesCount}
                threshold={STREET_AWAKENING_THRESHOLD}
              />
            )}

            {invitedEmail && (
              <p class="hero__confirmation">
                Invitation envoyée à <strong>{invitedEmail}</strong> !
              </p>
            )}
            {inviteError && (
              <p class="form-error" role="alert">{inviteError}</p>
            )}

            <div class="invite-actions">
              <form method="POST" class="invite-email-form">
                <label class="lookup-card__label" for="neighborEmail">
                  E-mail du voisin à inviter
                </label>
                <input
                  id="neighborEmail"
                  name="neighborEmail"
                  type="email"
                  class="lookup-form__input"
                  placeholder="voisin@exemple.fr"
                  maxlength={MAX_EMAIL_LENGTH}
                  autocomplete="off"
                  required
                />
                <button type="submit" class="button">
                  <MailIcon /> Inviter par e-mail
                </button>
              </form>

              <p class="invite-actions__divider">
                <span>ou</span>
              </p>

              <a class="button button--secondary" href={whatsappHref}>
                <ChatBubbleIcon /> Inviter par WhatsApp
              </a>

              <p class="invite-actions__divider">
                <span>ou</span>
              </p>

              <PrintButton
                class="button button--secondary no-print"
                target="kit"
              >
                <PrinterIcon /> Imprimer le kit papier (3 invitations)
              </PrintButton>

              <p class="invite-actions__divider">
                <span>ou</span>
              </p>

              <PrintButton
                class="button button--secondary no-print"
                target="sticker"
              >
                <PrinterIcon /> Imprimer l'autocollant boîte aux lettres
              </PrintButton>
            </div>
          </div>

          {
            /* Jamais affichées à l'écran (cf. retour utilisateur : ne
              montrer que les 4 boutons) — seuls les boutons "Imprimer"
              plus haut les révèlent, via `@media print` (cf.
              assets/pages/inviter.css). */
          }
          <div class="kit-sheet">
            <div class="kit-sheet__grid">
              {[0, 1, 2].map((i) => (
                <div class="invite-flyer" key={i}>
                  <QrCode
                    value={joinUrl}
                    cellSize={5}
                    class="invite-flyer__qr"
                  />
                  <p class="invite-flyer__text">
                    👋 Bonjour voisin·e,{"\n\n"}
                    On lance NotreRue.fr sur la {streetName}{" "}
                    : un espace privé pour s'entraider entre voisins (partage,
                    coup de main, bons plans, recommandations).{"\n\n"}
                    Scannez ce QR code pour nous rejoindre, ou tapez :
                  </p>
                  <p class="invite-flyer__url">{joinUrl}</p>
                  <p class="invite-flyer__signature">
                    — Vos voisins de la {streetName}, {cityName}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div class="sticker-sheet">
            <div class="sticker">
              <QrCode value={joinUrl} cellSize={5} class="sticker__qr" />
              <p class="sticker__text">
                👋 Cette maison s'entraide avec ses voisins sur NotreRue.fr
              </p>
              <p class="sticker__url">{joinUrl}</p>
            </div>
          </div>
        </section>
      </main>
    </>
  );
});
