import { Head } from "fresh/runtime";
import "../assets/pages/fil.css" with { type: "css" };
import { define, isUserVerified } from "../utils.ts";
import { Header } from "../components/Header.tsx";
import { ImageIcon, MailIcon } from "../components/icons.tsx";
import { getStreetHousesStatus } from "../db/streets.ts";
import {
  computeExpiresAt,
  createPost,
  isPostDuration,
  isPostType,
  listStreetPosts,
  MAX_POST_CONTENT_LENGTH,
  MAX_POST_DURATION_MONTHS,
  MAX_SEARCH_LENGTH,
  MIN_POST_DURATION_MONTHS,
  type PostDuration,
  type PostType,
  type StreetPost,
  TAP_LABELS,
} from "../db/posts.ts";
import {
  listCommentsByPost,
  MAX_COMMENT_CONTENT_LENGTH,
  type PostComment,
} from "../db/comments.ts";
import { containsBlockedContent } from "../moderation/blocklist.ts";
import {
  countTapsByPost,
  findTappedPostIds,
  listTappers,
  type Tapper,
} from "../db/taps.ts";
import { formatRelativeDate } from "../utils/relative_date.ts";
import {
  MAX_IMAGE_UPLOAD_BYTES,
  resizeAndEncodeImage,
  UnsupportedImageError,
} from "../utils/image.ts";
import CharacterCounter from "../islands/CharacterCounter.tsx";
import PostTypePlaceholder from "../islands/PostTypePlaceholder.tsx";
import ImageDropzone from "../islands/ImageDropzone.tsx";

const POST_TYPE_LABELS: Record<PostType, string> = {
  cherche: "Je cherche",
  propose: "Je propose",
  informe: "J'informe",
};
const POST_TYPES = Object.keys(POST_TYPE_LABELS) as PostType[];

/** Exemple affiché en placeholder du champ de saisie, adapté au type
 * sélectionné (cf. backlog « donner de meilleures idées ») — "cherche" porte
 * deux exemples : un objet à emprunter et une recommandation de confiance
 * (artisan, dentiste...), l'ancien type "recommandation" fusionné dans
 * "cherche" (cf. revue « simplifier la navigation »). */
const POST_CONTENT_PLACEHOLDERS: Record<PostType, string> = {
  cherche:
    "Une phrase, c'est tout : « Je cherche une perceuse ce week-end » ou « Un plombier fiable pour une fuite ? »",
  propose: "Une phrase, c'est tout : « Je prête ma tondeuse ce week-end »",
  informe: "Une phrase, c'est tout : « Coupure d'eau prévue mardi matin »",
};

/** Libellés des durées fixes — "months" a son propre rendu (select du nombre de mois). */
const POST_DURATION_LABELS: Record<"today" | "week", string> = {
  today: "Aujourd'hui",
  week: "Cette semaine",
};
const POST_DURATION_MONTHS_OPTIONS = Array.from(
  { length: MAX_POST_DURATION_MONTHS - MIN_POST_DURATION_MONTHS + 1 },
  (_, i) => MIN_POST_DURATION_MONTHS + i,
);

/** Noms de tapeurs affichés directement sur la vignette avant de replier le
 * reste dans un <details> — au-delà, une demande très répondue déborderait
 * de la carte (cf. retour utilisateur : "50 voisins qui répondent"). */
const TAPPERS_VISIBLE_LIMIT = 6;

interface FilPost extends StreetPost {
  tapCount: number;
  viewerHasTapped: boolean;
  /** Qui a tapé — rempli seulement pour ses propres demandes (cf. backlog
   * « qui a tapé sur mes messages, au survol » et « message privé à un
   * tapeur pour s'organiser »), vide sinon : pas besoin d'exposer qui a
   * répondu chez les autres. */
  tappers: Tapper[];
  /** Réponses publiques déjà données (cf. db/comments.ts) — toujours
   * visibles, quel que soit l'auteur : contrairement aux tapeurs, l'intérêt
   * d'une réponse publique est justement de rester visible au prochain
   * habitant qui pose la même question (cf. backlog « retrouver les
   * réponses déjà données »). */
  comments: PostComment[];
}

