import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "./client.ts";
import { user } from "./schema.ts";

/**
 * Enregistre (ou remplace) le jeton de push Expo d'un habitant — un seul
 * par compte, le plus récent l'emporte (cf. schema.ts#pushToken, pas de
 * gestion multi-appareils pour ce MVP).
 */
export async function registerPushToken(
  userId: number,
  token: string,
): Promise<void> {
  await db.update(user).set({ pushToken: token }).where(eq(user.id, userId));
}

/**
 * Retire le jeton d'un habitant — appelé quand le service de push Expo
 * signale qu'il n'est plus valide (cf. push/expo.ts, réponse
 * `DeviceNotRegistered`), pour ne pas retenter indéfiniment un jeton mort.
 */
export async function clearPushToken(userId: number): Promise<void> {
  await db.update(user).set({ pushToken: null }).where(eq(user.id, userId));
}

export interface PushRecipient {
  userId: number;
  token: string;
}

/**
 * Sous-ensemble de `userIds` réellement joignable par push : jeton
 * enregistré et notifications pas en pause (cf. push/expo.ts, appelé avant
 * chaque envoi pour ne jamais notifier un habitant qui a coupé les
 * notifications ou n'a pas l'app installée).
 */
export async function findPushRecipients(
  userIds: number[],
): Promise<PushRecipient[]> {
  if (userIds.length === 0) return [];

  const rows = await db.select({ id: user.id, pushToken: user.pushToken })
    .from(user)
    .where(and(
      inArray(user.id, userIds),
      isNotNull(user.pushToken),
      eq(user.pushNotificationsPaused, false),
    ));

  return rows
    .filter((row): row is { id: number; pushToken: string } =>
      row.pushToken !== null
    )
    .map((row) => ({ userId: row.id, token: row.pushToken }));
}
