import { and, count, eq, ilike } from "drizzle-orm";
import { db } from "./client.ts";
import { house, street } from "./schema.ts";
import { escapeLikePattern } from "../utils/validation.ts";

export type Street = typeof street.$inferSelect;

/**
 * Nombre de foyers inscrits nécessaires pour qu'une rue « s'allume » (passe
 * de rue endormie à rue vivante). Valeur reprise du prototype (`seuil`,
 * défaut 8) — à terme un réglage produit plutôt qu'une constante de code.
 */
export const STREET_AWAKENING_THRESHOLD = 4;

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

export interface StreetAwakeningStatus {
  /** Rue déjà en base, ou `null` si personne ne l'a encore rejointe. */
  street: Street | null;
  /** Foyers déjà inscrits (0 si la rue n'existe pas encore). */
  housesCount: number;
  /** Foyers restants avant d'atteindre le seuil (0 si déjà atteint). */
  remaining: number;
  /** Vrai si la rue n'a encore aucun foyer : le prochain inscrit deviendrait ambassadeur. */
  isAmbassadorSlot: boolean;
  /** Vrai si le seuil est atteint ou dépassé (rue « allumée »). */
  isAwake: boolean;
}

/**
 * Statut d'éveil d'une rue (existante ou non) pour une ville donnée : combien
 * de foyers y sont déjà inscrits et combien il en manque pour qu'elle
 * s'allume. Ne crée rien — lecture seule, utilisée par la page d'accueil pour
 * donner un objectif atteignable avant inscription (cf. backlog).
 */
export async function getStreetAwakeningStatus(
  cityId: number,
  rawName: string,
): Promise<StreetAwakeningStatus> {
  const found = await findStreet(normalizeStreetName(rawName), cityId);

  let housesCount = 0;
  if (found) {
    const [{ value }] = await db.select({ value: count() }).from(house).where(
      eq(house.streetId, found.id),
    );
    housesCount = value;
  }

  return {
    street: found,
    housesCount,
    remaining: Math.max(0, STREET_AWAKENING_THRESHOLD - housesCount),
    isAmbassadorSlot: housesCount === 0,
    isAwake: housesCount >= STREET_AWAKENING_THRESHOLD,
  };
}
