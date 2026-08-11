import { and, count, desc, eq, isNull } from "drizzle-orm";
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

export interface CreatePostInput {
  userId: number;
  type: PostType;
  content: string;
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
 * seule »). Filtrable par type, paginé.
 */
export async function listStreetPosts(
  input: ListStreetPostsInput,
): Promise<ListStreetPostsResult> {
  const where = and(
    eq(house.streetId, input.streetId),
    isNull(post.deletedAt),
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
    .orderBy(desc(post.createdAt))
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
