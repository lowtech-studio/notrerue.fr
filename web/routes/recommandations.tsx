import { Head } from "fresh/runtime";
import "../assets/pages/recommandations.css" with { type: "css" };
import { define } from "../utils.ts";
import { Header } from "../components/Header.tsx";
import { getStreetHousesStatus } from "../db/streets.ts";
import {
  type CityRecommendationPost,
  computeExpiresAt,
  createPost,
  isPostDuration,
  listCityRecommendations,
  MAX_POST_CONTENT_LENGTH,
  MAX_POST_DURATION_MONTHS,
  MIN_POST_DURATION_MONTHS,
  type PostDuration,
} from "../db/posts.ts";
import { listCommentsByPost, type PostComment } from "../db/comments.ts";
import { containsBlockedContent } from "../moderation/blocklist.ts";
import { formatRelativeDate } from "../utils/relative_date.ts";

/** Libellés des durées fixes — cf. /fil, même sélecteur. */
const POST_DURATION_LABELS: Record<"today" | "week", string> = {
  today: "Aujourd'hui",
  week: "Cette semaine",
};
const POST_DURATION_MONTHS_OPTIONS = Array.from(
  { length: MAX_POST_DURATION_MONTHS - MIN_POST_DURATION_MONTHS + 1 },
  (_, i) => MIN_POST_DURATION_MONTHS + i,
);

interface RecoPost extends CityRecommendationPost {
  comments: PostComment[];
}

/** Complète chaque demande avec ses réponses déjà données — toujours publiques (cf. db/comments.ts), contrairement aux tapeurs du fil. */
async function attachComments(
  posts: CityRecommendationPost[],
): Promise<RecoPost[]> {
  const commentsByPost = await listCommentsByPost(posts.map((p) => p.id));
  return posts.map((p) => ({ ...p, comments: commentsByPost.get(p.id) ?? [] }));
}

interface RecoData {
  cityName: string;
  posts: RecoPost[];
  page: number;
  totalPages: number;
  postError: string | null;
  postPublished: boolean;
  /** Valeur re-soumise telle quelle si la publication échoue. */
  postContent: string;
  postDuration: PostDuration;
  postDurationMonths: number;
}

function parsePage(raw: string | null): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

/** Nombre de mois saisi pour la durée "months" ; borné à l'affichage (le clampage définitif est dans `computeExpiresAt`). */
function parseDurationMonths(raw: FormDataEntryValue | null): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return MAX_POST_DURATION_MONTHS;
  return Math.min(
    Math.max(parsed, MIN_POST_DURATION_MONTHS),
    MAX_POST_DURATION_MONTHS,
  );
}

export const handler = define.handlers({
  async GET(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.redirect("/connexion");

    // Même porte que /fil et /messages (cf. backlog « une seule action
    // possible tant que la rue n'est pas allumée ») : pas de raison
    // d'ouvrir une seconde fonctionnalité avant que la première n'ait
    // rempli son rôle de moteur d'invitation.
    const streetStatus = await getStreetHousesStatus(user.street.id);
    if (!streetStatus.isAwake) return ctx.redirect("/");

    const { posts: rawPosts, totalPages, page } = await listCityRecommendations(
      {
        cityId: user.street.city.id,
        page: parsePage(ctx.url.searchParams.get("page")),
      },
    );
    const posts = await attachComments(rawPosts);

    return {
      data: {
        cityName: user.street.city.name,
        posts,
        page,
        totalPages,
        postError: null,
        postPublished: ctx.url.searchParams.get("published") === "1",
        postContent: "",
        // Une recommandation n'a pas de date de péremption naturelle (un bon
        // dentiste le reste), contrairement à « une perceuse ce week-end » :
        // durée maximale pré-sélectionnée plutôt que "cette semaine".
        postDuration: "months",
        postDurationMonths: MAX_POST_DURATION_MONTHS,
      },
    };
  },

  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) return ctx.redirect("/connexion");

    const streetStatus = await getStreetHousesStatus(user.street.id);
    if (!streetStatus.isAwake) return ctx.redirect("/");

    const form = await ctx.req.formData();
    const rawDuration = String(form.get("duration") ?? "");
    const postDuration: PostDuration = isPostDuration(rawDuration)
      ? rawDuration
      : "months";
    const postDurationMonths = parseDurationMonths(
      form.get("durationMonths"),
    );
    const content = String(form.get("content") ?? "").trim().slice(
      0,
      MAX_POST_CONTENT_LENGTH,
    );

    if (
      isPostDuration(rawDuration) && content &&
      !containsBlockedContent(content)
    ) {
      const expiresAt = computeExpiresAt(postDuration, postDurationMonths);
      await createPost({
        userId: user.id,
        type: "recommandation",
        content,
        expiresAt,
      });
      return ctx.redirect("/recommandations?published=1");
    }

    // Erreur : on réaffiche la page (première page) avec le message
    // d'erreur et le brouillon tapé — même logique que /fil.
    const error = !isPostDuration(rawDuration) || !content
      ? "Merci de choisir une durée et d'écrire votre demande."
      : "Merci de reformuler : ce message contient des termes non autorisés.";
    const { posts: rawPosts, totalPages, page } = await listCityRecommendations(
      { cityId: user.street.city.id, page: 1 },
    );
    const posts = await attachComments(rawPosts);

    return {
      data: {
        cityName: user.street.city.name,
        posts,
        page,
        totalPages,
        postError: error,
        postPublished: false,
        postDuration,
        postDurationMonths,
        postContent: content,
      },
    };
  },
});

