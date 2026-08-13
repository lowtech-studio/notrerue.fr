import { Head } from "fresh/runtime";
import "../assets/pages/index.css" with { type: "css" };
import { define } from "../utils.ts";
import { Header } from "../components/Header.tsx";
import { StreetProgress } from "../components/StreetProgress.tsx";
import {
  getStreetAwakeningStatus,
  getStreetHousesStatus,
  STREET_AWAKENING_THRESHOLD,
  type StreetAwakeningStatus,
} from "../db/streets.ts";
import RegistrationAddressFields from "../islands/RegistrationAddressFields.tsx";
import { pluralizeCount } from "../utils/pluralize.ts";

const MAX_STREET_LENGTH = 80;
const MAX_CITY_LABEL_LENGTH = 120;

interface HomeData {
  street: string;
  cityId: number | null;
  cityLabel: string;
  status: StreetAwakeningStatus | null;
  /** Statut de la rue de l'habitant connecté, `null` si non connecté. */
  ownStreetStatus: { housesCount: number; isAwake: boolean } | null;
  /** Redirigé ici après /supprimer-compte (cf. routes/profil.tsx) — l'utilisateur vient d'être déconnecté, donc affiché seulement côté non connecté. */
  accountDeleted: boolean;
}

export const handler = define.handlers({
  async GET(ctx) {
    const cityIdRaw = Number(ctx.url.searchParams.get("cityId"));
    const cityId = Number.isInteger(cityIdRaw) && cityIdRaw > 0
      ? cityIdRaw
      : null;
    const cityLabel = (ctx.url.searchParams.get("city") ?? "").trim().slice(
      0,
      MAX_CITY_LABEL_LENGTH,
    );
    // "street" est le paramètre courant (choisi via les suggestions
    // ville+rue) ; "rue" reste lu pour les anciens liens partagés
    // /?rue=... (sans ville : la rue ne peut pas y être désambiguïsée).
    const rawStreet = ctx.url.searchParams.get("street") ??
      ctx.url.searchParams.get("rue") ?? "";
    const street = rawStreet.trim().slice(0, MAX_STREET_LENGTH);

    const status = cityId && street
      ? await getStreetAwakeningStatus(cityId, street)
      : null;

    const ownStreetStatus = ctx.state.user
      ? await getStreetHousesStatus(ctx.state.user.street.id)
      : null;

    const accountDeleted = ctx.url.searchParams.get("compte_supprime") === "1";

    return {
      data: {
        street,
        cityId,
        cityLabel,
        status,
        ownStreetStatus,
        accountDeleted,
      },
    };
  },
});

