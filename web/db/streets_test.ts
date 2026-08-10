import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import { db } from "./client.ts";
import { city, house, street } from "./schema.ts";
import {
  findOrCreateStreet,
  getStreetAwakeningStatus,
  getStreetHousesStatus,
  STREET_AWAKENING_THRESHOLD,
} from "./streets.ts";
import { createTestCity, createTestStreet } from "./test_helpers.ts";

/** Ajoute `n` foyers vides sur une rue de test (compte uniquement, pas d'utilisateur). */
async function addHouses(streetId: number, n: number): Promise<void> {
  if (n === 0) return;
  await db.insert(house).values(
    Array.from({ length: n }, () => ({ streetId })),
  );
}

Deno.test("findOrCreateStreet : crée puis réutilise la même rue (insensible à la casse et aux espaces)", async () => {
  const testCity = await createTestCity("streets-1");

  try {
    const first = await findOrCreateStreet("Rue des Lilas", testCity.id);
    const second = await findOrCreateStreet(
      "  rue   DES lilas  ",
      testCity.id,
    );

    assertEquals(second.id, first.id);

    const rows = await db.select().from(street).where(
      eq(street.cityId, testCity.id),
    );
    assertEquals(rows.length, 1);
  } finally {
    await db.delete(street).where(eq(street.cityId, testCity.id));
    await db.delete(city).where(eq(city.id, testCity.id));
  }
});

Deno.test("findOrCreateStreet : la même rue dans deux villes différentes reste distincte", async () => {
  const cityA = await createTestCity("streets-2a");
  const cityB = await createTestCity("streets-2b");

  try {
    const inA = await findOrCreateStreet("Rue des Lilas", cityA.id);
    const inB = await findOrCreateStreet("Rue des Lilas", cityB.id);

    assertEquals(inA.id === inB.id, false);
  } finally {
    await db.delete(street).where(eq(street.cityId, cityA.id));
    await db.delete(street).where(eq(street.cityId, cityB.id));
    await db.delete(city).where(eq(city.id, cityA.id));
    await db.delete(city).where(eq(city.id, cityB.id));
  }
});

Deno.test("getStreetAwakeningStatus : rue jamais rejointe → 0 foyer, prochain inscrit ambassadeur", async () => {
  const testCity = await createTestCity("streets-3");

  try {
    const status = await getStreetAwakeningStatus(
      testCity.id,
      "Rue jamais visitée",
    );
    assertEquals(status, {
      street: null,
      housesCount: 0,
      remaining: STREET_AWAKENING_THRESHOLD,
      isAmbassadorSlot: true,
      isAwake: false,
    });
  } finally {
    await db.delete(city).where(eq(city.id, testCity.id));
  }
});

Deno.test("getStreetAwakeningStatus : rue endormie avec des foyers → ni ambassadeur, ni allumée", async () => {
  const { testCity, testStreet } = await createTestStreet("streets-4");
  const housesCount = STREET_AWAKENING_THRESHOLD - 3;

  try {
    await addHouses(testStreet.id, housesCount);

    const status = await getStreetAwakeningStatus(testCity.id, testStreet.name);
    assertEquals(status.street?.id, testStreet.id);
    assertEquals(status.housesCount, housesCount);
    assertEquals(status.remaining, 3);
    assertEquals(status.isAmbassadorSlot, false);
    assertEquals(status.isAwake, false);
  } finally {
    await db.delete(house).where(eq(house.streetId, testStreet.id));
    await db.delete(street).where(eq(street.id, testStreet.id));
    await db.delete(city).where(eq(city.id, testCity.id));
  }
});

Deno.test("getStreetAwakeningStatus : seuil atteint → rue allumée, plus rien à combler", async () => {
  const { testCity, testStreet } = await createTestStreet("streets-5");

  try {
    await addHouses(testStreet.id, STREET_AWAKENING_THRESHOLD);

    const status = await getStreetAwakeningStatus(testCity.id, testStreet.name);
    assertEquals(status.housesCount, STREET_AWAKENING_THRESHOLD);
    assertEquals(status.remaining, 0);
    assertEquals(status.isAmbassadorSlot, false);
    assertEquals(status.isAwake, true);
  } finally {
    await db.delete(house).where(eq(house.streetId, testStreet.id));
    await db.delete(street).where(eq(street.id, testStreet.id));
    await db.delete(city).where(eq(city.id, testCity.id));
  }
});

Deno.test("getStreetHousesStatus : par identifiant, sans re-recherche par nom", async () => {
  const { testCity, testStreet } = await createTestStreet("streets-6");
  const housesCount = STREET_AWAKENING_THRESHOLD - 1;

  try {
    await addHouses(testStreet.id, housesCount);

    const status = await getStreetHousesStatus(testStreet.id);
    assertEquals(status, {
      housesCount,
      remaining: 1,
      isAmbassadorSlot: false,
      isAwake: false,
    });
  } finally {
    await db.delete(house).where(eq(house.streetId, testStreet.id));
    await db.delete(street).where(eq(street.id, testStreet.id));
    await db.delete(city).where(eq(city.id, testCity.id));
  }
});
