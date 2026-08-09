import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import { Header } from "../components/Header.tsx";
import {
  getStreetAwakeningStatus,
  STREET_AWAKENING_THRESHOLD,
  type StreetAwakeningStatus,
} from "../db/streets.ts";
import RegistrationAddressFields from "../islands/RegistrationAddressFields.tsx";

const MAX_STREET_LENGTH = 80;
const MAX_CITY_LABEL_LENGTH = 120;

interface HomeData {
  street: string;
  cityId: number | null;
  cityLabel: string;
  status: StreetAwakeningStatus | null;
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

    return { data: { street, cityId, cityLabel, status } };
  },
});

export default define.page<typeof handler>(function Home({ data, state }) {
  const { street, cityId, cityLabel, status } = data as HomeData;
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
      <Header user={user} />
      <main>
        <section class="container hero" id="trouver-ma-rue">
          <div>
            <p class="hero__eyebrow">Créer du lien entre voisins</p>
            <h1 class="hero__title">
              Retrouvez vos voisins.
            </h1>
            <p class="hero__subtitle">
              NotreRue.fr aide les habitants d'une même rue à se rapprocher :
              partage, entraide, troc et sécurité collective. Une page privée,
              réservée aux gens qui vivent dans notre rue.
            </p>

            {user
              ? (
                <p class="hero__confirmation">
                  Bienvenue <strong>{user.login}</strong> ! {user.isAmbassador
                    ? "Vous êtes ambassadeur de "
                    : "Vous habitez "}
                  <strong>
                    {user.street.name}, {user.street.city.name}
                  </strong>.
                </p>
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
      `et s'allume à ${STREET_AWAKENING_THRESHOLD} foyers, alors inscrivez-vous et partagez à vos voisins`
    : isAwake
    ? `${housesCount} foyers y sont déjà inscrits. Rejoignez-les pour ` +
      "profiter du fil de votre rue."
    : `Elle s'allumera à ${STREET_AWAKENING_THRESHOLD} foyers inscrits. ` +
      "D'ici là, rien à lire, rien à subir : juste à partager à vos voisins pour atteindre l'objectif.";

  const countLabel = isAmbassadorSlot
    ? "0 foyer inscrit"
    : isAwake
    ? `${housesCount} foyers inscrits — seuil atteint`
    : remaining === 1
    ? `${housesCount} foyers inscrits sur ${STREET_AWAKENING_THRESHOLD} — il manque un foyer`
    : `${housesCount} foyers inscrits sur ${STREET_AWAKENING_THRESHOLD} — il en manque ${remaining}`;

  const joinLabel = isAmbassadorSlot
    ? "Devenir ambassadeur de cette rue"
    : "Rejoindre cette rue";

  return (
    <div class="street-status">
      <h2 class="street-status__title">{title}</h2>
      <p class="street-status__subtitle">{subtitle}</p>

      <div class="street-status__progress" aria-hidden="true">
        {Array.from({ length: STREET_AWAKENING_THRESHOLD }, (_, i) => (
          <span
            key={i}
            class={`street-status__slot ${
              i < housesCount ? "street-status__slot--filled" : ""
            }`}
          />
        ))}
      </div>
      <p class="street-status__count">{countLabel}</p>

      <a href={joinHref} class="button">{joinLabel}</a>
    </div>
  );
}
