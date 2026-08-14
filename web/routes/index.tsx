import { Head } from "fresh/runtime";
import "../assets/pages/index.css" with { type: "css" };
import { define, isUserVerified } from "../utils.ts";
import { Header } from "../components/Header.tsx";
import { StreetProgress } from "../components/StreetProgress.tsx";
import {
  getStreetAwakeningStatus,
  getStreetHousesStatus,
  STREET_AWAKENING_THRESHOLD,
  type StreetAwakeningStatus,
} from "../db/streets.ts";
import {
  listPendingNeighbors,
  listVerifiedNeighbors,
  type PendingNeighbor,
  type VerifiedNeighbor,
} from "../db/vouches.ts";
import RegistrationAddressFields from "../islands/RegistrationAddressFields.tsx";
import { pluralizeCount } from "../utils/pluralize.ts";
import { formatRelativeDate } from "../utils/relative_date.ts";
import { jsonLd } from "../utils/seo.ts";

/**
 * Questions les plus probables d'un visiteur qui ne connaît pas encore
 * NotreRue.fr (gratuité, différence avec un groupe WhatsApp/Facebook,
 * confidentialité, âge minimum...) — affichées ci-dessous en `<details>`
 * natifs (cf. mémoire « no-js-disclosure-pattern » : accordéon sans JS,
 * même logique que `.profil-danger-zone` sur /profil) et reprises telles
 * quelles dans `FAQ_JSON_LD` : le texte visible et les données structurées
 * doivent rester identiques (exigence Google pour le rich result
 * `FAQPage`), d'où une seule source pour les deux.
 */
const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "NotreRue.fr est-il vraiment gratuit ?",
    answer:
      "Oui, entièrement gratuit, sans publicité et sans abonnement caché. Le site ne vit pas de la revente de vos données.",
  },
  {
    question:
      "Quelle différence avec un groupe WhatsApp ou une page Facebook de quartier ?",
    answer:
      "Seuls les voisins d'une même rue, validés par un habitant déjà inscrit, peuvent lire et publier — pas de groupe qui grossit à l'infini ni de fil noyé sous la publicité. Un seul fil, trois types de message (Je cherche / Je propose / J'informe), rien de plus.",
  },
  {
    question: "Mes données personnelles sont-elles en sécurité ?",
    answer:
      "Votre nom de famille, votre adresse exacte et votre âge ne sont jamais demandés ni affichés aux autres voisins. Hébergement 100% français, code source 100% ouvert.",
  },
  {
    question: "Comment savoir si ma rue est déjà sur NotreRue.fr ?",
    answer:
      "Indiquez votre ville et votre rue depuis la page d'accueil : si des voisins y sont déjà inscrits, vous voyez immédiatement combien, sinon vous devenez le premier ambassadeur de votre rue.",
  },
  {
    question: "Qui peut s'inscrire sur NotreRue.fr ?",
    answer:
      "Toute personne d'au moins 15 ans habitant réellement la rue concernée — un voisin déjà vérifié doit confirmer votre adresse avant que vous puissiez publier ou écrire à quelqu'un.",
  },
  {
    question: "Faut-il télécharger une application ?",
    answer:
      "Non : NotreRue.fr fonctionne directement dans le navigateur, et peut aussi s'installer en un geste comme une application (PWA) pour y accéder plus vite.",
  },
];

const FAQ_JSON_LD = jsonLd({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": FAQ_ITEMS.map(({ question, answer }) => ({
    "@type": "Question",
    "name": question,
    "acceptedAnswer": { "@type": "Answer", "text": answer },
  })),
});

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
  /**
   * Voisins de la même rue pas encore vérifiés (cf. db/vouches.ts, backlog
   * « prouver que les voisins habitent bien dans la même rue ») — vide si
   * non connecté ou si l'habitant connecté n'est lui-même pas encore
   * vérifié (il ne peut vouch pour personne tant que ce n'est pas le cas).
   */
  pendingNeighbors: PendingNeighbor[];
  /**
   * Voisins de la même rue déjà vérifiés (cf. db/vouches.ts) — affichés à un
   * compte lui-même en attente pour qu'il sache qui solliciter (cf. retour
   * utilisateur « comment identifier un voisin... pour demander une
   * validation ? ») : vide si non connecté ou si l'habitant connecté est
   * déjà vérifié (il n'en a pas besoin).
   */
  verifiedNeighbors: VerifiedNeighbor[];
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

    // Seul un habitant déjà vérifié peut vouch pour un voisin (cf.
    // db/vouches.ts) : inutile de charger la liste sinon, il ne verrait de
    // toute façon pas les boutons de validation.
    const pendingNeighbors = ctx.state.user && isUserVerified(ctx.state.user)
      ? await listPendingNeighbors(ctx.state.user.street.id)
      : [];
    // À l'inverse : un compte en attente a besoin de savoir qui, sur sa rue,
    // peut le valider (cf. retour utilisateur) — un habitant déjà vérifié
    // n'en a pas besoin.
    const verifiedNeighbors = ctx.state.user && !isUserVerified(ctx.state.user)
      ? await listVerifiedNeighbors(ctx.state.user.street.id)
      : [];

    const accountDeleted = ctx.url.searchParams.get("compte_supprime") === "1";

    return {
      data: {
        street,
        cityId,
        cityLabel,
        status,
        ownStreetStatus,
        accountDeleted,
        pendingNeighbors,
        verifiedNeighbors,
      },
    };
  },
});

