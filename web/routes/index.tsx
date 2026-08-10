import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import { Header } from "../components/Header.tsx";
import { StreetProgress } from "../components/StreetProgress.tsx";
import {
  getStreetAwakeningStatus,
  getStreetHousesStatus,
  STREET_AWAKENING_THRESHOLD,
  type StreetAwakeningStatus,
} from "../db/streets.ts";
import {
  createPost,
  isPostType,
  MAX_POST_CONTENT_LENGTH,
  type PostType,
} from "../db/posts.ts";
import { containsBlockedContent } from "../moderation/blocklist.ts";
import RegistrationAddressFields from "../islands/RegistrationAddressFields.tsx";

const MAX_STREET_LENGTH = 80;
const MAX_CITY_LABEL_LENGTH = 120;

const POST_TYPE_LABELS: Record<PostType, string> = {
  cherche: "Je cherche",
  propose: "Je propose",
  informe: "J'informe",
};

interface HomeData {
  street: string;
  cityId: number | null;
  cityLabel: string;
  status: StreetAwakeningStatus | null;
  /** Statut de la rue de l'habitant connecté, `null` si non connecté. */
  ownStreetStatus: { housesCount: number; isAwake: boolean } | null;
  postError: string | null;
  postPublished: boolean;
  /** Valeurs re-soumises telles quelles si la publication échoue. */
  postType: PostType;
  postContent: string;
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

    return {
      data: {
        street,
        cityId,
        cityLabel,
        status,
        ownStreetStatus,
        postError: null,
        postPublished: ctx.url.searchParams.get("published") === "1",
        postType: "cherche",
        postContent: "",
      },
    };
  },

  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.redirect("/connexion");

    const ownStreetStatus = await getStreetHousesStatus(user.street.id);
    const emptyResult = {
      street: "",
      cityId: null,
      cityLabel: "",
      status: null,
      ownStreetStatus,
      postPublished: false,
    };

    const form = await ctx.req.formData();
    const rawType = String(form.get("type") ?? "");
    const postType: PostType = isPostType(rawType) ? rawType : "cherche";
    const content = String(form.get("content") ?? "").trim().slice(
      0,
      MAX_POST_CONTENT_LENGTH,
    );

    // Ne devrait pas arriver via l'UI (le formulaire n'est affiché que rue
    // allumée), mais vérifié aussi côté serveur : tant que la rue dort, la
    // seule action offerte est d'inviter (cf. backlog).
    if (!ownStreetStatus.isAwake) {
      return ctx.redirect("/");
    }

    if (!isPostType(rawType) || !content) {
      return {
        data: {
          ...emptyResult,
          postError: "Merci de choisir un type et d'écrire votre demande.",
          postType,
          postContent: content,
        },
      };
    }

    if (containsBlockedContent(content)) {
      return {
        data: {
          ...emptyResult,
          postError:
            "Merci de reformuler : ce message contient des termes non autorisés.",
          postType,
          postContent: content,
        },
      };
    }

    await createPost({ userId: user.id, type: postType, content });

    return ctx.redirect("/?published=1");
  },
});

export default define.page<typeof handler>(function Home({ data, state }) {
  const {
    street,
    cityId,
    cityLabel,
    status,
    ownStreetStatus,
    postError,
    postPublished,
    postType,
    postContent,
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
      </Head>
      <Header user={user} />
      <main>
        <section class="container hero" id="trouver-ma-rue">
          <div>
            <p class="hero__eyebrow">Créer du lien entre voisins</p>
            <h1 class="hero__title">
              Partagez, échangez et connectez-vous avec vos voisins!
            </h1>
            <p class="hero__subtitle">
              100% Local, 100% Réel :<br />
              Un dentiste à conseiller? Un outil à prêter? Un événement de
              quartier à partager? ...
            </p>

            {user
              ? (
                <>
                  <p class="hero__confirmation">
                    Bienvenue <strong>{user.login}</strong> ! {user.isAmbassador
                      ? "Vous êtes ambassadeur de "
                      : "Vous habitez "}
                    <strong>
                      {user.street.name}, {user.street.city.name}
                    </strong>.
                  </p>

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
                        {ownStreetStatus.housesCount} foyers inscrits sur{" "}
                        {STREET_AWAKENING_THRESHOLD}
                      </p>
                      <a href="/inviter" class="button">
                        Inviter mes voisins
                      </a>
                    </div>
                  )}

                  {ownStreetStatus && ownStreetStatus.isAwake && (
                    <PublishPostForm
                      error={postError}
                      published={postPublished}
                      type={postType}
                      content={postContent}
                    />
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

        <section class="container preview-wall" aria-labelledby="apercu-titre">
          <h2 id="apercu-titre" class="preview-wall__title">
            À quoi ressemble une rue allumée ?
          </h2>
          <p class="preview-wall__subtitle">
            Un aperçu du fil de votre rue une fois quelques voisins inscrits :
            demandes, coups de main, infos pratiques, recommandations et petits
            rendez-vous entre voisins.
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

      <StreetProgress
        housesCount={housesCount}
        threshold={STREET_AWAKENING_THRESHOLD}
      />
      <p class="street-status__count">{countLabel}</p>

      <a href={joinHref} class="button">{joinLabel}</a>
    </div>
  );
}

interface PublishPostFormProps {
  error: string | null;
  published: boolean;
  type: PostType;
  content: string;
}

/**
 * Formulaire de publication : un type (Je cherche / Je propose / J'informe)
 * et une phrase, pensé pour être rempli en moins de 30 secondes (cf.
 * backlog). Seule action mise en avant une fois la rue allumée, comme
 * inviter était la seule avant.
 */
function PublishPostForm(
  { error, published, type, content }: PublishPostFormProps,
) {
  return (
    <div class="compose-post">
      <h2 class="compose-post__title">Quoi de neuf sur votre rue ?</h2>

      {published && (
        <p class="hero__confirmation">Votre demande a été publiée !</p>
      )}
      {error && <p class="form-error" role="alert">{error}</p>}

      <form method="POST" class="compose-post__form">
        <div
          class="compose-post__types"
          role="radiogroup"
          aria-label="Type de publication"
        >
          {(Object.keys(POST_TYPE_LABELS) as PostType[]).map((value) => (
            <label key={value} class="compose-post__type">
              <input
                type="radio"
                name="type"
                value={value}
                checked={type === value}
              />
              {POST_TYPE_LABELS[value]}
            </label>
          ))}
        </div>

        <input
          type="text"
          name="content"
          class="lookup-form__input"
          placeholder="Une phrase, c'est tout : « Je cherche une perceuse ce week-end »"
          maxlength={MAX_POST_CONTENT_LENGTH}
          value={content}
          autocomplete="off"
          required
        />

        <button type="submit" class="button">Publier</button>
      </form>
    </div>
  );
}
