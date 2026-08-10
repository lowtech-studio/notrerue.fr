import { db } from "./client.ts";
import { post, postType } from "./schema.ts";

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
