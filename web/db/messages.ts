import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "./client.ts";
import { message, user } from "./schema.ts";

export type Message = typeof message.$inferSelect;

/**
 * Un message privé peut être plus long qu'une demande du fil (240
 * caractères) : c'est une conversation, pas une phrase d'accroche — mais
 * reste borné pour rester lisible sur un fil de discussion sans scroll
 * interminable.
 */
export const MAX_MESSAGE_CONTENT_LENGTH = 1000;

export interface SendMessageInput {
  fromUserId: number;
  toUserId: number;
  /** Demande à l'origine du message, le cas échéant (cf. backlog « bouton via une demande »). */
  postId?: number | null;
  content: string;
}

/**
 * Enregistre un message privé. Aucune vérification (destinataire réel,
 * même rue, contenu modéré) ici : à la charge de l'appelant (route), comme
 * pour `createPost`.
 */
export async function sendMessage(input: SendMessageInput): Promise<Message> {
  const [created] = await db.insert(message).values({
    userFromId: input.fromUserId,
    userToId: input.toUserId,
    postId: input.postId ?? null,
    content: input.content,
  }).returning();
  return created;
}

export interface ConversationSummary {
  otherUserId: number;
  otherUserLogin: string;
  lastMessage: string;
  lastMessageAt: Date;
  /** Vrai si le dernier message de la conversation vient de l'utilisateur consulté (pour afficher « Vous : … »). */
  lastMessageFromViewer: boolean;
}

/**
 * Une ligne par interlocuteur, la conversation la plus récente d'abord (cf.
 * backlog « retrouver l'ensemble de mes messages »). Deux requêtes plutôt
 * qu'un self-join : on prend tous les messages impliquant `userId`, on
 * garde en JS la première occurrence (la plus récente, vu le tri) par
 * interlocuteur, puis on résout les logins en une seule requête — même
 * approche que `listTapperLogins` dans db/taps.ts.
 */
export async function listConversations(
  userId: number,
): Promise<ConversationSummary[]> {
  const rows = await db.select({
    content: message.content,
    createdAt: message.createdAt,
    userFromId: message.userFromId,
    userToId: message.userToId,
  })
    .from(message)
    .where(and(
      or(eq(message.userFromId, userId), eq(message.userToId, userId)),
      isNull(message.deletedAt),
    ))
    .orderBy(desc(message.createdAt));

  const latestByOther = new Map<number, (typeof rows)[number]>();
  const otherUserIds: number[] = [];
  for (const row of rows) {
    const otherId = row.userFromId === userId ? row.userToId : row.userFromId;
    if (latestByOther.has(otherId)) continue;
    latestByOther.set(otherId, row);
    otherUserIds.push(otherId);
  }

  if (otherUserIds.length === 0) return [];

  const logins = await db.select({ id: user.id, login: user.login })
    .from(user)
    .where(inArray(user.id, otherUserIds));
  const loginById = new Map(logins.map((row) => [row.id, row.login]));

  return otherUserIds.map((otherId) => {
    const row = latestByOther.get(otherId)!;
    return {
      otherUserId: otherId,
      otherUserLogin: loginById.get(otherId) ?? "",
      lastMessage: row.content,
      lastMessageAt: row.createdAt,
      lastMessageFromViewer: row.userFromId === userId,
    };
  });
}

export interface ThreadMessage {
  id: number;
  content: string;
  createdAt: Date;
  /** Vrai si envoyé par `userId` (l'utilisateur consulté), pour l'aligner à droite dans le fil de discussion. */
  fromViewer: boolean;
}

/** Messages échangés entre deux habitants, du plus ancien au plus récent. */
export async function getConversation(
  userId: number,
  otherUserId: number,
): Promise<ThreadMessage[]> {
  const rows = await db.select({
    id: message.id,
    content: message.content,
    createdAt: message.createdAt,
    userFromId: message.userFromId,
  })
    .from(message)
    .where(and(
      or(
        and(eq(message.userFromId, userId), eq(message.userToId, otherUserId)),
        and(eq(message.userFromId, otherUserId), eq(message.userToId, userId)),
      ),
      isNull(message.deletedAt),
    ))
    .orderBy(message.createdAt);

  return rows.map((row) => ({
    id: row.id,
    content: row.content,
    createdAt: row.createdAt,
    fromViewer: row.userFromId === userId,
  }));
}
