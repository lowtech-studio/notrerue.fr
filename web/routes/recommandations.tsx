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
  MAX_SEARCH_LENGTH,
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
  totalCount: number;
  /** Recherche active (URL `?q=`), `null` si aucune. */
  search: string | null;
  /** URL courante (chemin + query) : recherche/page à restaurer après /modifier ou /supprimer. */
  backPath: string;
  postError: string | null;
  postPublished: boolean;
  /** `?edit_error=1` posé par /modifier (correction bloquée par la modération). */
  editError: boolean;
  /** `?reponse_error=1` posé par /reponses (réponse bloquée par la modération). */
  reponseError: boolean;
  /** Valeur re-soumise telle quelle si la publication échoue. */
  postContent: string;
  postDuration: PostDuration;
  postDurationMonths: number;
}

function parsePage(raw: string | null): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function parseSearch(raw: string | null): string | null {
  const trimmed = raw?.trim().slice(0, MAX_SEARCH_LENGTH) ?? "";
  return trimmed || null;
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

    const search = parseSearch(ctx.url.searchParams.get("q"));
    const { posts: rawPosts, totalPages, totalCount, page } =
      await listCityRecommendations({
        cityId: user.street.city.id,
        page: parsePage(ctx.url.searchParams.get("page")),
        search: search ?? undefined,
      });
    const posts = await attachComments(rawPosts);

    return {
      data: {
        cityName: user.street.city.name,
        posts,
        page,
        totalPages,
        totalCount,
        search,
        backPath: ctx.url.pathname + ctx.url.search,
        postError: null,
        postPublished: ctx.url.searchParams.get("published") === "1",
        editError: ctx.url.searchParams.get("edit_error") === "1",
        reponseError: ctx.url.searchParams.get("reponse_error") === "1",
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
    const { posts: rawPosts, totalPages, totalCount, page } =
      await listCityRecommendations({ cityId: user.street.city.id, page: 1 });
    const posts = await attachComments(rawPosts);

    return {
      data: {
        cityName: user.street.city.name,
        posts,
        page,
        totalPages,
        totalCount,
        search: null,
        backPath: "/recommandations",
        postError: error,
        postPublished: false,
        editError: false,
        reponseError: false,
        postDuration,
        postDurationMonths,
        postContent: content,
      },
    };
  },
});

function pageHref(page: number, search: string | null): string {
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return qs ? `/recommandations?${qs}` : "/recommandations";
}

export default define.page<typeof handler>(
  function Recommandations({ data, state }) {
    const {
      cityName,
      posts,
      page,
      totalPages,
      totalCount,
      search,
      backPath,
      postError,
      postPublished,
      editError,
      reponseError,
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
            {editError && (
              <p class="form-error" role="alert">
                Votre correction n'a pas été enregistrée : merci de reformuler,
                ce message contient des termes non autorisés.
              </p>
            )}
            {reponseError && (
              <p class="form-error" role="alert">
                Votre réponse n'a pas été enregistrée : merci de reformuler, ce
                message contient des termes non autorisés.
              </p>
            )}

            {
              /* Avant de publier : retrouver une recommandation déjà donnée
                (cf. backlog), pour ne pas reposer une question résolue. */
            }
            <form method="GET" class="reco-search">
              <input
                type="search"
                name="q"
                class="lookup-form__input"
                placeholder="Rechercher (ex : plombier, Dupont…)"
                maxlength={MAX_SEARCH_LENGTH}
                value={search ?? ""}
                autocomplete="off"
              />
              <button type="submit" class="button button--secondary">
                Rechercher
              </button>
            </form>

            {search && (
              <p class="reco-search__status">
                {totalCount === 0 ? <>Aucun résultat pour « {search} ».</> : (
                  <>
                    {totalCount} résultat{totalCount > 1 ? "s" : ""} pour «{" "}
                    {search} ».
                  </>
                )} <a href="/recommandations">Réinitialiser</a>
              </p>
            )}

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

                  {
                    /* Formulaire d'édition posé ici, à la place du contenu
                      ci-dessus (masqué par CSS dès que la case cochée dans
                      .reco-post__owner-actions plus bas est cochée) plutôt
                      que replié sous les boutons Modifier/Supprimer — cf.
                      retour utilisateur : le champ de saisie doit remplacer
                      visuellement le texte, pas s'ajouter plus bas. */
                  }
                  {state.user && item.authorId === state.user.id && (
                    <form
                      method="POST"
                      action="/modifier"
                      class="reco-post__edit-form"
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

                  <p class="reco-post__author">{item.authorLogin}</p>

                  {
                    /* Corriger ou supprimer sa propre demande (cf. backlog
                      « corriger des erreurs de saisie ») — jamais proposé
                      sur la demande d'un autre. */
                  }
                  {state.user && item.authorId === state.user.id && (
                    <div class="reco-post__owner-actions">
                      <input
                        type="checkbox"
                        id={`reco-edit-toggle-${item.id}`}
                        class="reco-post__edit-toggle"
                      />
                      <label
                        for={`reco-edit-toggle-${item.id}`}
                        class="reco-post__owner-link"
                      >
                        Modifier
                      </label>

                      <input
                        type="checkbox"
                        id={`reco-delete-toggle-${item.id}`}
                        class="reco-post__delete-toggle"
                      />
                      <label
                        for={`reco-delete-toggle-${item.id}`}
                        class="reco-post__owner-link reco-post__owner-link--danger"
                      >
                        Supprimer
                      </label>
                    </div>
                  )}

                  {
                    /* Confirmation de suppression : un bandeau posé en pleine
                      largeur sous les pilules (masqué par CSS tant que la
                      case ci-dessus n'est pas cochée), plutôt qu'imbriqué
                      dans un <details> "Supprimer" — qui l'écrasait à côté
                      de "Modifier" en cas d'ouverture (cf. retour
                      utilisateur). */
                  }
                  {state.user && item.authorId === state.user.id && (
                    <form
                      method="POST"
                      action="/supprimer"
                      class="reco-post__delete-form"
                    >
                      <input type="hidden" name="postId" value={item.id} />
                      <input type="hidden" name="back" value={backPath} />
                      <p class="reco-post__delete-confirm">
                        Confirmer la suppression de cette demande ?
                      </p>
                      <button type="submit" class="button button--secondary">
                        Oui, supprimer
                      </button>
                    </form>
                  )}

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
                      {search && (
                        <input type="hidden" name="q" value={search} />
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
                      href={pageHref(page - 1, search)}
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
                      href={pageHref(page + 1, search)}
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
