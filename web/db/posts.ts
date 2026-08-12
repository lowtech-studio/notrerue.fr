import {
  and,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  ne,
  or,
} from "drizzle-orm";
import { db } from "./client.ts";
import { comment, house, post, postType, street, user } from "./schema.ts";
import { escapeLikePattern } from "../utils/validation.ts";

export type Post = typeof post.$inferSelect;
export type PostType = (typeof postType.enumValues)[number];

/**
 * Les trois types publiés et lus sur /fil, à l'échelle d'une rue —
 * "recommandation" n'en fait pas partie : ce type se publie et se lit sur
 * /recommandations, à l'échelle d'une ville (cf. schema.ts). Distingué du
 * `PostType` complet pour qu'un `type` invalide (y compris
 * "recommandation") ne puisse pas atterrir sur /fil via un formulaire forgé.
 */
export type FilPostType = Exclude<PostType, "recommandation">;

/**
 * Une demande tient en une phrase (cf. backlog « publier en moins de 30
 * secondes ») : limite courte, façon SMS, plutôt qu'un article.
 */
export const MAX_POST_CONTENT_LENGTH = 240;

/** Recherche libre sur /fil et /recommandations, et bornage des champs `q` repris tels quels par /taps et /reponses (cf. backlog « retrouver les recommandations déjà données ») — large, une longue phrase collée reste inoffensive vu le `ilike` en base. */
export const MAX_SEARCH_LENGTH = 100;

/** Vrai si `value` est bien l'une des quatre valeurs de l'enum `post_type`. */
export function isPostType(value: string): value is PostType {
  return (postType.enumValues as readonly string[]).includes(value);
}

/** Vrai si `value` est un des trois types publiables sur /fil (cf. `FilPostType`). */
export function isFilPostType(value: string): value is FilPostType {
  return isPostType(value) && value !== "recommandation";
}

/**
 * Durée de validité choisie à la publication (cf. backlog « le fil ne se
 * remplisse pas de demandes mortes »). `"months"` est complété par un nombre
 * de mois (cf. `MIN_POST_DURATION_MONTHS`/`MAX_POST_DURATION_MONTHS`), les
 * deux autres sont des durées fixes.
 */
export const POST_DURATIONS = ["today", "week", "months"] as const;
export type PostDuration = (typeof POST_DURATIONS)[number];

export function isPostDuration(value: string): value is PostDuration {
  return (POST_DURATIONS as readonly string[]).includes(value);
}

