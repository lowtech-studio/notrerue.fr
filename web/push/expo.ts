import { clearPushToken, findPushRecipients } from "../db/push.ts";
import { findStreetUsers } from "../db/users.ts";
import type { PostType } from "../db/posts.ts";

const EXPO_PUSH_API_URL = "https://exp.host/--/api/v2/push/send";

/** Limite recommandée par le service de push Expo pour un seul appel à
 * `/send` (au-delà, découper en plusieurs requêtes). */
const MAX_MESSAGES_PER_REQUEST = 100;

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

interface ExpoPushTicket {
  status: "ok" | "error";
  details?: { error?: string };
}

/**
 * Envoie un même message à un lot de destinataires via le service de push
 * Expo (une seule API HTTPS pour APNs et FCM, cf.
 * _doc/architecture-mobile.md « Notifications push »). Lève en cas
 * d'échec réseau/HTTP — comme email/brevo.ts#sendEmail, à charge de
 * l'appelant de tolérer l'échec (try/catch, jamais remonté en échec de la
 * requête principale qui déclenche la notification).
 *
 * Retire au passage les jetons qu'Expo signale invalides
 * (`DeviceNotRegistered` — app désinstallée, jeton expiré...) : sans ça,
 * chaque notification suivante retenterait indéfiniment un jeton mort.
 */
async function sendExpoPush(
  recipients: { userId: number; token: string }[],
  message: PushMessage,
): Promise<void> {
  for (let i = 0; i < recipients.length; i += MAX_MESSAGES_PER_REQUEST) {
    const batch = recipients.slice(i, i + MAX_MESSAGES_PER_REQUEST);
    const response = await fetch(EXPO_PUSH_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept": "application/json",
      },
      body: JSON.stringify(batch.map((r) => ({ to: r.token, ...message }))),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Échec de l'envoi de la notification push via Expo (${response.status}) : ${body}`,
      );
    }

    const json = await response.json() as { data?: ExpoPushTicket[] };
    const tickets = json.data ?? [];
    await Promise.allSettled(
      tickets.map((ticket, index) =>
        ticket.status === "error" &&
          ticket.details?.error === "DeviceNotRegistered"
          ? clearPushToken(batch[index].userId)
          : Promise.resolve()
      ),
    );
  }
}

const POST_TYPE_LABELS: Record<PostType, string> = {
  cherche: "Je cherche",
  propose: "Je propose",
  informe: "J'informe",
};

/** Longueur maximale du corps d'une notification — un écran verrouillé
 * n'affiche de toute façon qu'un extrait, pas besoin de porter la demande
 * en entier (cf. MAX_POST_CONTENT_LENGTH = 240, déjà court). */
const MAX_BODY_LENGTH = 100;

function truncate(text: string): string {
  return text.length > MAX_BODY_LENGTH
    ? `${text.slice(0, MAX_BODY_LENGTH - 1)}…`
    : text;
}

/** Construction pure du message — testable sans réseau (cf.
 * email/brevo.ts#buildXEmail, même principe). */
export function buildNewPostMessage(
  authorLogin: string,
  postType: PostType,
  postContent: string,
): PushMessage {
  return {
    title: `${authorLogin} — ${POST_TYPE_LABELS[postType]}`,
    body: truncate(postContent),
    data: { type: "post" },
  };
}

export function buildTapMessage(
  tapperLogin: string,
  postContent: string,
): PushMessage {
  return {
    title: `${tapperLogin} a répondu à votre demande`,
    body: truncate(postContent),
    data: { type: "tap" },
  };
}

export function buildReplyMessage(
  replierLogin: string,
  replyContent: string,
): PushMessage {
  return {
    title: `${replierLogin} a répondu à votre demande`,
    // Le texte de la réponse elle-même, pas la demande d'origine (déjà
    // connue de son auteur) — même choix que
    // buildReplyNotificationEmail côté e-mail, qui met la réponse en
    // avant (cf. email/brevo.ts).
    body: truncate(replyContent),
    data: { type: "reply" },
  };
}

export function buildMessageMessage(senderLogin: string): PushMessage {
  return {
    title: `Nouveau message de ${senderLogin}`,
    // Contenu jamais repris ici : un message privé ne doit pas fuiter sur
    // un écran verrouillé (même logique que
    // buildMessageNotificationEmail côté e-mail, cf. email/brevo.ts).
    body: "Touchez pour lire le message.",
    data: { type: "message" },
  };
}

/**
 * Nouvelle demande publiée sur la rue — tous les voisins sauf l'auteur (cf.
 * backlog mobile « notifié... lors de l'ajout d'une demande dans ma
 * rue »). Contrairement aux trois notifications suivantes (un seul
 * destinataire), celle-ci peut viser toute une rue : batché par
 * `sendExpoPush`, filtré par `findPushRecipients` (jeton enregistré, pas
 * en pause) avant tout appel réseau.
 */
export async function notifyNewPost(input: {
  streetId: number;
  authorId: number;
  authorLogin: string;
  postType: PostType;
  postContent: string;
}): Promise<void> {
  const streetUsers = await findStreetUsers(input.streetId);
  const candidateIds = streetUsers.map((u) => u.id).filter((id) =>
    id !== input.authorId
  );
  const recipients = await findPushRecipients(candidateIds);
  if (recipients.length === 0) return;
  await sendExpoPush(
    recipients,
    buildNewPostMessage(input.authorLogin, input.postType, input.postContent),
  );
}

/** Un voisin a répondu en un tap à une de mes demandes. */
export async function notifyTap(input: {
  authorId: number;
  tapperLogin: string;
  postContent: string;
}): Promise<void> {
  const recipients = await findPushRecipients([input.authorId]);
  if (recipients.length === 0) return;
  await sendExpoPush(
    recipients,
    buildTapMessage(input.tapperLogin, input.postContent),
  );
}

/** Un voisin a répondu publiquement à une de mes demandes. */
export async function notifyReply(input: {
  authorId: number;
  replierLogin: string;
  replyContent: string;
}): Promise<void> {
  const recipients = await findPushRecipients([input.authorId]);
  if (recipients.length === 0) return;
  await sendExpoPush(
    recipients,
    buildReplyMessage(input.replierLogin, input.replyContent),
  );
}

/** Nouveau message privé reçu. */
export async function notifyMessage(input: {
  recipientId: number;
  senderLogin: string;
}): Promise<void> {
  const recipients = await findPushRecipients([input.recipientId]);
  if (recipients.length === 0) return;
  await sendExpoPush(recipients, buildMessageMessage(input.senderLogin));
}