export default define.page<typeof handler>(function Home({ data, state }) {
  const { street, cityId, cityLabel, status, ownStreetStatus, accountDeleted } =
    data as HomeData;
  const { user } = state;

  const joinHref = cityId
    ? `/rejoindre?cityId=${cityId}&city=${encodeURIComponent(cityLabel)}` +
      `&street=${encodeURIComponent(street)}`
    : "/rejoindre";

  return (
    <>
      <Head>
        <title>NotreRue.fr — Créer du lien entre voisins</title>
      </Head>
      <Header
        user={user}
        isStreetAwake={state.isStreetAwake}
        theme={state.theme}
        hasUnreadMessages={state.hasUnreadMessages}
      />
      <main>
        <section class="container hero" id="trouver-ma-rue">
          <div>
            <p class="hero__eyebrow">
              {user
                ? (
                  <>
                    Bienvenue <strong>{user.login}</strong> ! {user.isAmbassador
                      ? "Vous êtes ambassadeur de "
                      : "Vous habitez "}
                    <strong>
                      {user.street.name}, {user.street.city.name}
                    </strong>.
                  </>
                )
                : "Créer du lien entre voisins"}
            </p>

            {!user && (
              <>
                {accountDeleted && (
                  <p class="hero__confirmation">
                    Votre compte, votre foyer et vos publications ont été
                    supprimés.
                  </p>
                )}
                <h1 class="hero__title">
                  Partagez, échangez et connectez-vous avec vos voisins!
                </h1>
                <p class="hero__subtitle">
                  100% Local, 100% Réel :<br />
                  Un dentiste à conseiller? Un outil à prêter? Un événement de
                  quartier à partager? ...
                </p>
              </>
            )}

            {user
              ? (
                <>
                  {ownStreetStatus && !ownStreetStatus.isAwake && (
                    <div class="street-status">
                      <h2 class="street-status__title">
                        Votre rue dort encore.
                      </h2>
                      <p class="street-status__subtitle">
                        Tant qu'elle n'est pas allumée, rien à lire ni à publier
                        : la seule action utile est d'inviter vos voisins à vous
                        rejoindre.
                      </p>
                      <StreetProgress
                        housesCount={ownStreetStatus.housesCount}
                        threshold={STREET_AWAKENING_THRESHOLD}
                      />
                      <p class="street-status__count">
                        {pluralizeCount(
                          ownStreetStatus.housesCount,
                          "foyer inscrit",
                          "foyers inscrits",
                        )} sur {STREET_AWAKENING_THRESHOLD}
                      </p>
                      <a href="/inviter" class="button">
                        Inviter mes voisins
                      </a>
                    </div>
                  )}

                  {ownStreetStatus && ownStreetStatus.isAwake && (
                    <div class="street-status">
                      <h2 class="street-status__title">
                        Votre rue est allumée !
                      </h2>
                      <p class="street-status__headline">
                        {pluralizeCount(
                          ownStreetStatus.housesCount,
                          "foyer vous a",
                          "foyers vous ont",
                        )} rejoint.
                      </p>
                      <p class="street-status__subtitle">
                        Direction le fil pour voir les demandes de vos voisins
                        et publier les vôtres.
                      </p>
                      <a href="/fil" class="button">
                        Voir le fil de ma rue
                      </a>
                    </div>
                  )}
                </>
              )
              : (
                <>
                  {status
                    ? (
                      <StreetStatusCard
                        streetName={status.street?.name ?? street}
                        status={status}
                        joinHref={joinHref}
                      />
                    )
                    : street !== "" && (
                      <p class="hero__confirmation">
                        Merci ! Nous avons bien noté la rue{" "}
                        <strong>{street}</strong>. Dès que d'autres habitants la
                        rejoignent, sa page s'active.
                      </p>
                    )}

                  <div class="lookup-card">
                    <form class="registration-form" method="GET">
                      <RegistrationAddressFields
                        initialCityId={cityId}
                        initialCityLabel={cityLabel}
                        initialStreet={street}
                      />
                      <button type="submit" class="button">
                        Trouver ma rue
                      </button>
                    </form>
                  </div>
                  <p class="hero__note">
                    Gratuit · réservé aux habitants de la rue
                  </p>
                </>
              )}
          </div>

          <aside class="trust-card" id="confidentialite">
            <h2 class="trust-card__title">
              Ce que vous ne verrez jamais ici
            </h2>
            <ul class="trust-card__list">
              <li>Votre nom de famille, votre adresse exacte, votre âge</li>
              <li>Le contenu d'une rue, si vous n'y habitez pas</li>
              <li>
                Vos données revendues à des tiers ou stockées en dehors de
                France
              </li>
            </ul>
          </aside>
        </section>

        {!user && (
          <section
            class="container preview-wall"
            aria-labelledby="apercu-titre"
          >
            <h2 id="apercu-titre" class="preview-wall__title">
              À quoi ressemble une rue allumée ?
            </h2>
            <p class="preview-wall__subtitle">
              Un aperçu du fil de votre rue une fois quelques voisins inscrits :
              demandes, coups de main, infos pratiques, recommandations et
              petits rendez-vous entre voisins.
            </p>
            <div class="preview-wall__grid">
              <img
                src="/screenshots/fil.jpg"
                alt="Fil de la rue : une demande « Je cherche » (perceuse à emprunter) avec les réponses des voisins"
                width={465}
                height={363}
                loading="lazy"
                class="preview-wall__img"
              />
              <img
                src="/screenshots/petit-job.jpg"
                alt="Petit job proposé par un voisin : babysitting le samedi soir"
                width={461}
                height={300}
                loading="lazy"
                class="preview-wall__img"
              />
              <img
                src="/screenshots/information.jpg"
                alt="Information pratique publiée par un voisin : une coupure d'eau annoncée à l'avance"
                width={458}
                height={228}
                loading="lazy"
                class="preview-wall__img"
              />
              <img
                src="/screenshots/recommandations.jpg"
                alt="Recommandations d'artisans partagées entre voisins : plombier, dentiste, garde d'enfants"
                width={622}
                height={475}
                loading="lazy"
                class="preview-wall__img"
              />
              <img
                src="/screenshots/evenements.jpg"
                alt="Rendez-vous entre voisins : café des voisins et accueil d'une nouvelle famille"
                width={672}
                height={344}
                loading="lazy"
                class="preview-wall__img"
              />
            </div>
          </section>
        )}
      </main>
      <footer class="site-footer">
        <p class="container site-footer__text">
          NotreRue.fr — « Nous rapprocher les uns des autres » | Souveraineté —
          Hebergement 100% Français 🇫🇷 et Code 100% Open Source pas
          d'entourloupe !
        </p>
      </footer>
    </>
  );
});

