import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import type { Context } from "fresh";
import type { SessionUser, State } from "../../../../utils.ts";
import { db } from "../../../../db/client.ts";
import { house, user } from "../../../../db/schema.ts";
import { STREET_AWAKENING_THRESHOLD } from "../../../../db/streets.ts";
import { registerInhabitant } from "../../../../db/users.ts";
import {
  cleanupTestStreet,
  createTestStreet,
} from "../../../../db/test_helpers.ts";
import { handler } from "./status.ts";

function makeContext(sessionUser: SessionUser | null): Context<State> {
  return {
    state: { user: sessionUser },
  } as unknown as Context<State>;
}

Deno.test("GET /api/v1/streets/status : non connecté → 401", async () => {
  const res = await handler.GET!(makeContext(null)) as Response;
  assertEquals(res.status, 401);
});

Deno.test("GET /api/v1/streets/status : rue en dessous du seuil → isAwake false, remaining cohérent", async () => {
  const testStreet = await createTestStreet("api-street-status-1");
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `api-street-status-${crypto.randomUUID()}@example.invalid`,
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
    const res = await handler.GET!(makeContext(sessionUser)) as Response;
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.streetName, testStreet.testStreet.name);
    assertEquals(body.cityId, testStreet.testCity.id);
    assertEquals(body.cityName, testStreet.testCity.name);
    assertEquals(body.threshold, STREET_AWAKENING_THRESHOLD);
    assertEquals(body.housesCount, 1);
    assertEquals(body.remaining, STREET_AWAKENING_THRESHOLD - 1);
    assertEquals(body.isAwake, false);
  } finally {
    await db.delete(user).where(eq(user.id, created.id));
    await db.delete(house).where(eq(house.id, created.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("GET /api/v1/streets/status : rue au seuil → isAwake true, remaining 0", async () => {
  const testStreet = await createTestStreet("api-street-status-2");
  if (STREET_AWAKENING_THRESHOLD > 1) {
    await db.insert(house).values(
      Array.from(
        { length: STREET_AWAKENING_THRESHOLD - 1 },
        () => ({ streetId: testStreet.testStreet.id }),
      ),
    );
  }
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `api-street-status-${crypto.randomUUID()}@example.invalid`,
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
    const res = await handler.GET!(makeContext(sessionUser)) as Response;
    const body = await res.json();
    assertEquals(body.housesCount, STREET_AWAKENING_THRESHOLD);
    assertEquals(body.remaining, 0);
    assertEquals(body.isAwake, true);
  } finally {
    await db.delete(user).where(eq(user.id, created.id));
    await db.delete(house).where(
      eq(house.streetId, testStreet.testStreet.id),
    );
    await cleanupTestStreet(testStreet);
  }
});
