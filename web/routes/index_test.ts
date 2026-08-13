import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import type { Context } from "fresh";
import type { SessionUser, State } from "../utils.ts";
import { db } from "../db/client.ts";
import { city, house, user } from "../db/schema.ts";
import { STREET_AWAKENING_THRESHOLD } from "../db/streets.ts";
import { registerInhabitant } from "../db/users.ts";
import {
  cleanupTestStreet,
  createTestCity,
  createTestStreet,
} from "../db/test_helpers.ts";
import { handler } from "./index.tsx";

function makeContext(
  url: string,
  options: { user?: SessionUser | null } = {},
): Context<State> {
  return {
    url: new URL(url),
    state: { user: options.user ?? null },
  } as unknown as Context<State>;
}

Deno.test("Page d'accueil : sans paramètre → aucun statut", async () => {
  const result = await handler.GET!(makeContext("http://localhost/"));
  assertEquals(result, {
    data: {
      street: "",
      cityId: null,
      cityLabel: "",
      status: null,
      ownStreetStatus: null,
      accountDeleted: false,
      pendingNeighbors: [],
      verifiedNeighbors: [],
    },
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
      ownStreetStatus: null,
      accountDeleted: false,
      pendingNeighbors: [],
      verifiedNeighbors: [],
    },
  });
});

Deno.test("Page d'accueil : ?compte_supprime=1 → bandeau de confirmation", async () => {
  const result = await handler.GET!(
    makeContext("http://localhost/?compte_supprime=1"),
  ) as { data: { accountDeleted: boolean } };
  assertEquals(result.data.accountDeleted, true);
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

Deno.test("Page d'accueil : habitant connecté d'une rue non allumée → ownStreetStatus renseigné", async () => {
  const testStreet = await createTestStreet("index-3");
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `index-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const sessionUser: SessionUser = {
    id: created.id,
    login: created.login,
    email: created.email,
    isAmbassador: created.isAmbassador,
    street: {
      id: testStreet.testStreet.id,
      name: testStreet.testStreet.name,
      city: { id: testStreet.testCity.id, name: testStreet.testCity.name },
    },
  };

  try {
    const result = await handler.GET!(
      makeContext("http://localhost/", { user: sessionUser }),
    ) as { data: { ownStreetStatus: unknown } };
    assertEquals(result.data.ownStreetStatus, {
      housesCount: 1,
      remaining: STREET_AWAKENING_THRESHOLD - 1,
      isAmbassadorSlot: false,
      isAwake: false,
    });
  } finally {
    await db.delete(user).where(eq(user.id, created.id));
    await db.delete(house).where(eq(house.id, created.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("Page d'accueil : non connecté → ownStreetStatus toujours null", async () => {
  const result = await handler.GET!(
    makeContext("http://localhost/"),
  ) as { data: { ownStreetStatus: unknown } };
  assertEquals(result.data.ownStreetStatus, null);
});

Deno.test("Page d'accueil : habitant vérifié → voisins non vérifiés de sa rue remontés (cf. db/vouches.ts)", async () => {
  const testStreet = await createTestStreet("index-4");
  const { user: ambassador } = await registerInhabitant({
    login: `amb-${crypto.randomUUID()}`,
    email: `index-amb-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const { user: pending } = await registerInhabitant({
    login: `pending-${crypto.randomUUID()}`,
    email: `index-pending-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const ambassadorSession: SessionUser = {
    id: ambassador.id,
    login: ambassador.login,
    email: ambassador.email,
    isAmbassador: ambassador.isAmbassador,
    isVerified: true,
    street: {
      id: testStreet.testStreet.id,
      name: testStreet.testStreet.name,
      city: { id: testStreet.testCity.id, name: testStreet.testCity.name },
    },
  };

  try {
    const result = await handler.GET!(
      makeContext("http://localhost/", { user: ambassadorSession }),
    ) as { data: { pendingNeighbors: { id: number; login: string }[] } };
    assertEquals(
      result.data.pendingNeighbors.map((n) => n.id),
      [pending.id],
    );
  } finally {
    await db.delete(user).where(eq(user.id, ambassador.id));
    await db.delete(user).where(eq(user.id, pending.id));
    await db.delete(house).where(eq(house.streetId, testStreet.testStreet.id));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("Page d'accueil : habitant non vérifié → aucun voisin non-vérifié remonté (il ne peut vouch pour personne), mais les voisins déjà vérifiés le sont (cf. retour utilisateur : qui solliciter)", async () => {
  const testStreet = await createTestStreet("index-5");
  const { user: ambassador } = await registerInhabitant({
    login: `amb-${crypto.randomUUID()}`,
    email: `index-amb2-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const { user: pending } = await registerInhabitant({
    login: `pending-${crypto.randomUUID()}`,
    email: `index-pending2-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const pendingSession: SessionUser = {
    id: pending.id,
    login: pending.login,
    email: pending.email,
    isAmbassador: pending.isAmbassador,
    isVerified: false,
    street: {
      id: testStreet.testStreet.id,
      name: testStreet.testStreet.name,
      city: { id: testStreet.testCity.id, name: testStreet.testCity.name },
    },
  };

  try {
    const result = await handler.GET!(
      makeContext("http://localhost/", { user: pendingSession }),
    ) as {
      data: {
        pendingNeighbors: unknown[];
        verifiedNeighbors: { id: number; login: string }[];
      };
    };
    assertEquals(result.data.pendingNeighbors, []);
    assertEquals(
      result.data.verifiedNeighbors.map((n) => n.id),
      [ambassador.id],
    );
  } finally {
    await db.delete(user).where(eq(user.id, ambassador.id));
    await db.delete(user).where(eq(user.id, pending.id));
    await db.delete(house).where(eq(house.streetId, testStreet.testStreet.id));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("Page d'accueil : habitant déjà vérifié → verifiedNeighbors vide (il n'en a pas besoin)", async () => {
  const testStreet = await createTestStreet("index-6");
  const { user: ambassador } = await registerInhabitant({
    login: `amb-${crypto.randomUUID()}`,
    email: `index-amb3-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const ambassadorSession: SessionUser = {
    id: ambassador.id,
    login: ambassador.login,
    email: ambassador.email,
    isAmbassador: ambassador.isAmbassador,
    isVerified: true,
    street: {
      id: testStreet.testStreet.id,
      name: testStreet.testStreet.name,
      city: { id: testStreet.testCity.id, name: testStreet.testCity.name },
    },
  };

  try {
    const result = await handler.GET!(
      makeContext("http://localhost/", { user: ambassadorSession }),
    ) as { data: { verifiedNeighbors: unknown[] } };
    assertEquals(result.data.verifiedNeighbors, []);
  } finally {
    await db.delete(user).where(eq(user.id, ambassador.id));
    await db.delete(house).where(eq(house.streetId, testStreet.testStreet.id));
    await cleanupTestStreet(testStreet);
  }
});
