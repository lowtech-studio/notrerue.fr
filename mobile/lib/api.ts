import { Platform } from "react-native";
import { getToken } from "./auth";

/**
 * Client HTTP vers l'API NotreRue.fr (`web/routes/api/v1/*`, `web/routes/api/villes.ts`)
 * — cf. _doc/architecture-mobile.md. `EXPO_PUBLIC_API_URL` (obligatoire,
 * préfixe requis par Expo pour exposer une variable au bundle) pointe vers
 * le serveur local en dev ou https://notrerue.fr en build (cf. .env.example,
 * eas.json).
 */
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

async function parseJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** Traduit une `Response` déjà reçue en `ApiResult` : succès → `{ ok: true,
 * data }`, échec HTTP → `{ ok: false, error }` avec le message renvoyé par
 * le backend (`{ error }`, cf. routes/api/v1/*) quand il est disponible.
 * Partagé par `postJson` et `authJson` pour ne pas dupliquer cette
 * traduction. */
async function toApiResult<T>(res: Response): Promise<ApiResult<T>> {
  const json = await parseJson(res);
  if (!res.ok) {
    const message = (json as { error?: string } | null)?.error ??
      "Une erreur est survenue.";
    return { ok: false, error: message };
  }
  return { ok: true, data: json as T };
}

/**
 * POST JSON générique (non authentifié — inscription/connexion) : succès →
 * `{ ok: true, data }`, échec (HTTP ou réseau) → `{ ok: false, error }` —
 * les écrans n'ont qu'à afficher `error` tel quel, jamais de try/catch
 * dispersé.
 */
async function postJson<T>(
  path: string,
  body: unknown,
  token?: string | null,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return await toApiResult<T>(res);
  } catch {
    return {
      ok: false,
      error: "Impossible de contacter le serveur. Vérifiez votre connexion.",
    };
  }
}

/**
 * Appel authentifié générique (`Authorization: Bearer`, cf. lib/auth.ts et
 * routes/_middleware.ts) — utilisé directement quand l'appelant a besoin de
 * la `Response` brute (ex. lib/photos), sinon préférer `authJson` ci-dessous.
 */
export async function authFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const token = await getToken();
  return fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
}

/**
 * Appel authentifié générique qui renvoie directement un `ApiResult<T>`
 * (GET/PATCH/DELETE/POST — y compris `multipart/form-data`, cf.
 * `createPost` : ne pas fixer `content-type` soi-même dans ce cas, `fetch`
 * calcule la frontière multipart automatiquement à partir d'un `FormData`).
 */
async function authJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  try {
    const res = await authFetch(path, init);
    return await toApiResult<T>(res);
  } catch {
    return {
      ok: false,
      error: "Impossible de contacter le serveur. Vérifiez votre connexion.",
    };
  }
}

export interface City {
  id: number;
  name: string;
  postalCodes: string[];
  department: string;
}

/** Recherche ville (cf. routes/api/villes.ts, déjà utilisée côté web par
 * islands/RegistrationAddressFields.tsx) — même comportement : moins de 2
 * caractères → tableau vide, pas d'appel réseau inutile. */
export async function searchCities(query: string): Promise<City[]> {
  if (query.trim().length < 2) return [];
  try {
    const res = await fetch(
      `${BASE_URL}/api/villes?q=${encodeURIComponent(query)}`,
    );
    if (!res.ok) return [];
    return (await res.json()) as City[];
  } catch {
    return [];
  }
}

export interface Street {
  id: number;
  name: string;
}

/** Recherche rue (cf. routes/api/rues.ts, déjà utilisée côté web par
 * islands/RegistrationAddressFields.tsx) — même comportement : moins de 2
 * caractères ou pas de ville sélectionnée → tableau vide, pas d'appel
 * réseau inutile ; le serveur filtre déjà par `cityId`. */
export async function searchStreets(
  query: string,
  cityId: number,
): Promise<Street[]> {
  if (query.trim().length < 2) return [];
  try {
    const res = await fetch(
      `${BASE_URL}/api/rues?cityId=${cityId}&q=${encodeURIComponent(query)}`,
    );
    if (!res.ok) return [];
    return (await res.json()) as Street[];
  } catch {
    return [];
  }
}

export interface JoinInput {
  login: string;
  email: string;
  houseNumber: string | null;
  street: string;
  cityId: number;
  ageConfirmed: boolean;
}

/** Inscription (cf. routes/api/v1/join.ts) — ne renvoie jamais le code de
 * connexion, seulement par e-mail : l'écran suivant (code.tsx) le demande
 * à l'habitant, jamais pré-rempli. */
export function join(
  input: JoinInput,
): Promise<ApiResult<{ ok: true; isAmbassador: boolean }>> {
  return postJson("/api/v1/join", input);
}

/** Demande/renvoi d'un code de connexion (cf. routes/api/v1/auth/code.ts)
 * — réponse uniforme côté serveur, jamais d'indice sur l'existence du
 * compte. */
export function requestCode(email: string): Promise<ApiResult<{ ok: true }>> {
  return postJson("/api/v1/auth/code", { email });
}

