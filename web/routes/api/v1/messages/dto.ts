import type {
  ConversationSummary,
  ThreadMessage,
} from "../../../../db/messages.ts";

export interface ConversationDto {
  otherUserId: number;
  otherUserLogin: string;
  lastMessage: string;
  /** ISO 8601 — `Date` ne traverse pas JSON telle quelle. */
  lastMessageAt: string;
  lastMessageFromViewer: boolean;
}

export function toConversationDto(c: ConversationSummary): ConversationDto {
  return {
    otherUserId: c.otherUserId,
    otherUserLogin: c.otherUserLogin,
    lastMessage: c.lastMessage,
    lastMessageAt: c.lastMessageAt.toISOString(),
    lastMessageFromViewer: c.lastMessageFromViewer,
  };
}

export interface ThreadMessageDto {
  id: number;
  content: string;
  createdAt: string;
  fromViewer: boolean;
}

export function toThreadMessageDto(m: ThreadMessage): ThreadMessageDto {
  return {
    id: m.id,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
    fromViewer: m.fromViewer,
  };
}
