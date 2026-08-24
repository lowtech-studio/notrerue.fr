import { getPostSummary, type PostSummary } from "./posts.ts";

/** Contexte affiché en tête de conversation quand elle démarre depuis une
 * demande (cf. backlog « bouton via une demande ») — partagé entre
 * routes/messages.tsx (web) et routes/api/v1/messages/* (mobile), même
 * logique que db/post_feed.ts pour /fil. */
export interface PostContext {
  id: number;
  content: string;
}

/**
 * Contexte de demande à afficher, seulement s'il existe encore, appartient
 * à la même rue et a pour auteur l'un des deux participants — l'interlocuteur
 * (bouton « Message privé » sur sa demande) ou le viewer lui-même (lien
 * envoyé depuis un tapeur de sa propre demande, cf. backlog « message privé
 * à un tapeur pour s'organiser ») — sinon on l'ignore silencieusement
 * plutôt que de planter (postId manipulable dans l'URL).
 */
export async function resolvePostContext(
  postId: number | null,
  streetId: number,
  viewerId: number,
  otherUserId: number,
): Promise<PostContext | null> {
  if (!postId) return null;
  const summary: PostSummary | null = await getPostSummary(postId);
  if (!summary || summary.streetId !== streetId) return null;
  if (summary.authorId !== otherUserId && summary.authorId !== viewerId) {
    return null;
  }
  return { id: summary.id, content: summary.content };
}