/** Vérifie le code à 6 chiffres et obtient le jeton de session (cf.
 * routes/api/v1/auth/verify.ts) — à stocker via lib/auth.ts#setToken,
 * jamais affiché ni journalisé côté app. */
export function verifyCode(
  email: string,
  code: string,
): Promise<ApiResult<{ token: string; expiresIn: number }>> {
  return postJson("/api/v1/auth/verify", { email, code });
}

/** Mêmes trois types de publication que le web (cf. db/posts.ts#PostType,
 * routes/fil.tsx). */
export type PostType = "cherche" | "propose" | "informe";

/** Mêmes trois durées de validité que le web (cf. db/posts.ts#PostDuration). */
export type PostDuration = "today" | "week" | "months";

export interface Tapper {
  id: number;
  login: string;
}

export interface Comment {
  id: number;
  content: string;
  createdAt: string;
  authorId: number;
  authorLogin: string;
}

export interface Post {
  id: number;
  type: PostType;
  content: string;
  createdAt: string;
  authorId: number;
  authorLogin: string;
  image: { id: number; width: number; height: number } | null;
  tapCount: number;
  viewerHasTapped: boolean;
  /** Rempli seulement sur ses propres demandes (cf. routes/api/v1/posts/index.ts). */
  tappers: Tapper[];
  comments: Comment[];
}

export interface PostsFeed {
  streetName: string;
  housesCount: number;
  /** Rue pas encore allumée : `posts` toujours vide dans ce cas, pas une
   * erreur (cf. routes/api/v1/posts/index.ts). */
  isStreetAwake: boolean;
  viewer: { id: number; login: string; isVerified: boolean };
  posts: Post[];
  page: number;
  totalPages: number;
  totalCount: number;
}

/** Fil de la rue de l'habitant connecté (cf. routes/api/v1/posts/index.ts),
 * filtrable par type et par recherche libre — même comportement que
 * web/routes/fil.tsx. */
export function fetchPosts(
  params: { type?: PostType; q?: string; page?: number } = {},
): Promise<ApiResult<PostsFeed>> {
  const search = new URLSearchParams();
  if (params.type) search.set("type", params.type);
  if (params.q) search.set("q", params.q);
  if (params.page) search.set("page", String(params.page));
  const qs = search.toString();
  return authJson(`/api/v1/posts${qs ? `?${qs}` : ""}`);
}

/** Photo à joindre à une demande — déjà choisie via `expo-image-picker`
 * (galerie ou appareil photo, cf. components/fil/PostComposer.tsx) ; le
 * redimensionnement/ré-encodage définitif reste fait côté serveur (cf.
 * utils/image.ts), comme sur le web. */
export interface PickedImage {
  uri: string;
  name: string;
  mimeType: string;
}

export interface CreatePostInput {
  type: PostType;
  content: string;
  duration: PostDuration;
  /** Ignoré sauf `duration === "months"`. */
  durationMonths?: number;
  image?: PickedImage | null;
}

/**
 * Ajoute la photo choisie au `FormData` — deux formes différentes selon la
 * cible, sinon la photo est silencieusement absente de la publication sans
 * aucune erreur (constat terrain) :
 * - iOS/Android : la forme `{ uri, name, type }`, convention React Native
 *   native pour l'upload de fichier (pas un vrai `Blob`, cf. doc Expo).
 * - Web : `react-native-web` retombe sur le vrai `FormData` du navigateur,
 *   qui exige un `Blob`/`File` réel — la forme ci-dessus n'y est pas
 *   reconnue comme un fichier. `image.uri` y est déjà un `blob:`/`data:`
 *   du navigateur : on le re-fetch pour en obtenir un `Blob` exploitable.
 */
async function appendImageToForm(
  form: FormData,
  image: PickedImage,
): Promise<void> {
  if (Platform.OS === "web") {
    const blob = await (await fetch(image.uri)).blob();
    form.append("image", blob, image.name);
    return;
  }
  form.append("image", {
    uri: image.uri,
    name: image.name,
    type: image.mimeType,
  } as unknown as Blob);
}

/** Publie une demande (cf. routes/api/v1/posts/index.ts POST) — même
 * `multipart/form-data` que le formulaire web (image comprise), pour
 * réutiliser exactement la même route serveur. */
export async function createPost(
  input: CreatePostInput,
): Promise<ApiResult<{ post: Post }>> {
  const form = new FormData();
  form.append("type", input.type);
  form.append("content", input.content);
  form.append("duration", input.duration);
  if (input.durationMonths) {
    form.append("durationMonths", String(input.durationMonths));
  }
  if (input.image) {
    await appendImageToForm(form, input.image);
  }
  return authJson("/api/v1/posts", { method: "POST", body: form });
}

/** Corrige le contenu d'une de ses propres demandes (cf.
 * routes/api/v1/posts/[id].ts PATCH) — seulement le texte, pas le type ni
 * la durée, même règle que le web. */