function pageHref(page: number): string {
  return page > 1 ? `/recommandations?page=${page}` : "/recommandations";
}

export default define.page<typeof handler>(
  function Recommandations({ data, state }) {
    const {
      cityName,
      posts,
      page,
      totalPages,
      postError,
      postPublished,
      postContent,
      postDuration,
      postDurationMonths,
    } = data as RecoData;

    return (
      <>
        <Head>
          <title>Recommandations — NotreRue.fr</title>
        </Head>
        <Header user={state.user} isStreetAwake={state.isStreetAwake} />
        <main>
          <section class="container hero hero--single page-wide">
            <h1 class="hero__title">Recommandations</h1>
            <p class="hero__subtitle">
              Artisan, dentiste qui prend des patients, garde... Demandez à
              toute la ville de{" "}
              {cityName}, plutôt qu'un avis anonyme sur internet.
            </p>

            {postPublished && (
              <p class="hero__confirmation">Votre demande a été publiée !</p>
            )}
            {postError && <p class="form-error" role="alert">{postError}</p>}

            <div class="compose-post">
              <h2 class="compose-post__title">
                Besoin d'une adresse de confiance ?
              </h2>
              <form method="POST" class="compose-post__form">
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
                  placeholder="Une phrase, c'est tout : « Un plombier fiable pour une fuite, plutôt vite »"
                  maxlength={MAX_POST_CONTENT_LENGTH}
                  value={postContent}
                  autocomplete="off"
                  required
                />

                <button type="submit" class="button">
                  Demander une recommandation
                </button>
              </form>
            </div>

            <ul class="reco-list">
              {posts.length === 0 && (
                <li class="empty-state">
                  Aucune demande de recommandation pour l'instant.
                </li>
              )}
              {posts.map((item) => (
                <li key={item.id} class="reco-post">
                  <div class="reco-post__header">
                    <span class="reco-post__street">
                      {item.authorStreetName}
                    </span>
                    <span class="reco-post__date">
                      {formatRelativeDate(item.createdAt)}
                    </span>
                  </div>
                  <p class="reco-post__content">{item.content}</p>
                  <p class="reco-post__author">{item.authorLogin}</p>

                  {item.comments.length > 0 && (
                    <ul class="reco-post__replies">
                      {item.comments.map((reply) => (
                        <li key={reply.id} class="reco-post__reply">
                          <span class="reco-post__reply-author">
                            {reply.authorLogin}
                          </span>
                          <span class="reco-post__reply-content">
                            {reply.content}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {state.user && (
                    <form
                      method="POST"
                      action="/reponses"
                      class="reco-post__reply-form"
                    >
                      <input type="hidden" name="postId" value={item.id} />
                      {page > 1 && (
                        <input type="hidden" name="page" value={page} />
                      )}
                      <input
                        type="text"
                        name="content"
                        class="reco-post__reply-input"
                        placeholder="Vous connaissez quelqu'un ? Répondez ici, publiquement"
                        maxlength={280}
                        autocomplete="off"
                        required
                      />
                      <button
                        type="submit"
                        class="button button--secondary reco-post__reply-submit"
                      >
                        Répondre
                      </button>
                    </form>
                  )}
                </li>
              ))}
            </ul>

            {totalPages > 1 && (
              <nav
                class="reco-pagination"
                aria-label="Pagination des recommandations"
              >
                {page > 1
                  ? (
                    <a
                      href={pageHref(page - 1)}
                      class="button button--secondary"
                    >
                      ← Précédent
                    </a>
                  )
                  : <span />}
                <span class="reco-pagination__status">
                  Page {page} / {totalPages}
                </span>
                {page < totalPages
                  ? (
                    <a
                      href={pageHref(page + 1)}
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
  },
);