export default define.page<typeof handler>(function Home({ data, state }) {
  const {
    street,
    cityId,
    cityLabel,
    status,
    ownStreetStatus,
    accountDeleted,
    pendingNeighbors,
    verifiedNeighbors,
  } = data as HomeData;
  const { user } = state;

  const joinHref = cityId
    ? `/rejoindre?cityId=${cityId}&city=${encodeURIComponent(cityLabel)}` +
      `&street=${encodeURIComponent(street)}`
    : "/rejoindre";

  return (
    <>
      <Head>
        <title>NotreRue.fr — Créer du lien entre voisins</title>
        {
          /* FAQPage : uniquement quand la FAQ correspondante est bien
          rendue plus bas (visiteur non connecté) — cf. FAQ_ITEMS. */
        }
        {!user && (
          <script
            type="application/ld+json"
            // JSON-LD statique/auteur, cf. le raisonnement dans _app.tsx.
            // deno-lint-ignore react-no-danger
            dangerouslySetInnerHTML={{ __html: FAQ_JSON_LD }}
          />
        )}
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
                  {!isUserVerified(user) && (
                    <div class="street-status street-status--pending">
                      <h2 class="street-status__title">
                        Votre compte est en attente de validation
                      </h2>
                      <p class="street-status__subtitle">
                        Un voisin déjà inscrit doit confirmer que vous habitez
                        bien {user.street.name}{" "}
                        avant que vous puissiez publier, tapper ou écrire à
                        quelqu'un — vous pouvez déjà consulter le fil en
                        attendant.
                      </p>
                      {verifiedNeighbors.length > 0
                        ? (
                          <>
                            <p class="street-status__subtitle">
                              Voisins déjà inscrits et vérifiés sur{" "}
                              {user.street.name}{" "}
                              — demandez à l'un d'eux de vous valider (en
                              personne, ou en lui montrant cette page) :
                            </p>
                            <ul class="verified-neighbors">
                              {verifiedNeighbors.map((neighbor) => (
                                <li
                                  key={neighbor.id}
                                  class="verified-neighbors__item"
                                >
                                  {neighbor.login}
                                </li>
                              ))}
                            </ul>
                          </>
                        )
                        : (
                          <p class="street-status__subtitle">
                            Personne n'est encore vérifié sur votre rue pour
                            l'instant — dès qu'un voisin le sera, il pourra vous
                            valider.
                          </p>
                        )}
                    </div>
                  )}

                  {isUserVerified(user) && pendingNeighbors.length > 0 && (
                    <div class="street-status">
                      <h2 class="street-status__title">
                        {pluralizeCount(
                          pendingNeighbors.length,
                          "voisin attend",
                          "voisins attendent",
                        )} d'être validé{pendingNeighbors.length > 1 ? "s" : ""}
                      </h2>
                      <p class="street-status__subtitle">
                        Vous les connaissez ? Confirmez qu'ils habitent bien
                        {" "}
                        {user.street.name}.
                      </p>
                      <ul class="pending-neighbors">
                        {pendingNeighbors.map((neighbor) => (
                          <li key={neighbor.id} class="pending-neighbors__item">
                            <span class="pending-neighbors__login">
                              {neighbor.login}
                            </span>
                            <span class="pending-neighbors__date">
                              inscrit {formatRelativeDate(neighbor.createdAt)}
                            </span>
                            <form method="POST" action="/valider-voisin">
                              <input
                                type="hidden"
                                name="voucheeId"
                                value={neighbor.id}
                              />
                              <button
                                type="submit"
                                class="button button--secondary pending-neighbors__confirm"
                              >
                                Je confirme, c'est mon voisin
                              </button>
                            </form>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

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

        {!user && (
          <section
            class="container faq"
            aria-labelledby="faq-titre"
          >
            <h2 id="faq-titre" class="faq__title">
              Questions fréquentes
            </h2>
            <div class="faq__list">
              {FAQ_ITEMS.map(({ question, answer }) => (
                <details key={question} class="faq__item">
                  <summary class="faq__question">{question}</summary>
                  <p class="faq__answer">{answer}</p>
                </details>
              ))}
            </div>
          </section>
        )}
      </main>
      <footer class="site-footer">
        <p class="container site-footer__text">
          NotreRue.fr — « Nous rapprocher les uns des autres » | Souveraineté —
          Hebergement 100% Français 🇫🇷 et{" "}
          <a
            href="https://github.com/lowtech-studio/notrerue.fr"
            target="_blank"
            rel="noopener noreferrer"
            class="site-footer__link"
          >
            Code 100% Open Source
          </a>{" "}
          pas d'entourloupe !
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
