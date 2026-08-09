import { and, eq, ilike } from "drizzle-orm";
import { db } from "./client.ts";
import { street } from "./schema.ts";
import { escapeLikePattern } from "../utils/validation.ts";

export type Street = typeof street.$inferSelect;

function normalizeStreetName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

async function findStreet(
  name: string,
  cityId: number,
): Promise<Street | null> {
  const [found] = await db.select().from(street).where(
    and(ilike(street.name, escapeLikePattern(name)), eq(street.cityId, cityId)),
  );
  return found ?? null;
}

/**
 * Récupère la rue existante (recherche insensible à la casse) ou la crée.
 * Sur course concurrente entre deux inscriptions pour la même rue (y compris
 * avec une casse différente, ex. "Rue des Lilas" / "rue des lilas"), l'index
 * unique fonctionnel `lower(name), city_id` fait échouer l'un des deux
 * inserts : on retombe alors sur la ligne créée par l'autre requête.
 */
export async function findOrCreateStreet(
  rawName: string,
  cityId: number,
): Promise<Street> {
  const name = normalizeStreetName(rawName);
  const existing = await findStreet(name, cityId);
  if (existing) return existing;

  try {
    const [created] = await db.insert(street).values({ name, cityId })
      .returning();
    return created;
  } catch (error) {
    const existingAfterRace = await findStreet(name, cityId);
    if (existingAfterRace) return existingAfterRace;
    throw error;
  }
}
