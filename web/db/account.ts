import { and, count, eq, isNull, ne } from "drizzle-orm";
import { db } from "./client.ts";
import { house, tap, user } from "./schema.ts";
import { softDeleteUserComments } from "./comments.ts";
import { softDeleteUserPosts } from "./posts.ts";

/**
 * Supprime (soft delete) le compte d'un habitant, son foyer et toutes ses
 * publications/réponses (cf. backlog « rester maître de mes données »).
 *
 * Étapes séquentielles plutôt qu'une unique transaction : chaque étape est
 * elle-même idempotente (`isNull(...)` en garde), donc rejouable sans risque
 * en cas d'échec partiel — même choix que le reste du code base (ex.
 * routes/supprimer.ts, routes/modifier.ts).
 *
 * Le login et l'e-mail sont anonymisés (uniques mais illisibles) plutôt que
 * simplement marqués supprimés : sans ça, l'e-mail resterait bloqué pour
 * toujours (contrainte unique non partielle) et le login d'origine
 * continuerait d'apparaître sur tout contenu non supprimé par ailleurs (ex.
 * une conversation privée conservée côté destinataire, cf.
 * routes/messages.tsx).
 *
 * Les taps de l'utilisateur sont aussi soft-supprimés (comme ses
 * publications/réponses) : sans ça il continuerait d'apparaître, sous son
 * login anonymisé, dans la liste des tapeurs vue par l'auteur d'une demande.
 */
export async function deleteUserAccount(userId: number): Promise<void> {
  await softDeleteUserPosts(userId);
  await softDeleteUserComments(userId);
  await db.update(tap)
    .set({ deletedAt: new Date() })
    .where(and(eq(tap.userId, userId), isNull(tap.deletedAt)));

  const [deletedUser] = await db.update(user)
    .set({
      deletedAt: new Date(),
      login: `Compte supprimé #${userId}`,
      email: `compte-supprime-${userId}@notrerue.invalid`,
      token: null,
      loginCode: null,
      loginCodeExpiresAt: null,
    })
    .where(and(eq(user.id, userId), isNull(user.deletedAt)))
    .returning({ houseId: user.houseId });
  if (!deletedUser) return;

  // Le foyer n'est marqué supprimé (et donc exclu du décompte d'éveil de la
  // rue, cf. getStreetHousesStatus) que si plus aucun autre habitant actif
  // n'y est rattaché — aujourd'hui toujours vrai (un foyer par inscription),
  // gardé par sécurité si un jour plusieurs comptes partagent un foyer.
  const [{ value: remainingResidents }] = await db.select({ value: count() })
    .from(user)
    .where(and(
      eq(user.houseId, deletedUser.houseId),
      ne(user.id, userId),
      isNull(user.deletedAt),
    ));
  if (remainingResidents === 0) {
    await db.update(house)
      // Numéro de foyer (donnée personnelle) effacé en même temps : rien ne
      // l'exposait déjà, mais le garder contredirait « rester maître de mes
      // données » une fois le foyer soft-supprimé (cf. revue).
      .set({ deletedAt: new Date(), number: null })
      .where(and(eq(house.id, deletedUser.houseId), isNull(house.deletedAt)));
  }
}
