import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import type { Context } from "fresh";
import type { State } from "../utils.ts";
import { db } from "../db/client.ts";
import { city, house } from "../db/schema.ts";
import { STREET_AWAKENING_THRESHOLD } from "../db/streets.ts";
import {
  cleanupTestStreet,
  createTestCity,
  createTestStreet,
} from "../db/test_helpers.ts";
import { handler } from "./index.tsx";

function makeContext(url: string): Context<State> {
  return { url: new URL(url) } as unknown as Context<State>;
}

Deno.test("Page d'accueil : sans paramètre → aucun statut", async () => {
  const result = await handler.GET!(makeContext("http://localhost/"));
  assertEquals(result, {
    data: { street: "", cityId: null, cityLabel: "", status: null },
  });
});

Deno.test("Page d'accueil : lien hérité /?rue=... (sans ville) → rue affichée mais pas de statut", async () => {
  const result = await handler.GET!(
    makeContext("http://localhost/?rue=Rue%20des%20Lilas"),
  );
  assertEquals(result, {
    data: {
      street: "Rue des Lilas",
      cityId: null,
      cityLabel: "",
      status: null,
    },
  });
});

Deno.test("Page d'accueil : rue jamais rejointe → statut « ambassadeur possible »", async () => {
  const testCity = await createTestCity("index-1");

  try {
    const url = `http://localhost/?cityId=${testCity.id}` +
      `&city=${encodeURIComponent(testCity.name)}` +
      `&street=${encodeURIComponent("Rue jamais rejointe")}`;
    const result = await handler.GET!(makeContext(url)) as {
      data: { status: unknown };
    };
    assertEquals(result.data.status, {
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

Deno.test("Page d'accueil : rue endormie avec des foyers → statut « il en manque N »", async () => {
  const { testCity, testStreet } = await createTestStreet("index-2");

  try {
    await db.insert(house).values([
      { streetId: testStreet.id },
      { streetId: testStreet.id },
    ]);

    const url = `http://localhost/?cityId=${testCity.id}` +
      `&city=${encodeURIComponent(testCity.name)}` +
      `&street=${encodeURIComponent(testStreet.name)}`;
    const result = await handler.GET!(makeContext(url)) as {
      data: {
        status: {
          housesCount: number;
          remaining: number;
          isAmbassadorSlot: boolean;
          isAwake: boolean;
        } | null;
      };
    };
    assertEquals(result.data.status?.housesCount, 2);
    assertEquals(
      result.data.status?.remaining,
      STREET_AWAKENING_THRESHOLD - 2,
    );
    assertEquals(result.data.status?.isAmbassadorSlot, false);
    assertEquals(result.data.status?.isAwake, false);
  } finally {
    await db.delete(house).where(eq(house.streetId, testStreet.id));
    await cleanupTestStreet({ testCity, testStreet });
  }
});
