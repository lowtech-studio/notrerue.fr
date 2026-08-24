import type { PostType } from "../../../../db/posts.ts";
import type { PostWithExtras } from "../../../../db/post_feed.ts";

export interface CommentDto {
  id: number;
  content: string;
  /** ISO 8601 — `Date` ne traverse pas JSON telle quelle. */
  createdAt: string;
  authorId: number;
  authorLogin: string;
}

export interface TapperDto {
  id: number;
  login: string;
}

export interface PostDto {
  id: number;
  type: PostType;
  content: string;
  createdAt: string;
  authorId: number;
  authorLogin: string;
  /** `id` seulement (pas les octets) : le client construit lui-même
   * `/photos/{id}` (cf. routes/photos/[id].ts, déjà authentifié par
   * Bearer). */
  image: { id: number; width: number; height: number } | null;
  tapCount: number;
  viewerHasTapped: boolean;
  /** Rempli seulement sur ses propres demandes (cf. db/post_feed.ts). */
  tappers: TapperDto[];
  comments: CommentDto[];
}

/** `PostWithExtras` (dates, cf. db/post_feed.ts) → JSON. Partagé par
 * GET (liste) et POST (demande tout juste créée) de ce dossier, pour que
 * les deux réponses aient exactement la même forme côté client. */
export function toPostDto(post: PostWithExtras): PostDto {
  return {
    id: post.id,
    type: post.type,
    content: post.content,
    createdAt: post.createdAt.toISOString(),
    authorId: post.authorId,
    authorLogin: post.authorLogin,
    image: post.image,
    tapCount: post.tapCount,
    viewerHasTapped: post.viewerHasTapped,
    tappers: post.tappers,
    comments: post.comments.map((c) => ({
      id: c.id,
      content: c.content,
      createdAt: c.createdAt.toISOString(),
      authorId: c.authorId,
      authorLogin: c.authorLogin,
    })),
  };
}
