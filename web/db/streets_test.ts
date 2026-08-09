import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import { db } from "./client.ts";
import { city, street } from "./schema.ts";
import { findOrCreateStreet } from "./streets.ts";
import { createTestCity } from "./test_helpers.ts";

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