export const MIN_POST_DURATION_MONTHS = 1;
export const MAX_POST_DURATION_MONTHS = 6;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Date d'expiration à enregistrer sur la demande, depuis la durée choisie.
 * `months` n'est utilisé (et validé/plafonné) que pour `duration ===
 * "months"` ; ignoré sinon. Durée fixe depuis l'instant de publication —
 * pas de calage sur la fin de journée calendaire, aucun fuseau horaire par
 * habitant n'étant stocké.
 */
export function computeExpiresAt(
  duration: PostDuration,
  months: number,
  now: Date = new Date(),
): Date {
  if (duration === "today") return new Date(now.getTime() + DAY_MS);
  if (duration === "week") return new Date(now.getTime() + 7 * DAY_MS);

  const clampedMonths = Math.min(
    Math.max(
      Math.round(months) || MIN_POST_DURATION_MONTHS,
      MIN_POST_DURATION_MONTHS,
    ),
    MAX_POST_DURATION_MONTHS,
  );
  const expiresAt = new Date(now);
  expiresAt.setMonth(expiresAt.getMonth() + clampedMonths);
  return expiresAt;
}

export interface CreatePostInput {
  userId: number;
  type: PostType;
  content: string;
  /**
   * Calculée par l'appelant via `computeExpiresAt` (cf. backlog « choisir
   * la durée de validité de ma demande à chaque publication ») ; la route
   * /fil rend ce choix obligatoire. Optionnelle ici seulement pour ne pas
   * forcer chaque appelant existant (tests, scripts) à s'en soucier —
   * retombe sur une semaine si omise.
   */
  expiresAt?: Date;
}

/**
 * Enregistre une demande. Aucune vérification d'appartenance à une rue ici
 * (le foyer de l'auteur la détermine déjà) ni de modération : ces contrôles
 * sont faits par l'appelant (route) avant insertion.
 */
export async function createPost(input: CreatePostInput): Promise<Post> {
  const [created] = await db.insert(post).values({
    userId: input.userId,
    type: input.type,
    content: input.content,
    expiresAt: input.expiresAt ?? computeExpiresAt("week", 1),
  }).returning();
  return created;
}

/**
 * Corrige le contenu d'une demande (cf. backlog « corriger des erreurs de
 * saisie ») — seulement le texte, pas le type ni la durée : une coquille se
 * corrige, une demande ne change pas de nature après coup. `null` si
 * `postId` n'existe pas, n'appartient pas à `userId` ou est déjà supprimée
 * (vérifié en base, pas seulement côté UI — cf. `toggleTap` pour la même
 * précaution).
 */
export async function updatePostContent(
  postId: number,
  userId: number,
  content: string,
): Promise<Post | null> {
  const [updated] = await db.update(post)
    .set({ content })
    .where(
      and(eq(post.id, postId), eq(post.userId, userId), isNull(post.deletedAt)),
    )
    .returning();
  return updated ?? null;
}

/**
 * Supprime (soft delete) une demande — invisible dès lors partout
 * (`listStreetPosts`/`listCityRecommendations`/`getPostSummary` filtrent
 * déjà `isNull(post.deletedAt)`), sans effacer taps/commentaires déjà
 * associés. Vrai seulement si une ligne appartenant à `userId` et pas déjà
 * supprimée a été trouvée.
 */
export async function softDeletePost(
  postId: number,
  userId: number,
): Promise<boolean> {
  const updated = await db.update(post)
    .set({ deletedAt: new Date() })
    .where(
      and(eq(post.id, postId), eq(post.userId, userId), isNull(post.deletedAt)),
    )
    .returning({ id: post.id });
  return updated.length > 0;
}

/**
 * Supprime (soft delete) toutes les demandes/recommandations encore actives
 * d'un habitant — utilisé par la suppression de compte (cf.
 * db/account.ts#deleteUserAccount), pas de vérification d'appartenance ici
 * puisque déjà filtré par `userId`.
 */
export async function softDeleteUserPosts(userId: number): Promise<void> {
  await db.update(post)
    .set({ deletedAt: new Date() })
    .where(and(eq(post.userId, userId), isNull(post.deletedAt)));
}

/** Page où se lit une demande selon son type — /recommandations pour les recommandations, /fil pour les trois autres (cf. schema.ts). */
export function postListPath(type: PostType): "/fil" | "/recommandations" {
  return type === "recommandation" ? "/recommandations" : "/fil";
}

/** Nombre de demandes affichées par page du fil (cf. backlog éco-conception : pagination plutôt que défilement infini). */
export const POSTS_PER_PAGE = 20;

export interface StreetPost {
  id: number;
  /** Jamais "recommandation" (cf. `listStreetPosts`, qui l'exclut toujours en base). */
  type: FilPostType;
  content: string;
  createdAt: Date;
  authorId: number;
  authorLogin: string;
}

export interface ListStreetPostsInput {
  streetId: number;
  /** Filtre optionnel par type ; les trois types de /fil si absent. */
  type?: FilPostType;
  /** Page 1-indexée. */
  page: number;
  /**
   * Recherche libre (même principe que sur /recommandations, cf.
   * `ListCityRecommendationsInput.search`) : filtre sur le contenu de la
   * demande. Pas de réponses à chercher ici (contrairement aux
   * recommandations) — /fil se répond par tap + message privé, jamais par
   * commentaire public.
   */
  search?: string;
  /** N'est là que pour les tests (déterministe) ; sinon l'instant courant. */
  now?: Date;
}

export interface ListStreetPostsResult {
  posts: StreetPost[];
  totalCount: number;
  totalPages: number;
  /** Page réellement servie (`input.page` ramenée dans `[1, totalPages]`). */
  page: number;
}

/**
 * Fil chronologique (plus récent d'abord) d'une seule rue, celle de
 * l'auteur — jamais toutes les rues confondues (cf. backlog « ma rue
 * seule »). Filtrable par type, paginé. Les demandes expirées (cf. backlog
 * « le fil ne se remplisse pas de demandes mortes ») sont exclues ;
 * `expiresAt` nul (demandes publiées avant l'ajout de cette fonctionnalité)
 * reste visible indéfiniment. Les demandes de recommandation sont toujours
 * exclues (`ne(post.type, "recommandation")`, même sans filtre `type`) :
 * elles se lisent sur /recommandations, à l'échelle de la ville — sinon un
 * habitant les verrait deux fois, ici pour sa rue et là pour sa ville.
 */
export async function listStreetPosts(
  input: ListStreetPostsInput,
): Promise<ListStreetPostsResult> {
  const now = input.now ?? new Date();
  const search = input.search?.trim();
  const where = and(
    eq(house.streetId, input.streetId),
    isNull(post.deletedAt),
    or(isNull(post.expiresAt), gt(post.expiresAt, now)),
    ne(post.type, "recommandation"),
    input.type ? eq(post.type, input.type) : undefined,
    search ? ilike(post.content, `%${escapeLikePattern(search)}%`) : undefined,
  );

  const [{ value: totalCount }] = await db.select({ value: count() })
    .from(post)
    .innerJoin(user, eq(post.userId, user.id))
    .innerJoin(house, eq(user.houseId, house.id))
    .where(where);

  const totalPages = Math.max(1, Math.ceil(totalCount / POSTS_PER_PAGE));
  const page = Math.min(Math.max(1, input.page), totalPages);

  const rows = await db.select({
    id: post.id,
    type: post.type,
    content: post.content,
    createdAt: post.createdAt,
    authorId: user.id,
    authorLogin: user.login,
  })
    .from(post)
    .innerJoin(user, eq(post.userId, user.id))
    .innerJoin(house, eq(user.houseId, house.id))
    .where(where)
    // `id` en second critère : deux demandes créées à la même seconde (ou un
    // insert en masse) auraient sinon un ordre instable d'une requête à
    // l'autre, avec un risque de doublons/trous entre deux pages (cf. revue).
    .orderBy(desc(post.createdAt), desc(post.id))
    .limit(POSTS_PER_PAGE)
    .offset((page - 1) * POSTS_PER_PAGE);

  // `rows[].type` est typé `PostType` par Drizzle (colonne `post.type`, les
  // quatre valeurs), mais `where` exclut toujours "recommandation" : le
  // rétrécir à `FilPostType` documente cette garantie plutôt que de
  // l'exposer aux appelants (cf. commentaire de `listStreetPosts`).
  return { posts: rows as StreetPost[], totalCount, totalPages, page };
}

export interface PostSummary {
  id: number;
  type: PostType;
  content: string;
  authorId: number;
  streetId: number;
  /** Ville de l'auteur — sert à vérifier une réponse à une recommandation (cf. routes/reponses.ts), portée city plutôt que street pour ce seul type. */
  cityId: number;
}

/**
 * Aperçu léger d'une demande (avec la rue et la ville de son auteur), pour
 * donner du contexte à un message privé démarré depuis un bouton sur cette
 * demande (cf. backlog messagerie privée) ou vérifier une réponse à une
 * recommandation (cf. routes/reponses.ts) — sans passer par
 * `listStreetPosts`/`listCityRecommendations`, pas faites pour n'en
 * récupérer qu'une seule.
 */
export async function getPostSummary(
  postId: number,
): Promise<PostSummary | null> {
  const [found] = await db.select({
    id: post.id,
    type: post.type,
    content: post.content,
    authorId: user.id,
    streetId: house.streetId,
    cityId: street.cityId,
  })
    .from(post)
    .innerJoin(user, eq(post.userId, user.id))
    .innerJoin(house, eq(user.houseId, house.id))
    .innerJoin(street, eq(house.streetId, street.id))
    .where(and(eq(post.id, postId), isNull(post.deletedAt)));
  return found ?? null;
}

export interface CityRecommendationPost {
  id: number;
  content: string;
  createdAt: Date;
  authorId: number;
  authorLogin: string;
  /** Affichée sur la vignette : à l'échelle d'une ville, préciser la rue de l'auteur donne un repère utile (cf. backlog). */
  authorStreetName: string;
}

export interface ListCityRecommendationsInput {
  cityId: number;
  /** Page 1-indexée. */
  page: number;
  /**
   * Recherche libre (cf. backlog « retrouver les recommandations déjà
   * données ») : filtre sur la demande ET sur les réponses déjà publiées
   * (cf. `findPostIdsWithMatchingComment`) — la réponse cherchée est
   * souvent un nom d'artisan qui ne figure que dans une réponse, pas dans
   * la demande elle-même.
   */
  search?: string;
  /** N'est là que pour les tests (déterministe) ; sinon l'instant courant. */
  now?: Date;
}

export interface ListCityRecommendationsResult {
  posts: CityRecommendationPost[];
  totalCount: number;
  totalPages: number;
  /** Page réellement servie (`input.page` ramenée dans `[1, totalPages]`). */
  page: number;
}

/** Identifiants des demandes ayant au moins une réponse (non supprimée) contenant `search`. */
async function findPostIdsWithMatchingComment(
  search: string,
): Promise<number[]> {
  const pattern = `%${escapeLikePattern(search)}%`;
  const rows = await db.selectDistinct({ postId: comment.postId }).from(
    comment,
  ).where(and(ilike(comment.content, pattern), isNull(comment.deletedAt)));
  return rows.map((row) => row.postId).filter((id) => id !== null);
}

/**
 * Demandes de recommandation (plus récentes d'abord) de toute une ville —
 * seul type de demande qui dépasse la rue de son auteur (cf. schema.ts :
 * une seule rue est un bassin trop petit pour connaître un bon artisan).
 * Mêmes règles d'expiration que `listStreetPosts`.
 */
export async function listCityRecommendations(
  input: ListCityRecommendationsInput,
): Promise<ListCityRecommendationsResult> {
  const now = input.now ?? new Date();
  const search = input.search?.trim();
  const matchingCommentPostIds = search
    ? await findPostIdsWithMatchingComment(search)
    : [];
  const searchCondition = search
    ? or(
      ilike(post.content, `%${escapeLikePattern(search)}%`),
      matchingCommentPostIds.length > 0
        ? inArray(post.id, matchingCommentPostIds)
        : undefined,
    )
    : undefined;

  const where = and(
    eq(street.cityId, input.cityId),
    eq(post.type, "recommandation"),
    isNull(post.deletedAt),
    or(isNull(post.expiresAt), gt(post.expiresAt, now)),
    searchCondition,
  );

  const [{ value: totalCount }] = await db.select({ value: count() })
    .from(post)
    .innerJoin(user, eq(post.userId, user.id))
    .innerJoin(house, eq(user.houseId, house.id))
    .innerJoin(street, eq(house.streetId, street.id))
    .where(where);

  const totalPages = Math.max(1, Math.ceil(totalCount / POSTS_PER_PAGE));
  const page = Math.min(Math.max(1, input.page), totalPages);

  const rows = await db.select({
    id: post.id,
    content: post.content,
    createdAt: post.createdAt,
    authorId: user.id,
    authorLogin: user.login,
    authorStreetName: street.name,
  })
    .from(post)
    .innerJoin(user, eq(post.userId, user.id))
    .innerJoin(house, eq(user.houseId, house.id))
    .innerJoin(street, eq(house.streetId, street.id))
    .where(where)
    // `id` en second critère : cf. `listStreetPosts`, même raison (ordre
    // stable entre deux pages malgré des demandes créées à la même seconde).
    .orderBy(desc(post.createdAt), desc(post.id))
    .limit(POSTS_PER_PAGE)
    .offset((page - 1) * POSTS_PER_PAGE);

  return { posts: rows, totalCount, totalPages, page };
}