/** Complète chaque demande avec son nombre de taps, si `viewerId` a déjà tapé, qui a tapé sur ses propres demandes, et ses réponses publiques déjà données. */
async function attachPostExtras(
  posts: StreetPost[],
  viewerId: number,
): Promise<FilPost[]> {
  const postIds = posts.map((p) => p.id);
  const ownPostIds = posts.filter((p) => p.authorId === viewerId).map((p) =>
    p.id
  );
  const [counts, tapped, tappersByPost, commentsByPost] = await Promise.all([
    countTapsByPost(postIds),
    findTappedPostIds(viewerId, postIds),
    listTappers(ownPostIds),
    listCommentsByPost(postIds),
  ]);
  return posts.map((p) => ({
    ...p,
    tapCount: counts.get(p.id) ?? 0,
    viewerHasTapped: tapped.has(p.id),
    tappers: tappersByPost.get(p.id) ?? [],
    comments: commentsByPost.get(p.id) ?? [],
  }));
}

interface FilData {
  streetName: string;
  housesCount: number;
  posts: FilPost[];
  /** Onglet actif (`null` = "Tout"). */
  activeType: PostType | null;
  /** Recherche active (URL `?q=`), `null` si aucune. */
  search: string | null;
  /** URL courante (chemin + query) : filtre/page/recherche à restaurer après /modifier ou /supprimer. */
  backPath: string;
  postError: string | null;
  postPublished: boolean;
  /** `?edit_error=1` posé par /modifier quand la correction est bloquée par la modération (cf. revue : sinon perdue en silence). */
  editError: boolean;
  /** `?reponse_error=1` posé par /reponses (réponse bloquée par la modération). */
  reponseError: boolean;
  /** `?verif_error=1` : action tentée (publier/tapper/répondre) alors que le
   * compte n'est pas encore vérifié par un voisin (cf. db/vouches.ts) — ne
   * devrait arriver que via une page restée ouverte pendant la validation,
   * l'UI masque déjà ces actions tant que non vérifié. */
  verifError: boolean;
  /** Valeur re-soumise telle quelle si la publication échoue. */
  postContent: string;
  postType: PostType;
  postDuration: PostDuration;
  postDurationMonths: number;
  page: number;
  totalPages: number;
  totalCount: number;
}

function parsePage(raw: string | null): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parseActiveType(raw: string | null): PostType | null {
  return raw && isPostType(raw) ? raw : null;
}

function parseSearch(raw: string | null): string | null {
  const trimmed = raw?.trim().slice(0, MAX_SEARCH_LENGTH) ?? "";
  return trimmed || null;
}

/** Nombre de mois saisi pour la durée "months" ; borné à l'affichage (le
 * clampage définitif est dans `computeExpiresAt`). */
function parseDurationMonths(
  raw: FormDataEntryValue | null,
  fallback: number,
): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(
    Math.max(parsed, MIN_POST_DURATION_MONTHS),
    MAX_POST_DURATION_MONTHS,
  );
}

