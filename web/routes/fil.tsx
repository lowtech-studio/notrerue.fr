import { Head } from "fresh/runtime";
import "../assets/pages/fil.css" with { type: "css" };
import { define } from "../utils.ts";
import { Header } from "../components/Header.tsx";
import { MailIcon } from "../components/icons.tsx";
import { getStreetHousesStatus } from "../db/streets.ts";
import {
  computeExpiresAt,
  createPost,
  type FilPostType,
  isFilPostType,
  isPostDuration,
  listStreetPosts,
  MAX_POST_CONTENT_LENGTH,
  MAX_POST_DURATION_MONTHS,
  MAX_SEARCH_LENGTH,
  MIN_POST_DURATION_MONTHS,
  type PostDuration,
  type StreetPost,
} from "../db/posts.ts";
import { containsBlockedContent } from "../moderation/blocklist.ts";
import {
  countTapsByPost,
  findTappedPostIds,
  listTappers,
  type Tapper,
} from "../db/taps.ts";
import { formatRelativeDate } from "../utils/relative_date.ts";

const POST_TYPE_LABELS: Record<FilPostType, string> = {
  cherche: "Je cherche",
  propose: "Je propose",
  informe: "J'informe",
};
const POST_TYPES = Object.keys(POST_TYPE_LABELS) as FilPostType[];

/** Libellés des durées fixes — "months" a son propre rendu (select du nombre de mois). */
const POST_DURATION_LABELS: Record<"today" | "week", string> = {
  today: "Aujourd'hui",
  week: "Cette semaine",
};
const POST_DURATION_MONTHS_OPTIONS = Array.from(
  { length: MAX_POST_DURATION_MONTHS - MIN_POST_DURATION_MONTHS + 1 },
  (_, i) => MIN_POST_DURATION_MONTHS + i,
);

/** Libellé du bouton de réponse en un clic, selon le type de la demande (cf. backlog). */
const TAP_LABELS: Record<FilPostType, string> = {
  cherche: "J'ai",
  propose: "Intéressé",
  informe: "👍",
};

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
}

/** Complète chaque demande avec son nombre de taps, si `viewerId` a déjà tapé, et qui a tapé sur ses propres demandes. */
async function attachTapInfo(
  posts: StreetPost[],
  viewerId: number,
): Promise<FilPost[]> {
  const postIds = posts.map((p) => p.id);
  const ownPostIds = posts.filter((p) => p.authorId === viewerId).map((p) =>
    p.id
  );
  const [counts, tapped, tappersByPost] = await Promise.all([
    countTapsByPost(postIds),
    findTappedPostIds(viewerId, postIds),
    listTappers(ownPostIds),
  ]);
  return posts.map((p) => ({
    ...p,
    tapCount: counts.get(p.id) ?? 0,
    viewerHasTapped: tapped.has(p.id),
    tappers: tappersByPost.get(p.id) ?? [],
  }));
}

interface FilData {
  streetName: string;
  housesCount: number;
  posts: FilPost[];
  page: number;
  totalPages: number;
  totalCount: number;
  /** Recherche active (URL `?q=`), `null` si aucune. */
  search: string | null;
  activeType: FilPostType | null;
  /** URL courante (chemin + query) : filtre/page/recherche à restaurer après /modifier ou /supprimer. */
  backPath: string;
  postError: string | null;
  postPublished: boolean;
  /** Valeurs re-soumises telles quelles si la publication échoue. */
  postType: FilPostType;
  postContent: string;
  postDuration: PostDuration;
  postDurationMonths: number;
}

function parsePage(raw: string | null): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parseType(raw: string | null): FilPostType | null {
  return raw && isFilPostType(raw) ? raw : null;
}

function parseSearch(raw: string | null): string | null {
  const trimmed = raw?.trim().slice(0, MAX_SEARCH_LENGTH) ?? "";
  return trimmed || null;
}

