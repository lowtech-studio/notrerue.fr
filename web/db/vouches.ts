import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "./client.ts";
import { house, user, vouch } from "./schema.ts";

export type Vouch = typeof vouch.$inferSelect;

export interface PendingNeighbor {
  id: number;
  login: string;
  createdAt: Date;
}

/**
 * Habitants actifs de `streetId` pas encore vérifiés (cf. `user.verifiedAt`),
 * les plus anciens d'abord — affichés aux voisins déjà vérifiés de la même
 * rue pour qu'ils les confirment (cf. routes/index.tsx).
 */
export async function listPendingNeighbors(
  streetId: number,
): Promise<PendingNeighbor[]> {
  const rows = await db.select({
    id: user.id,
    login: user.login,
    createdAt: user.createdAt,
  })
    .from(user)
    .innerJoin(house, eq(user.houseId, house.id))
    .where(and(
      eq(house.streetId, streetId),
      isNull(user.deletedAt),
      isNull(user.verifiedAt),
    ))
    .orderBy(user.createdAt);
  return rows;
}

export interface VerifiedNeighbor {
  id: number;
  login: string;
  email: string;
}

/**
 * Habitants actifs déjà vérifiés de `streetId` (cf. `user.verifiedAt`) —
 * les seuls capables de vouch pour un nouvel arrivant. Utilisé pour montrer
 * à un compte en attente qui approcher sur sa rue (cf. retour utilisateur
 * « comment identifier un voisin... pour demander une validation ? »).
 * La notification par e-mail d'un nouvel arrivant en attente ne part plus à
 * toute cette liste mais au seul ambassadeur (cf. routes/rejoindre.tsx,
 * db/users.ts#findStreetAmbassador) — sur une grande rue, prévenir chaque
 * voisin déjà vérifié à chaque inscription générait trop d'e-mails (cf.
 * retour utilisateur).
 */
export async function listVerifiedNeighbors(
  streetId: number,
): Promise<VerifiedNeighbor[]> {
  const rows = await db.select({
    id: user.id,
    login: user.login,
    email: user.email,
  })
    .from(user)
    .innerJoin(house, eq(user.houseId, house.id))
    .where(and(
      eq(house.streetId, streetId),
      isNull(user.deletedAt),
      isNotNull(user.verifiedAt),
    ))
    .orderBy(user.login);
  return rows;
}

export type VouchOutcome =
  | "ok"
  | "already_verified"
  | "self"
  | "not_same_street"
  | "voucher_not_verified"
  | "not_found";

/**
 * Un habitant déjà vérifié (`voucherId`) confirme qu'un voisin de sa rue
 * (`voucheeId`) y habite bien — cf. backlog « prouver que les voisins
 * habitent bien dans la même rue », approche volontairement peu contraignante :
 * un seul vouch suffit à valider le compte (cf. `user.verifiedAt`). Toutes
 * les conditions sont revérifiées ici, jamais sur la seule foi de l'UI (qui
 * ne propose ce bouton que pour un voisin de la même rue, pas encore
 * vérifié) — un `voucheeId` forgé ne doit rien valider à tort.
 *
 * Idempotent : voucher un compte déjà vérifié (par soi ou quelqu'un d'autre,
 * double-clic ou course entre deux voisins) ne fait rien de plus, sans
 * erreur.
 */
export async function vouchForNeighbor(
  voucherId: number,
  voucheeId: number,
): Promise<VouchOutcome> {
  if (voucherId === voucheeId) return "self";

  const [voucher] = await db.select({
    verifiedAt: user.verifiedAt,
    streetId: house.streetId,
  })
    .from(user)
    .innerJoin(house, eq(user.houseId, house.id))
    .where(and(eq(user.id, voucherId), isNull(user.deletedAt)));
  if (!voucher) return "not_found";
  // Seul un habitant déjà vérifié peut vérifier quelqu'un d'autre : sans ce
  // garde-fou, deux comptes fictifs pourraient se vérifier mutuellement.
  // C'est ce qui ancre la chaîne de confiance à l'ambassadeur de chaque rue
  // (seul compte vérifié dès l'inscription, cf. registerInhabitant).
  if (!voucher.verifiedAt) return "voucher_not_verified";

  const [vouchee] = await db.select({
    verifiedAt: user.verifiedAt,
    streetId: house.streetId,
  })
    .from(user)
    .innerJoin(house, eq(user.houseId, house.id))
    .where(and(eq(user.id, voucheeId), isNull(user.deletedAt)));
  if (!vouchee) return "not_found";
  if (vouchee.streetId !== voucher.streetId) return "not_same_street";
  if (vouchee.verifiedAt) return "already_verified";

  await db.insert(vouch).values({ voucherId, voucheeId })
    .onConflictDoNothing();
  await db.update(user).set({ verifiedAt: new Date() }).where(
    eq(user.id, voucheeId),
  );

  return "ok";
}