export const handler = define.handlers({
  async GET(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.redirect("/connexion");

    const streetStatus = await getStreetHousesStatus(user.street.id);
    // Tant que la rue dort, la seule action offerte est d'inviter (cf.
    // backlog) : rien à lire ici (et de toute façon aucune demande n'a pu
    // être publiée avant l'éveil, POST /fil applique la même règle).
    if (!streetStatus.isAwake) return ctx.redirect("/");

    const activeType = parseActiveType(ctx.url.searchParams.get("type"));
    const search = parseSearch(ctx.url.searchParams.get("q"));
    const page = parsePage(ctx.url.searchParams.get("page"));
    const backPath = ctx.url.pathname + ctx.url.search;
    const postPublished = ctx.url.searchParams.get("published") === "1";
    const editError = ctx.url.searchParams.get("edit_error") === "1";
    const reponseError = ctx.url.searchParams.get("reponse_error") === "1";
    const verifError = ctx.url.searchParams.get("verif_error") === "1";

    const { posts: rawPosts, totalPages, totalCount, page: resolvedPage } =
      await listStreetPosts({
        streetId: user.street.id,
        type: activeType ?? undefined,
        page,
        search: search ?? undefined,
      });
    const posts = await attachPostExtras(rawPosts, user.id);

    return {
      data: {
        streetName: user.street.name,
        housesCount: streetStatus.housesCount,
        posts,
        page: resolvedPage,
        totalPages,
        totalCount,
        search,
        activeType,
        backPath,
        postError: null,
        postPublished,
        editError,
        reponseError,
        verifError,
        postType: "cherche",
        postContent: "",
        postDuration: "week",
        postDurationMonths: MIN_POST_DURATION_MONTHS,
      } satisfies FilData,
    };
  },

  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.redirect("/connexion");

    const streetStatus = await getStreetHousesStatus(user.street.id);
    if (!streetStatus.isAwake) return ctx.redirect("/");
    // Cf. db/vouches.ts : publier est réservé aux comptes vérifiés par un
    // voisin — l'UI masque déjà le formulaire, ce garde-fou couvre une page
    // restée ouverte pendant la validation ou un POST forgé.
    if (!isUserVerified(user)) return ctx.redirect("/fil?verif_error=1");

    const form = await ctx.req.formData();
    const rawType = String(form.get("type") ?? "");
    const rawDuration = String(form.get("duration") ?? "");
    const content = String(form.get("content") ?? "").trim().slice(
      0,
      MAX_POST_CONTENT_LENGTH,
    );

    const postType: PostType = isPostType(rawType) ? rawType : "cherche";
    const postDuration: PostDuration = isPostDuration(rawDuration)
      ? rawDuration
      : "week";
    const postDurationMonths = parseDurationMonths(
      form.get("durationMonths"),
      MIN_POST_DURATION_MONTHS,
    );

    // Champ facultatif (cf. backlog « ajouter des pièces jointes... si
    // c'est une image ») : un `<input type="file">` non rempli soumet une
    // valeur, mais un `File` de taille nulle — `hasImage` l'exclut.
    const imageFile = form.get("image");
    const hasImage = imageFile instanceof File && imageFile.size > 0;
    let imageError: string | null = null;
    let image: Parameters<typeof createPost>[0]["image"];
    if (hasImage) {
      if (imageFile.size > MAX_IMAGE_UPLOAD_BYTES) {
        imageError = "L'image dépasse la taille maximale autorisée (5 Mo).";
      } else {
        try {
          const bytes = new Uint8Array(await imageFile.arrayBuffer());
          const resized = await resizeAndEncodeImage(bytes);
          image = { streetId: user.street.id, ...resized };
        } catch (cause) {
          if (!(cause instanceof UnsupportedImageError)) throw cause;
          imageError =
            "Format d'image non reconnu — essayez un JPEG, PNG ou WebP.";
        }
      }
    }

    if (
      isPostType(rawType) && isPostDuration(rawDuration) && content &&
      !containsBlockedContent(content) && !imageError
    ) {
      const expiresAt = computeExpiresAt(postDuration, postDurationMonths);
      await createPost({
        userId: user.id,
        type: postType,
        content,
        expiresAt,
        image,
      });
      return ctx.redirect("/fil?published=1");
    }

    // Erreur : on réaffiche le fil (première page, sans filtre) avec le
    // message d'erreur et le brouillon tapé, plutôt qu'une redirection —
    // même logique que /rejoindre et /inviter.
    const error = imageError ??
      (!isPostType(rawType) || !isPostDuration(rawDuration) || !content
        ? "Merci de choisir un type, une durée et d'écrire votre demande."
        : "Merci de reformuler : ce message contient des termes non autorisés.");
    const { posts: rawPosts, totalPages, totalCount, page } =
      await listStreetPosts({
        streetId: user.street.id,
        page: 1,
      });
    const posts = await attachPostExtras(rawPosts, user.id);

    return {
      data: {
        streetName: user.street.name,
        housesCount: streetStatus.housesCount,
        posts,
        page,
        totalPages,
        totalCount,
        search: null,
        activeType: null,
        backPath: "/fil",
        postError: error,
        postPublished: false,
        editError: false,
        reponseError: false,
        verifError: false,
        postDuration,
        postDurationMonths,
        postType,
        postContent: content,
      } satisfies FilData,
    };
  },
});

function filterHref(type: PostType | null, search: string | null): string {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (search) params.set("q", search);
  const qs = params.toString();
  return qs ? `/fil?${qs}` : "/fil";
}

