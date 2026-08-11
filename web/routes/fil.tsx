import { Head } from "fresh/runtime";
import "../assets/pages/fil.css" with { type: "css" };
import { define } from "../utils.ts";
import { Header } from "../components/Header.tsx";
import { MailIcon } from "../components/icons.tsx";
import { getStreetHousesStatus } from "../db/streets.ts";
import {
  computeExpiresAt,
  createPost,
  isPostDuration,
  isPostType,
  listStreetPosts,
  MAX_POST_CONTENT_LENGTH,
  MAX_POST_DURATION_MONTHS,
  MIN_POST_DURATION_MONTHS,
  type PostDuration,
  type PostType,
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

const POST_TYPE_LABELS: Record<PostType, string> = {
  cherche: "Je cherche",
  propose: "Je propose",
  informe: "J'informe",
};
const POST_TYPES = Object.keys(POST_TYPE_LABELS) as PostType[];

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
const TAP_LABELS: Record<PostType, string> = {
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
  activeType: PostType | null;
  postError: string | null;
  postPublished: boolean;
  /** Valeurs re-soumises telles quelles si la publication échoue. */
  postType: PostType;
  postContent: string;
  postDuration: PostDuration;
  postDurationMonths: number;
}

function parsePage(raw: string | null): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parseType(raw: string | null): PostType | null {
  return raw && isPostType(raw) ? raw : null;
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
    const { posts: rawPosts, totalPages, page } = await listStreetPosts({
      streetId: user.street.id,
      type: activeType ?? undefined,
      page: parsePage(ctx.url.searchParams.get("page")),
    });
    const posts = await attachTapInfo(rawPosts, user.id);

    return {
      data: {
        streetName: user.street.name,
        housesCount: streetStatus.housesCount,
        posts,
        page,
        totalPages,
        activeType,
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
    const postType: PostType = isPostType(rawType) ? rawType : "cherche";
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
      isPostType(rawType) && isPostDuration(rawDuration) && content &&
      !containsBlockedContent(content)
    ) {
      const expiresAt = computeExpiresAt(postDuration, postDurationMonths);
      await createPost({ userId: user.id, type: postType, content, expiresAt });
      return ctx.redirect("/fil?published=1");
    }

    // Erreur : on réaffiche le fil (première page, sans filtre) avec le
    // message d'erreur et le brouillon tapé, plutôt qu'une redirection —
    // même logique que /rejoindre et /inviter.
    const error = !isPostType(rawType) || !isPostDuration(rawDuration) ||
        !content
      ? "Merci de choisir un type, une durée et d'écrire votre demande."
      : "Merci de reformuler : ce message contient des termes non autorisés.";
    const { posts: rawPosts, totalPages, page } = await listStreetPosts({
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
        activeType: null,
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

function filterHref(type: PostType | null): string {
  return type ? `/fil?type=${type}` : "/fil";
}

function pageHref(activeType: PostType | null, page: number): string {
  const params = new URLSearchParams();
  if (activeType) params.set("type", activeType);
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
    activeType,
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
              href={filterHref(null)}
              class={`fil-filters__tab ${
                !activeType ? "fil-filters__tab--active" : ""
              }`}
            >
              Tout
            </a>
            {POST_TYPES.map((value) => (
              <a
                key={value}
                href={filterHref(value)}
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

                  {state.user && item.authorId === state.user.id &&
                    item.tappers.length > 0 && (
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
                            +{item.tappers.length - TAPPERS_VISIBLE_LIMIT}{" "}
                            autres
                          </summary>
                          <div class="fil-post__tappers-more-list">
                            {item.tappers.slice(TAPPERS_VISIBLE_LIMIT).map((
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
                          </div>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {totalPages > 1 && (
            <nav class="fil-pagination" aria-label="Pagination du fil">
              {page > 1
                ? (
                  <a
                    href={pageHref(activeType, page - 1)}
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
                    href={pageHref(activeType, page + 1)}
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
