import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "./client.ts";
import { house, post, tap, user } from "./schema.ts";

/**
 * Bascule le tap d'un habitant sur une demande : le crée s'il n'existe pas
 * encore (actif), le retire (soft delete) s'il existait déjà — un clic
 * suffit pour répondre ou se rétracter (cf. backlog « en un clic, avant
 * même d'écrire »). Retourne le nouvel état (vrai = tapé).
 */
export async function toggleTap(
  userId: number,
  postId: number,
): Promise<boolean> {
  const [active] = await db.select().from(tap).where(
    and(eq(tap.userId, userId), eq(tap.postId, postId), isNull(tap.deletedAt)),
  );

  if (active) {
    await db.update(tap).set({ deletedAt: new Date() }).where(
      eq(tap.id, active.id),
    );
    return false;
  }

  await db.insert(tap).values({ userId, postId });
  return true;
}

/** Nombre de taps actifs par demande, pour l'ensemble de `postIds` donné. */
export async function countTapsByPost(
  postIds: number[],
): Promise<Map<number, number>> {
  if (postIds.length === 0) return new Map();

  const rows = await db.select({ postId: tap.postId }).from(tap).where(
    and(inArray(tap.postId, postIds), isNull(tap.deletedAt)),
  );

  const counts = new Map<number, number>();
  for (const { postId } of rows) {
    if (postId === null) continue;
    counts.set(postId, (counts.get(postId) ?? 0) + 1);
  }
  return counts;
}

/** Sous-ensemble de `postIds` déjà tapé par `userId` (tap actif). */
export async function findTappedPostIds(
  userId: number,
  postIds: number[],
): Promise<Set<number>> {
  if (postIds.length === 0) return new Set();

  const rows = await db.select({ postId: tap.postId }).from(tap).where(
    and(
      eq(tap.userId, userId),
      inArray(tap.postId, postIds),
      isNull(tap.deletedAt),
    ),
  );

  return new Set(rows.map((row) => row.postId).filter((id) => id !== null));
}

export interface Tapper {
  id: number;
  login: string;
}

/**
 * Habitants ayant tapé sur chaque demande de `postIds` (taps actifs, du
 * plus ancien au plus récent). Coûteux à calculer pour toutes les demandes
 * d'un fil : à réserver aux demandes de l'appelant lui-même (cf. backlog
 * « qui a tapé sur mes messages, au survol » et « message privé à un
 * tapeur pour s'organiser »).
 */
export async function listTappers(
  postIds: number[],
): Promise<Map<number, Tapper[]>> {
  if (postIds.length === 0) return new Map();

  const rows = await db.select({
    postId: tap.postId,
    id: user.id,
    login: user.login,
  })
    .from(tap)
    .innerJoin(user, eq(tap.userId, user.id))
    .where(and(inArray(tap.postId, postIds), isNull(tap.deletedAt)))
    .orderBy(tap.createdAt);

  const tappers = new Map<number, Tapper[]>();
  for (const row of rows) {
    if (row.postId === null) continue;
    const list = tappers.get(row.postId) ?? [];
    list.push({ id: row.id, login: row.login });
    tappers.set(row.postId, list);
  }
  return tappers;
}

/**
 * Rue à laquelle appartient une demande (via son auteur), ou `null` si la
 * demande n'existe pas. Sert à vérifier qu'on ne tape pas sur une demande
 * d'une autre rue (cf. backlog « aucun contenu de rue lisible sans
 * appartenance vérifiée »).
 */
export async function getPostStreetId(postId: number): Promise<number | null> {
  const [found] = await db.select({ streetId: house.streetId })
    .from(post)
    .innerJoin(user, eq(post.userId, user.id))
    .innerJoin(house, eq(user.houseId, house.id))
    .where(eq(post.id, postId));
  return found?.streetId ?? null;
}
