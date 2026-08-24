import {
  countTapsByPost,
  findTappedPostIds,
  listTappers,
  type Tapper,
} from "./taps.ts";
import { listCommentsByPost, type PostComment } from "./comments.ts";
import type { StreetPost } from "./posts.ts";

/**
 * Une demande du fil, avec les à-côtés (taps, réponses) — partagé entre
 * routes/fil.tsx (web) et routes/api/v1/posts/index.ts (mobile) : même
 * fil, même règles, un seul endroit qui les calcule.
 */
export interface PostWithExtras extends StreetPost {
  tapCount: number;
  viewerHasTapped: boolean;
  /** Qui a tapé — rempli seulement pour ses propres demandes (cf. backlog
   * « qui a tapé sur mes messages, au survol » et « message privé à un
   * tapeur pour s'organiser »), vide sinon : pas besoin d'exposer qui a
   * répondu chez les autres. */
  tappers: Tapper[];
  /** Réponses publiques déjà données (cf. db/comments.ts) — toujours
   * visibles, quel que soit l'auteur : contrairement aux tapeurs, l'intérêt
   * d'une réponse publique est justement de rester visible au prochain
   * habitant qui pose la même question (cf. backlog « retrouver les
   * réponses déjà données »). */
  comments: PostComment[];
}

/** Complète chaque demande avec son nombre de taps, si `viewerId` a déjà tapé, qui a tapé sur ses propres demandes, et ses réponses publiques déjà données. */
export async function attachPostExtras(
  posts: StreetPost[],
  viewerId: number,
): Promise<PostWithExtras[]> {
  const postIds = posts.map((p) => p.id);
  const ownPostIds = posts.filter((p) => p.authorId === viewerId).map((p) =>
    p.id
  );
  const [counts, tapped, tappersByPost, commentsByPost] = await Promise.all([
    countTapsByPost(postIds),
    findTappedPostIds(viewerId, postIds),
    listTappers(ownPostIds),
    listCommentsByPost(postIds),
  ]);
  return posts.map((p) => ({
    ...p,
    tapCount: counts.get(p.id) ?? 0,
    viewerHasTapped: tapped.has(p.id),
    tappers: tappersByPost.get(p.id) ?? [],
    comments: commentsByPost.get(p.id) ?? [],
  }));
}
