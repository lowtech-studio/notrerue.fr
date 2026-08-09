import { timingSafeEqual, toHex } from "./crypto.ts";

export const LOGIN_CODE_TTL_MINUTES = 15;

function getSecret(): string {
  const secret = Deno.env.get("SESSION_SECRET");
  if (!secret) {
    throw new Error(
      "SESSION_SECRET manquante (voir web/.env.example) : impossible de hasher les codes de connexion.",
    );
  }
  return secret;
}

/** Code numérique à 6 chiffres, tirage cryptographiquement sûr. */
export function generateLoginCode(): string {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return value.toString().padStart(6, "0");
}

export async function hashLoginCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${code}.${getSecret()}`),
  );
  return toHex(new Uint8Array(digest));
}

export async function loginCodeMatches(
  code: string,
  hash: string,
): Promise<boolean> {
  const candidate = await hashLoginCode(code);
  return timingSafeEqual(candidate, hash);
}

export function loginCodeExpiryDate(
  from: Date = new Date(),
): Date {
  return new Date(from.getTime() + LOGIN_CODE_TTL_MINUTES * 60_000);
}