function pageHref(
  activeType: PostType | null,
  search: string | null,
  page: number,
): string {
  const params = new URLSearchParams();
  if (activeType) params.set("type", activeType);
  if (search) params.set("q", search);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/fil?${qs}` : "/fil";
}

export default define.page<typeof handler>(function Fil({ data, state }) {
  const {
    streetName,
    housesCount,
    posts,
    activeType,
    search,
    backPath,
    postError,
    postPublished,
    editError,
    reponseError,
    verifError,
    postContent,
    postType,
    postDuration,
    postDurationMonths,
    page,
    totalPages,
    totalCount,
  } = data as FilData;

  return (
    <>
      <Head>
        <title>Le fil de {streetName} — NotreRue.fr</title>
        {
          /* Contenu personnalisé, réservé aux habitants vérifiés de cette
          rue (redirection vers /connexion sinon, cf. handler) : jamais
          indexable. Défense en profondeur en plus de robots.txt — au cas
          où la redirection viendrait à régresser (cf. AGENTS.md
          cybersécurité). */
        }
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <Header
        user={state.user}
        isStreetAwake={state.isStreetAwake}
        theme={state.theme}
        hasUnreadMessages={state.hasUnreadMessages}
      />
      <main>
        <section class="container hero hero--single page-wide">
          <h1 class="hero__title">Le fil de ma rue</h1>
          <p class="hero__subtitle fil-hero__subtitle">
            <strong>{housesCount} foyers</strong>{" "}
            · du plus récent au plus ancien
          </p>

          {postPublished && (
            <p class="hero__confirmation">Votre demande a été publiée !</p>
          )}
          {postError && <p class="form-error" role="alert">{postError}</p>}
          {editError && (
            <p class="form-error" role="alert">
              Votre correction n'a pas été enregistrée : merci de reformuler, ce
              message contient des termes non autorisés.
            </p>
          )}
          {reponseError && (
            <p class="form-error" role="alert">
              Votre réponse n'a pas été enregistrée : merci de reformuler, ce
              message contient des termes non autorisés.
            </p>
          )}
          {verifError && (
            <p class="form-error" role="alert">
              Votre compte doit d'abord être validé par un voisin avant de
              pouvoir publier, tapper ou répondre.
            </p>
          )}

          {state.user && !isUserVerified(state.user) && (
            <p class="hero__confirmation">
              Votre compte est en attente de validation par un voisin. En
              attendant, vous pouvez consulter le fil, mais pas encore publier,
              tapper ni répondre — demandez à un voisin déjà inscrit de vous
              valider depuis la page d'accueil.
            </p>
          )}

          {
            /* Avant de publier : retrouver une demande déjà passée. */
          }
          <form method="GET" class="fil-search">
            <input
              type="search"
              name="q"
              class="lookup-form__input"
              placeholder="Rechercher (ex : perceuse, plombier…)"
              maxlength={MAX_SEARCH_LENGTH}
              value={search ?? ""}
              autocomplete="off"
            />
            {activeType && (
              <input type="hidden" name="type" value={activeType} />
            )}
            <button type="submit" class="button button--secondary">
              Rechercher
            </button>
          </form>

          {search && (
            <p class="fil-search__status">
              {totalCount === 0 ? <>Aucun résultat pour « {search} ».</> : (
                <>
                  {totalCount} résultat{totalCount > 1 ? "s" : ""} pour «{" "}
                  {search} ».
                </>
              )} <a href={filterHref(activeType, null)}>Réinitialiser</a>
            </p>
          )}

          {state.user && isUserVerified(state.user) && (
            <div class="compose-post">
              <h2 class="compose-post__title">
                Quoi de neuf sur votre rue ?
              </h2>
              <form
                method="POST"
                class="compose-post__form"
                enctype="multipart/form-data"
              >
                <PostTypePlaceholder placeholders={POST_CONTENT_PLACEHOLDERS}>
                  <div
                    class="compose-post__types"
                    role="radiogroup"
                    aria-label="Type de publication"
                  >
                    {POST_TYPES.map((value) => (
                      <label key={value} class="compose-post__type">
                        <input
                          type="radio"
                          name="type"
                          value={value}
                          checked={postType === value}
                        />
                        {POST_TYPE_LABELS[value]}
                      </label>
                    ))}
                  </div>

                  <div
                    class="compose-post__types"
                    role="radiogroup"
                    aria-label="Durée de validité de la demande"
                  >
                    {(["today", "week"] as const).map((value) => (
                      <label key={value} class="compose-post__type">
                        <input
                          type="radio"
                          name="duration"
                          value={value}
                          checked={postDuration === value}
                        />
                        {POST_DURATION_LABELS[value]}
                      </label>
                    ))}
                    <label class="compose-post__type">
                      <input
                        type="radio"
                        name="duration"
                        value="months"
                        checked={postDuration === "months"}
                      />
                      <select
                        name="durationMonths"
                        class="compose-post__duration-select"
                        aria-label="Nombre de mois"
                      >
                        {POST_DURATION_MONTHS_OPTIONS.map((months) => (
                          <option
                            key={months}
                            value={months}
                            selected={months === postDurationMonths}
                          >
                            {months}
                          </option>
                        ))}
                      </select>{" "}
                      mois
                    </label>
                  </div>

                  <CharacterCounter max={MAX_POST_CONTENT_LENGTH}>
                    <input
                      type="text"
                      name="content"
                      class="lookup-form__input"
                      placeholder={POST_CONTENT_PLACEHOLDERS[postType]}
                      maxlength={MAX_POST_CONTENT_LENGTH}
                      value={postContent}
                      autocomplete="off"
                      required
                    />
                  </CharacterCounter>
                </PostTypePlaceholder>

                {
                  /* Facultatif (cf. backlog « pièces jointes... si c'est
                    une image, bouton plus joli et glisser-déposer ») —
                    types resserrés dans `accept` pour éviter à la plupart
                    des habitants de sélectionner un format non supporté
                    (HEIC des iPhone notamment), la validation réelle reste
                    côté serveur (cf. handler POST). Le `<label for>`
                    déclenche nativement le sélecteur de fichier au clic
                    (aucun JS requis pour ça) ; ImageDropzone n'ajoute que ce
                    que le HTML seul ne peut pas faire : le glisser-déposer
                    et le nom du fichier choisi (cf. islands/ImageDropzone.tsx). */
                }
                <div class="form-field">
                  <span class="lookup-card__label">Photo (facultatif)</span>
                  <ImageDropzone>
                    <input
                      id="compose-post-image"
                      type="file"
                      name="image"
                      accept="image/jpeg,image/png,image/webp"
                      class="image-dropzone__input"
                    />
                    <label
                      for="compose-post-image"
                      class="image-dropzone__area"
                    >
                      <ImageIcon class="image-dropzone__icon" />
                      <span>
                        Glissez une photo ici, ou cliquez pour la choisir
                      </span>
                    </label>
                  </ImageDropzone>
                  <p class="autocomplete-field__hint">5 Mo maximum.</p>
                </div>

                <button type="submit" class="button">Publier</button>
              </form>
            </div>
          )}

          <nav class="fil-filters" aria-label="Filtrer par type">
            <a
              href={filterHref(null, search)}
              class={`fil-filters__tab ${
                !activeType ? "fil-filters__tab--active" : ""
              }`}
            >
              Tout
            </a>
            {POST_TYPES.map((value) => (
              <a
                key={value}
                href={filterHref(value, search)}
                class={`fil-filters__tab ${
                  activeType === value ? "fil-filters__tab--active" : ""
                }`}
              >
                {POST_TYPE_LABELS[value]}
              </a>
            ))}
          </nav>

          <ul class="fil-list">
            {posts.length === 0 && (
              <li class="empty-state">
                Rien à afficher ici pour l'instant.
              </li>
            )}
            {posts.map((item) => (
              <li key={item.id} class="fil-post">
                <div class="fil-post__header">
                  <span class="fil-post__badge">
                    {POST_TYPE_LABELS[item.type]}
                  </span>
                  <span class="fil-post__date">
                    {formatRelativeDate(item.createdAt)}
                  </span>
                </div>
                <p class="fil-post__content">{item.content}</p>

                {item.image && (
                  <img
                    src={`/photos/${item.image.id}`}
                    width={item.image.width}
                    height={item.image.height}
                    loading="lazy"
                    alt={`Photo jointe à la demande de ${item.authorLogin}`}
                    class="fil-post__image"
                  />
                )}

                {
                  /* Formulaire d'édition posé ici, à la place du contenu
                    ci-dessus (masqué par CSS dès que la case ci-dessous est
                    cochée) plutôt que replié sous les boutons Modifier/
                    Supprimer — cf. retour utilisateur : le champ de saisie
                    doit remplacer visuellement le texte, pas s'ajouter plus
                    bas. Le déclencheur (case + libellé "Modifier") reste
                    dans .fil-post__owner-actions, à côté de "Supprimer". */
                }
                {state.user && item.authorId === state.user.id && (
                  <form
                    method="POST"
                    action="/modifier"
                    class="fil-post__edit-form"
                  >
                    <input type="hidden" name="postId" value={item.id} />
                    <input type="hidden" name="back" value={backPath} />
                    <CharacterCounter max={MAX_POST_CONTENT_LENGTH}>
                      <input
                        type="text"
                        name="content"
                        class="lookup-form__input"
                        maxlength={MAX_POST_CONTENT_LENGTH}
                        value={item.content}
                        autocomplete="off"
                        required
                      />
                    </CharacterCounter>
                    <button
                      type="submit"
                      class="button button--secondary"
                    >
                      Enregistrer
                    </button>
                  </form>
                )}

                <div class="fil-post__footer">
                  <p class="fil-post__author">{item.authorLogin}</p>

                  {state.user && item.authorId !== state.user.id &&
                    isUserVerified(state.user) && (
                    <div class="fil-post__actions">
                      <form method="POST" action="/taps">
                        <input
                          type="hidden"
                          name="postId"
                          value={item.id}
                        />
                        {activeType && (
                          <input
                            type="hidden"
                            name="type"
                            value={activeType}
                          />
                        )}
                        {page > 1 && (
                          <input type="hidden" name="page" value={page} />
                        )}
                        {search && (
                          <input type="hidden" name="q" value={search} />
                        )}
                        <button
                          type="submit"
                          class={`fil-post__tap ${
                            item.viewerHasTapped ? "fil-post__tap--active" : ""
                          }`}
                        >
                          {item.viewerHasTapped ? "✓ " : ""}
                          {TAP_LABELS[item.type]}
                          {item.tapCount > 0 && ` · ${item.tapCount} déjà`}
                        </button>
                      </form>
                      <a
                        href={`/messages?with=${item.authorId}&postId=${item.id}`}
                        class="fil-post__message-link"
                      >
                        <MailIcon class="fil-post__mail-icon" />
                        Message privé
                      </a>
                    </div>
                  )}

                  {state.user && item.authorId === state.user.id && (
                    <>
                      {item.tappers.length > 0 && (
                        <div class="fil-post__tappers">
                          <span class="fil-post__tappers-label">
                            {item.tappers.length} {TAP_LABELS[item.type]}
                            :
                          </span>
                          {item.tappers.slice(0, TAPPERS_VISIBLE_LIMIT)
                            .map((
                              tapper,
                            ) => (
                              <a
                                key={tapper.id}
                                href={`/messages?with=${tapper.id}&postId=${item.id}`}
                                class="fil-post__tappers-link"
                              >
                                <MailIcon class="fil-post__mail-icon" />
                                {tapper.login}
                              </a>
                            ))}
                          {item.tappers.length > TAPPERS_VISIBLE_LIMIT && (
                            <details class="fil-post__tappers-more">
                              <summary class="fil-post__tappers-link">
                                +{item.tappers.length -
                                  TAPPERS_VISIBLE_LIMIT} autres
                              </summary>
                              <div class="fil-post__tappers-more-list">
                                {item.tappers.slice(TAPPERS_VISIBLE_LIMIT)
                                  .map(
                                    (
                                      tapper,
                                    ) => (
                                      <a
                                        key={tapper.id}
                                        href={`/messages?with=${tapper.id}&postId=${item.id}`}
                                        class="fil-post__tappers-link"
                                      >
                                        <MailIcon class="fil-post__mail-icon" />
                                        {tapper.login}
                                      </a>
                                    ),
                                  )}
                              </div>
                            </details>
                          )}
                        </div>
                      )}

                      {
                        /* Corriger ou supprimer sa propre demande (cf.
                          backlog « corriger des erreurs de saisie ») —
                          jamais proposé sur la demande d'un autre. */
                      }
                      <div class="fil-post__owner-actions">
                        <input
                          type="checkbox"
                          id={`fil-edit-toggle-${item.id}`}
                          class="fil-post__edit-toggle"
                        />
                        <label
                          for={`fil-edit-toggle-${item.id}`}
                          class="fil-post__owner-link"
                        >
                          {
                            /* Le libellé bascule sur "Annuler" une fois la
                              case cochée (cf. retour utilisateur : montrer
                              qu'on peut revenir en arrière) — deux <span>
                              plutôt que du JS, basculés par la même case à
                              cocher que le panneau qu'elle ouvre (cf.
                              .fil-post__owner-link-label--active plus bas). */
                          }
                          <span class="fil-post__owner-link-label">
                            Modifier
                          </span>
                          <span class="fil-post__owner-link-label--active">
                            Annuler
                          </span>
                        </label>

                        <input
                          type="checkbox"
                          id={`fil-delete-toggle-${item.id}`}
                          class="fil-post__delete-toggle"
                        />
                        <label
                          for={`fil-delete-toggle-${item.id}`}
                          class="fil-post__owner-link fil-post__owner-link--danger"
                        >
                          <span class="fil-post__owner-link-label">
                            Supprimer
                          </span>
                          <span class="fil-post__owner-link-label--active">
                            Annuler
                          </span>
                        </label>
                      </div>
                    </>
                  )}
                </div>

                {
                  /* Confirmation de suppression : un bandeau posé en pleine
                    largeur sous les actions (masqué par CSS tant que la case
                    ci-dessus n'est pas cochée), plutôt qu'imbriqué dans le
                    <details> "Supprimer" — qui l'écrasait à côté de
                    "Modifier" en cas d'ouverture (cf. retour utilisateur). */
                }
                {state.user && item.authorId === state.user.id && (
                  <form
                    method="POST"
                    action="/supprimer"
                    class="fil-post__delete-form"
                  >
                    <input type="hidden" name="postId" value={item.id} />
                    <input type="hidden" name="back" value={backPath} />
                    <p class="fil-post__delete-confirm">
                      Confirmer la suppression de cette demande ?
                    </p>
                    <button
                      type="submit"
                      class="button button--secondary"
                    >
                      Oui, supprimer
                    </button>
                  </form>
                )}

                {
                  /* Réponses publiques (cf. db/comments.ts) : en plus du tap,
                    pas à sa place — restent visibles au prochain habitant qui
                    pose la même question (cf. backlog « retrouver les
                    réponses déjà données », ex-onglet Recommandations
                    fusionné ici). */
                }
                {item.comments.length > 0 && (
                  <ul class="fil-post__replies">
                    {item.comments.map((reply) => (
                      <li key={reply.id} class="fil-post__reply">
                        <span class="fil-post__reply-author">
                          {reply.authorLogin}
                        </span>
                        <span class="fil-post__reply-content">
                          {reply.content}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {state.user && isUserVerified(state.user) && (
                  <form
                    method="POST"
                    action="/reponses"
                    class="fil-post__reply-form"
                  >
                    <input type="hidden" name="postId" value={item.id} />
                    {activeType && (
                      <input type="hidden" name="type" value={activeType} />
                    )}
                    {page > 1 && (
                      <input type="hidden" name="page" value={page} />
                    )}
                    {search && <input type="hidden" name="q" value={search} />}
                    <CharacterCounter max={MAX_COMMENT_CONTENT_LENGTH}>
                      <input
                        type="text"
                        name="content"
                        class="fil-post__reply-input"
                        placeholder="Répondre ici, publiquement"
                        maxlength={MAX_COMMENT_CONTENT_LENGTH}
                        autocomplete="off"
                        required
                      />
                    </CharacterCounter>
                    <button
                      type="submit"
                      class="button button--secondary fil-post__reply-submit"
                    >
                      Répondre
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>

          {totalPages > 1 && (
            <nav class="fil-pagination" aria-label="Pagination du fil">
              {page > 1
                ? (
                  <a
                    href={pageHref(activeType, search, page - 1)}
                    class="button button--secondary"
                  >
                    ← Précédent
                  </a>
                )
                : <span />}
              <span class="fil-pagination__status">
                Page {page} / {totalPages}
              </span>
              {page < totalPages
                ? (
                  <a
                    href={pageHref(activeType, search, page + 1)}
                    class="button button--secondary"
                  >
                    Suivant →
                  </a>
                )
                : <span />}
            </nav>
          )}
        </section>
      </main>
    </>
  );
});