interface StreetStatusCardProps {
  streetName: string;
  status: StreetAwakeningStatus;
  joinHref: string;
}

/**
 * Statut d'éveil de la rue recherchée : combien de foyers il manque pour
 * qu'elle « s'allume », et une invitation à s'inscrire dont le texte annonce
 * honnêtement si ce sera comme ambassadeur (rue encore vide) ou comme
 * habitant (d'autres l'ont déjà rejointe) — cf. backlog « objectif
 * atteignable ».
 */
function StreetStatusCard(
  { streetName, status, joinHref }: StreetStatusCardProps,
) {
  const { housesCount, remaining, isAmbassadorSlot, isAwake } = status;

  const title = isAmbassadorSlot
    ? "Personne n'habite encore cette rue."
    : isAwake
    ? `La rue "${streetName}" est déjà allumée !`
    : remaining === 1
    ? "Il manque un foyer pour réveiller la rue."
    : `La rue "${streetName}" dort encore.`;

  const subtitle = isAmbassadorSlot
    ? `Vous êtes le premier. Une rue s'ouvre à partir d'un seul habitant, ` +
      `et s'allume à ${
        pluralizeCount(STREET_AWAKENING_THRESHOLD, "foyer", "foyers")
      }, alors inscrivez-vous et partagez à vos voisins`
    : isAwake
    ? `${
      pluralizeCount(
        housesCount,
        "foyer y est déjà inscrit",
        "foyers y sont déjà inscrits",
      )
    }. Rejoignez-les pour profiter du fil de votre rue.`
    : `Elle s'allumera à ${
      pluralizeCount(
        STREET_AWAKENING_THRESHOLD,
        "foyer inscrit",
        "foyers inscrits",
      )
    }. D'ici là, rien à lire, rien à subir : juste à partager à vos voisins pour atteindre l'objectif.`;

  const countLabel = isAmbassadorSlot
    ? "0 foyer inscrit"
    : isAwake
    ? `${
      pluralizeCount(housesCount, "foyer inscrit", "foyers inscrits")
    } — seuil atteint`
    : remaining === 1
    ? `${
      pluralizeCount(housesCount, "foyer inscrit", "foyers inscrits")
    } sur ${STREET_AWAKENING_THRESHOLD} — il manque un foyer`
    : `${
      pluralizeCount(housesCount, "foyer inscrit", "foyers inscrits")
    } sur ${STREET_AWAKENING_THRESHOLD} — il en manque ${remaining}`;

  const joinLabel = isAmbassadorSlot
    ? "Devenir ambassadeur de cette rue"
    : "Rejoindre cette rue";

  return (
    <div class="street-status">
      <h2 class="street-status__title">{title}</h2>
      <p class="street-status__subtitle">{subtitle}</p>

      <StreetProgress
        housesCount={housesCount}
        threshold={STREET_AWAKENING_THRESHOLD}
      />
      <p class="street-status__count">{countLabel}</p>

      <a href={joinHref} class="button">{joinLabel}</a>
    </div>
  );
}
