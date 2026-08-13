import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "./client.ts";
import { comment, user } from "./schema.ts";

export type Comment = typeof comment.$inferSelect;

/** Une réponse tient en une phrase, comme une demande (cf. posts.ts) — un nom, un cabinet, une raison de faire confiance, pas un roman. */
export const MAX_COMMENT_CONTENT_LENGTH = 280;

export interface CreateCommentInput {
  userId: number;
  postId: number;
  content: string;
}

/**
 * Enregistre une réponse publique à une demande, quel que soit son type (cf.
 * routes/reponses.ts) — aucune vérification d'appartenance ni de modération
 * ici, faites par l'appelant avant insertion (même partage des
 * responsabilités que `createPost`).
 */
export async function createComment(
  input: CreateCommentInput,
): Promise<Comment> {
  const [created] = await db.insert(comment).values({
    userId: input.userId,
    postId: input.postId,
    content: input.content,
  }).returning();
  return created;
}

/**
 * Supprime (soft delete) toutes les réponses encore actives d'un habitant —
 * utilisé par la suppression de compte (cf.
 * db/account.ts#deleteUserAccount).
 */
export async function softDeleteUserComments(userId: number): Promise<void> {
  await db.update(comment)
    .set({ deletedAt: new Date() })
    .where(and(eq(comment.userId, userId), isNull(comment.deletedAt)));
}

export interface PostComment {
  id: number;
  content: string;
  createdAt: Date;
  authorId: number;
  authorLogin: string;
}

/**
 * Réponses (non supprimées) de chaque demande de `postIds`, de la plus
 * ancienne à la plus récente — ordre naturel d'une conversation, à
 * l'inverse du fil lui-même. Toujours publiques (contrairement aux tapeurs
 * de `listTappers`, réservés à l'auteur) : c'est leur intérêt — la réponse
 * donnée à un voisin doit rester visible au prochain qui pose la même
 * question (cf. backlog « retrouver les recommandations déjà données »).
 */
export async function listCommentsByPost(
  postIds: number[],
): Promise<Map<number, PostComment[]>> {
  if (postIds.length === 0) return new Map();

  const rows = await db.select({
    postId: comment.postId,
    id: comment.id,
    content: comment.content,
    createdAt: comment.createdAt,
    authorId: user.id,
    authorLogin: user.login,
  })
    .from(comment)
    .innerJoin(user, eq(comment.userId, user.id))
    .where(and(inArray(comment.postId, postIds), isNull(comment.deletedAt)))
    .orderBy(comment.createdAt);

  const commentsByPost = new Map<number, PostComment[]>();
  for (const { postId, ...rest } of rows) {
    const list = commentsByPost.get(postId) ?? [];
    list.push(rest);
    commentsByPost.set(postId, list);
  }
  return commentsByPost;
}
