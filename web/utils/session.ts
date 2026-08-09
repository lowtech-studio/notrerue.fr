import { timingSafeEqual, toHex } from "./crypto.ts";

export const SESSION_COOKIE = "notrerue_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 jours

function getSecret(): string {
  const secret = Deno.env.get("SESSION_SECRET");
  if (!secret) {
    throw new Error(
      "SESSION_SECRET manquante (voir web/.env.example) : impossible de signer les sessions.",
    );
  }
  return secret;
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return toHex(new Uint8Array(signature));
}

/**
 * Valeur de cookie de session : `<userId>.<expiration epoch>.<signature HMAC>`.
 * Volontairement pas un JWT (pas de rôles embarqués) : le middleware recharge
 * toujours l'utilisateur depuis la base à chaque requête, donc une
 * désinscription/suppression de compte prend effet immédiatement.
 */
export async function createSessionValue(userId: number): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${userId}.${expiresAt}`;
  const signature = await sign(payload);
  return `${payload}.${signature}`;
}

export async function verifySessionValue(
  value: string,
): Promise<number | null> {
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [userIdStr, expiresAtStr, signature] = parts;

  const expectedSignature = await sign(`${userIdStr}.${expiresAtStr}`);
  if (!timingSafeEqual(signature, expectedSignature)) return null;

  const expiresAt = Number(expiresAtStr);
  if (
    !Number.isFinite(expiresAt) || expiresAt < Math.floor(Date.now() / 1000)
  ) {
    return null;
  }

  const userId = Number(userIdStr);
  if (!Number.isInteger(userId)) return null;

  return userId;
}
