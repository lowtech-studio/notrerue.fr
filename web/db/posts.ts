import { and, count, desc, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "./client.ts";
import { house, post, postType, user } from "./schema.ts";

export type Post = typeof post.$inferSelect;
export type PostType = (typeof postType.enumValues)[number];

/**
 * Une demande tient en une phrase (cf. backlog « publier en moins de 30
 * secondes ») : limite courte, façon SMS, plutôt qu'un article.
 */
export const MAX_POST_CONTENT_LENGTH = 240;

/** Vrai si `value` est bien l'une des trois valeurs de l'enum `post_type`. */
export function isPostType(value: string): value is PostType {
  return (postType.enumValues as readonly string[]).includes(value);
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

/** Nombre de demandes affichées par page du fil (cf. backlog éco-conception : pagination plutôt que défilement infini). */
export const POSTS_PER_PAGE = 20;

export interface StreetPost {
  id: number;
  type: PostType;
  content: string;
  createdAt: Date;
  authorId: number;
  authorLogin: string;
}

export interface ListStreetPostsInput {
  streetId: number;
  /** Filtre optionnel par type ; toutes les demandes si absent. */
  type?: PostType;
  /** Page 1-indexée. */
  page: number;
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
 * reste visible indéfiniment.
 */
export async function listStreetPosts(
  input: ListStreetPostsInput,
): Promise<ListStreetPostsResult> {
  const now = input.now ?? new Date();
  const where = and(
    eq(house.streetId, input.streetId),
    isNull(post.deletedAt),
    or(isNull(post.expiresAt), gt(post.expiresAt, now)),
    input.type ? eq(post.type, input.type) : undefined,
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

  return { posts: rows, totalCount, totalPages, page };
}

export interface PostSummary {
  id: number;
  type: PostType;
  content: string;
  authorId: number;
  streetId: number;
}

/**
 * Aperçu léger d'une demande (avec la rue de son auteur), pour donner du
 * contexte à un message privé démarré depuis un bouton sur cette demande
 * (cf. backlog messagerie privée) — sans passer par `listStreetPosts`, pas
 * fait pour n'en récupérer qu'une seule.
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
  })
    .from(post)
    .innerJoin(user, eq(post.userId, user.id))
    .innerJoin(house, eq(user.houseId, house.id))
    .where(and(eq(post.id, postId), isNull(post.deletedAt)));
  return found ?? null;
}