export function updatePost(
  postId: number,
  content: string,
): Promise<ApiResult<{ ok: true; content: string }>> {
  return authJson(`/api/v1/posts/${postId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

/** Supprime (soft delete) une de ses propres demandes (cf.
 * routes/api/v1/posts/[id].ts DELETE). */
export function deletePost(postId: number): Promise<ApiResult<{ ok: true }>> {
  return authJson(`/api/v1/posts/${postId}`, { method: "DELETE" });
}

/** Bascule un tap sur une demande (cf. routes/api/v1/posts/[id]/tap.ts) —
 * renvoie l'état à jour pour mettre l'écran à jour sans refaire un
 * `fetchPosts` complet. */
export function toggleTap(
  postId: number,
): Promise<ApiResult<{ tapped: boolean; tapCount: number }>> {
  return authJson(`/api/v1/posts/${postId}/tap`, { method: "POST" });
}

/** Publie une réponse publique à une demande (cf.
 * routes/api/v1/posts/[id]/comments.ts). */
export function addComment(
  postId: number,
  content: string,
): Promise<ApiResult<{ comment: Comment }>> {
  return authJson(`/api/v1/posts/${postId}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

/** URL de la photo jointe à une demande (cf. routes/photos/[id].ts) — à
 * charger avec le jeton en en-tête `Authorization` (route authentifiée),
 * cf. components/fil/PostImage.tsx. */
export function photoUrl(imageId: number): string {
  return `${BASE_URL}/photos/${imageId}`;
}

export interface StreetStatus {
  streetName: string;
  cityId: number;
  cityName: string;
  /** Nombre de foyers inscrits nécessaires pour que la rue s'allume. */
  threshold: number;
  housesCount: number;
  remaining: number;
  isAmbassadorSlot: boolean;
  isAwake: boolean;
}

/** Statut d'éveil de la rue de l'habitant connecté (cf.
 * routes/api/v1/streets/status.ts) — combien de foyers manquent, ou si
 * elle est déjà allumée. Utilisé par l'écran d'invitation (cf. backlog
 * mobile « inviter mes voisins »). */
export function fetchStreetStatus(): Promise<ApiResult<StreetStatus>> {
  return authJson("/api/v1/streets/status");
}

/** Lien d'inscription à partager (cf. web/routes/rejoindre.tsx, même route
 * que le web — un seul backend, cf. _doc/architecture-mobile.md) : scopé à
 * la rue de l'inviteur, elle sera pré-remplie sur /rejoindre. */
export function joinUrl(cityId: number, streetName: string): string {
  const params = new URLSearchParams({
    cityId: String(cityId),
    street: streetName,
  });
  return `${BASE_URL}/rejoindre?${params}`;
}

export interface Conversation {
  otherUserId: number;
  otherUserLogin: string;
  lastMessage: string;
  lastMessageAt: string;
  lastMessageFromViewer: boolean;
}

export interface ConversationsInbox {
  isStreetAwake: boolean;
  conversations: Conversation[];
}

/** Boîte de réception (cf. routes/api/v1/messages/index.ts) — une ligne
 * par interlocuteur, la plus récente d'abord, même comportement que
 * web/routes/messages.tsx (vue « inbox »). */
export function fetchConversations(): Promise<ApiResult<ConversationsInbox>> {
  return authJson("/api/v1/messages");
}

export interface MessagePostContext {
  id: number;
  content: string;
}

export interface ThreadMessage {
  id: number;
  content: string;
  createdAt: string;
  /** Vrai si envoyé par l'habitant connecté (pour l'aligner à droite). */
  fromViewer: boolean;
}

export interface Thread {
  otherUserId: number;
  otherUserLogin: string;
  /** Interlocuteur ayant depuis supprimé son compte — toujours
   * consultable sous son pseudonyme anonymisé, mais plus possible de lui
   * écrire (cf. routes/api/v1/messages/[otherUserId].ts). */
  otherUserDeleted: boolean;
  postContext: MessagePostContext | null;
  messages: ThreadMessage[];
}

/** Conversation avec un voisin (cf.
 * routes/api/v1/messages/[otherUserId].ts GET) — marque les messages reçus
 * comme lus au passage, même règle que web/routes/messages.tsx. `postId`
 * quand la conversation démarre depuis une demande (bouton « Message
 * privé », cf. components/fil/PostCard.tsx). */
export function fetchThread(
  otherUserId: number,
  postId?: number,
): Promise<ApiResult<Thread>> {
  const qs = postId ? `?postId=${postId}` : "";
  return authJson(`/api/v1/messages/${otherUserId}${qs}`);
}

/** Envoie un message privé (cf.
 * routes/api/v1/messages/[otherUserId].ts POST). */
export function sendMessage(
  otherUserId: number,
  content: string,
  postId?: number,
): Promise<ApiResult<{ message: ThreadMessage; postContext: MessagePostContext | null }>> {
  return authJson(`/api/v1/messages/${otherUserId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content, postId }),
  });
}

/** Pour la pastille sur l'entrée « Mes messages » du menu (cf.
 * routes/api/v1/messages/unread-count.ts, components/AppHeader.tsx). */
export function fetchUnreadCount(): Promise<ApiResult<{ hasUnread: boolean }>> {
  return authJson("/api/v1/messages/unread-count");
}
