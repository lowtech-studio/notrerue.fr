import { eq } from "drizzle-orm";
import { db } from "./client.ts";
import { city } from "./schema.ts";

export type City = typeof city.$inferSelect;

/** Charge une ville par son identifiant, ou `null` si elle n'existe pas. */
export async function findCityById(id: number): Promise<City | null> {
  const [found] = await db.select().from(city).where(eq(city.id, id));
  return found ?? null;
}
