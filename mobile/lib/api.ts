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

/**
 * POST JSON générique : succès → `{ ok: true, data }`, échec (HTTP ou
 * réseau) → `{ ok: false, error }` avec le message déjà renvoyé par le
 * backend (`{ error }`, cf. routes/api/v1/*) quand il est disponible — les
 * écrans n'ont qu'à afficher `error` tel quel, jamais de try/catch dispersé.
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
    const json = await parseJson(res);
    if (!res.ok) {
      const message = (json as { error?: string } | null)?.error ??
        "Une erreur est survenue.";
      return { ok: false, error: message };
    }
    return { ok: true, data: json as T };
  } catch {
    return {
      ok: false,
      error: "Impossible de contacter le serveur. Vérifiez votre connexion.",
    };
  }
}

/**
 * Appel authentifié générique (`Authorization: Bearer`, cf. lib/auth.ts et
 * routes/_middleware.ts) — pas encore utilisé par les écrans actuels
 * (inscription/code, tous deux non authentifiés par nature), prêt pour les
 * prochains endpoints (`/api/v1/posts`, `/api/v1/messages`...).
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
