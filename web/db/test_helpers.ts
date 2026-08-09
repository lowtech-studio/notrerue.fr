import { eq } from "drizzle-orm";
import { db } from "./client.ts";
import { city, street } from "./schema.ts";

export type TestCity = typeof city.$inferSelect;
export type TestStreet = typeof street.$inferSelect;

/**
 * Ville de test isolée (nom + code INSEE aléatoires). L'appelant est
 * responsable de la supprimer (`db.delete(city)...`) une fois le test fini.
 */
export async function createTestCity(label: string): Promise<TestCity> {
  const [created] = await db.insert(city).values({
    name: `Ville de test ${label}`,
    inseeCode: `TEST-${crypto.randomUUID()}`,
    postalCodes: ["00000"],
    department: "Test",
  }).returning();
  return created;
}

/**
 * Ville + rue de test isolées. À nettoyer avec `cleanupTestStreet` une fois
 * le test fini (après suppression des foyers/utilisateurs qui en dépendent).
 */
export async function createTestStreet(
  label: string,
): Promise<{ testCity: TestCity; testStreet: TestStreet }> {
  const testCity = await createTestCity(label);
  const [testStreet] = await db.insert(street).values({
    name: `Rue de test ${label}`,
    cityId: testCity.id,
  }).returning();
  return { testCity, testStreet };
}

/** Supprime la rue puis la ville créées par `createTestStreet`. */
export async function cleanupTestStreet(
  { testCity, testStreet }: { testCity: TestCity; testStreet: TestStreet },
): Promise<void> {
  await db.delete(street).where(eq(street.id, testStreet.id));
  await db.delete(city).where(eq(city.id, testCity.id));
}