/** Nombre de mois saisi pour la durée "months" ; borné à l'affichage (le clampage définitif est dans `computeExpiresAt`). */
function parseDurationMonths(raw: FormDataEntryValue | null): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return MIN_POST_DURATION_MONTHS;
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

    const activeType = parseType(ctx.url.searchParams.get("type"));
    const search = parseSearch(ctx.url.searchParams.get("q"));
    const { posts: rawPosts, totalPages, totalCount, page } =
      await listStreetPosts({
        streetId: user.street.id,
        type: activeType ?? undefined,
        page: parsePage(ctx.url.searchParams.get("page")),
        search: search ?? undefined,
      });
    const posts = await attachTapInfo(rawPosts, user.id);

    return {
      data: {
        streetName: user.street.name,
        housesCount: streetStatus.housesCount,
        posts,
        page,
        totalPages,
        totalCount,
        search,
        activeType,
        backPath: ctx.url.pathname + ctx.url.search,
        postError: null,
        postPublished: ctx.url.searchParams.get("published") === "1",
        postType: "cherche",
        postContent: "",
        postDuration: "week",
        postDurationMonths: MIN_POST_DURATION_MONTHS,
      },
    };
  },

  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.redirect("/connexion");

    const streetStatus = await getStreetHousesStatus(user.street.id);
    if (!streetStatus.isAwake) return ctx.redirect("/");

    const form = await ctx.req.formData();
    const rawType = String(form.get("type") ?? "");
    const postType: FilPostType = isFilPostType(rawType) ? rawType : "cherche";
    const rawDuration = String(form.get("duration") ?? "");
    const postDuration: PostDuration = isPostDuration(rawDuration)
      ? rawDuration
      : "week";
    const postDurationMonths = parseDurationMonths(
      form.get("durationMonths"),
    );
    const content = String(form.get("content") ?? "").trim().slice(
      0,
      MAX_POST_CONTENT_LENGTH,
    );

    if (
      isFilPostType(rawType) && isPostDuration(rawDuration) && content &&
      !containsBlockedContent(content)
    ) {
      const expiresAt = computeExpiresAt(postDuration, postDurationMonths);
      await createPost({ userId: user.id, type: postType, content, expiresAt });
      return ctx.redirect("/fil?published=1");
    }

    // Erreur : on réaffiche le fil (première page, sans filtre) avec le
    // message d'erreur et le brouillon tapé, plutôt qu'une redirection —
    // même logique que /rejoindre et /inviter.
    const error = !isFilPostType(rawType) || !isPostDuration(rawDuration) ||
        !content
      ? "Merci de choisir un type, une durée et d'écrire votre demande."
      : "Merci de reformuler : ce message contient des termes non autorisés.";
    const { posts: rawPosts, totalPages, totalCount, page } =
      await listStreetPosts({
        streetId: user.street.id,
        page: 1,
      });
    const posts = await attachTapInfo(rawPosts, user.id);

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
        postDuration,
        postDurationMonths,
        postType,
        postContent: content,
      },
    };
  },
});

function filterHref(type: FilPostType | null, search: string | null): string {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (search) params.set("q", search);
  const qs = params.toString();
  return qs ? `/fil?${qs}` : "/fil";
}

function pageHref(
  activeType: FilPostType | null,
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
    page,
    totalPages,
    totalCount,
    search,
    activeType,
    backPath,
    postError,
    postPublished,
    postType,
    postContent,
    postDuration,
    postDurationMonths,
  } = data as FilData;

  return (
    <>
      <Head>
        <title>Le fil de {streetName} — NotreRue.fr</title>
      </Head>
      <Header user={state.user} isStreetAwake={state.isStreetAwake} />
      <main>
        <section class="container hero hero--single page-wide">
          <h1 class="hero__title">Le fil de ma rue</h1>
          <p class="hero__subtitle">
            {housesCount} foyers · du plus récent au plus ancien
          </p>

          {postPublished && (
            <p class="hero__confirmation">Votre demande a été publiée !</p>
          )}
          {postError && <p class="form-error" role="alert">{postError}</p>}

          {
            /* Avant de publier : retrouver une demande déjà passée sur le
              fil, même principe que sur /recommandations. */
          }
          <form method="GET" class="fil-search">
            <input
              type="search"
              name="q"
              class="lookup-form__input"
              placeholder="Rechercher (ex : perceuse, tondeuse…)"
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

          <div class="compose-post">
            <h2 class="compose-post__title">Quoi de neuf sur votre rue ?</h2>
            <form method="POST" class="compose-post__form">
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

              <input
                type="text"
                name="content"
                class="lookup-form__input"
                placeholder="Une phrase, c'est tout : « Je cherche une perceuse ce week-end »"
                maxlength={MAX_POST_CONTENT_LENGTH}
                value={postContent}
                autocomplete="off"
                required
              />

              <button type="submit" class="button">Publier</button>
            </form>
          </div>

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
                    <input
                      type="text"
                      name="content"
                      class="lookup-form__input"
                      maxlength={MAX_POST_CONTENT_LENGTH}
                      value={item.content}
                      autocomplete="off"
                      required
                    />
                    <button type="submit" class="button button--secondary">
                      Enregistrer
                    </button>
                  </form>
                )}

                <div class="fil-post__footer">
                  <p class="fil-post__author">{item.authorLogin}</p>

                  {state.user && item.authorId !== state.user.id && (
                    <div class="fil-post__actions">
                      <form method="POST" action="/taps">
                        <input type="hidden" name="postId" value={item.id} />
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
                            {item.tappers.length} {TAP_LABELS[item.type]} :
                          </span>
                          {item.tappers.slice(0, TAPPERS_VISIBLE_LIMIT).map((
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
                                {item.tappers.slice(TAPPERS_VISIBLE_LIMIT).map(
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
                          Modifier
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
                          Supprimer
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
                    <button type="submit" class="button button--secondary">
                      Oui, supprimer
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
