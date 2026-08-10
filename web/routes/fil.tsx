import { Head } from "fresh/runtime";
import { define } from "../utils.ts";
import { Header } from "../components/Header.tsx";
import { getStreetHousesStatus } from "../db/streets.ts";
import {
  createPost,
  isPostType,
  listStreetPosts,
  MAX_POST_CONTENT_LENGTH,
  type PostType,
  type StreetPost,
} from "../db/posts.ts";
import { containsBlockedContent } from "../moderation/blocklist.ts";
import { formatRelativeDate } from "../utils/relative_date.ts";

const POST_TYPE_LABELS: Record<PostType, string> = {
  cherche: "Je cherche",
  propose: "Je propose",
  informe: "J'informe",
};
const POST_TYPES = Object.keys(POST_TYPE_LABELS) as PostType[];

interface FilData {
  streetName: string;
  housesCount: number;
  posts: StreetPost[];
  page: number;
  totalPages: number;
  activeType: PostType | null;
  postError: string | null;
  postPublished: boolean;
  /** Valeurs re-soumises telles quelles si la publication échoue. */
  postType: PostType;
  postContent: string;
}

function parsePage(raw: string | null): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parseType(raw: string | null): PostType | null {
  return raw && isPostType(raw) ? raw : null;
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
    const { posts, totalPages, page } = await listStreetPosts({
      streetId: user.street.id,
      type: activeType ?? undefined,
      page: parsePage(ctx.url.searchParams.get("page")),
    });

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
    const content = String(form.get("content") ?? "").trim().slice(
      0,
      MAX_POST_CONTENT_LENGTH,
    );

    if (isPostType(rawType) && content && !containsBlockedContent(content)) {
      await createPost({ userId: user.id, type: postType, content });
      return ctx.redirect("/fil?published=1");
    }

    // Erreur : on réaffiche le fil (première page, sans filtre) avec le
    // message d'erreur et le brouillon tapé, plutôt qu'une redirection —
    // même logique que /rejoindre et /inviter.
    const error = !isPostType(rawType) || !content
      ? "Merci de choisir un type et d'écrire votre demande."
      : "Merci de reformuler : ce message contient des termes non autorisés.";
    const { posts, totalPages, page } = await listStreetPosts({
      streetId: user.street.id,
      page: 1,
    });

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
  } = data as FilData;

  return (
    <>
      <Head>
        <title>Le fil de {streetName} — NotreRue.fr</title>
      </Head>
      <Header user={state.user} />
      <main>
        <section class="container hero hero--single">
          <h1 class="hero__title">Le fil de la rue</h1>
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
              <li class="fil-list__empty">
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
                <p class="fil-post__author">{item.authorLogin}</p>
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
