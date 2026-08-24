import { assertEquals, assertNotEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import type { Context } from "fresh";
import type { SessionUser, State } from "../../../utils.ts";
import { db } from "../../../db/client.ts";
import { house, user } from "../../../db/schema.ts";
import { registerInhabitant } from "../../../db/users.ts";
import {
  cleanupTestStreet,
  createTestStreet,
} from "../../../db/test_helpers.ts";
import { handler } from "./profile.ts";

function makeContext(
  options: { user?: SessionUser | null; body?: unknown } = {},
): Context<State> {
  return {
    state: { user: options.user ?? null },
    req: {
      json: () =>
        options.body === undefined
          ? Promise.reject(new SyntaxError("corps invalide"))
          : Promise.resolve(options.body),
    },
  } as unknown as Context<State>;
}

async function setupInhabitant(label: string) {
  const testStreet = await createTestStreet(label);
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID().slice(0, 8)}`,
    email: `api-profile-${crypto.randomUUID()}@example.invalid`,
    houseNumber: "12",
    streetId: testStreet.testStreet.id,
  });
  const session: SessionUser = {
    id: created.id,
    login: created.login,
    email: created.email,
    isAmbassador: created.isAmbassador,
    houseNumber: "12",
    street: {
      id: testStreet.testStreet.id,
      name: testStreet.testStreet.name,
      city: { id: testStreet.testCity.id, name: testStreet.testCity.name },
    },
  };
  return { testStreet, user: created, session };
}

async function teardown(setup: Awaited<ReturnType<typeof setupInhabitant>>) {
  await db.delete(user).where(eq(user.id, setup.user.id));
  await db.delete(house).where(eq(house.id, setup.user.houseId));
  await cleanupTestStreet(setup.testStreet);
}

Deno.test("GET /api/v1/profile : non connecté → 401", async () => {
  const res = await handler.GET!(makeContext()) as Response;
  assertEquals(res.status, 401);
});

Deno.test("GET /api/v1/profile : connecté → profil renvoyé", async () => {
  const setup = await setupInhabitant("api-profile-1");
  try {
    const res = await handler.GET!(
      makeContext({ user: setup.session }),
    ) as Response;
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.login, setup.user.login);
    assertEquals(body.email, setup.user.email);
    assertEquals(body.houseNumber, "12");
    assertEquals(body.streetName, setup.testStreet.testStreet.name);
    assertEquals(body.cityName, setup.testStreet.testCity.name);
  } finally {
    await teardown(setup);
  }
});

Deno.test("PATCH /api/v1/profile : non connecté → 401", async () => {
  const res = await handler.PATCH!(makeContext()) as Response;
  assertEquals(res.status, 401);
});

Deno.test("PATCH /api/v1/profile : login vide → 400, rien modifié", async () => {
  const setup = await setupInhabitant("api-profile-2");
  try {
    const res = await handler.PATCH!(
      makeContext({ user: setup.session, body: { login: "  " } }),
    ) as Response;
    assertEquals(res.status, 400);
    const [unchanged] = await db.select().from(user).where(
      eq(user.id, setup.user.id),
    );
    assertEquals(unchanged.login, setup.user.login);
  } finally {
    await teardown(setup);
  }
});

Deno.test("PATCH /api/v1/profile : login déjà utilisé → 409, rien modifié", async () => {
  const setup = await setupInhabitant("api-profile-3");
  const other = await setupInhabitant("api-profile-3b");
  try {
    const res = await handler.PATCH!(
      makeContext({
        user: setup.session,
        body: { login: other.user.login, houseNumber: "" },
      }),
    ) as Response;
    assertEquals(res.status, 409);
    const [unchanged] = await db.select().from(user).where(
      eq(user.id, setup.user.id),
    );
    assertEquals(unchanged.login, setup.user.login);
  } finally {
    await teardown(setup);
    await teardown(other);
  }
});

Deno.test("PATCH /api/v1/profile : login et numéro de foyer valides → mis à jour, e-mail/rue inchangés", async () => {
  const setup = await setupInhabitant("api-profile-4");
  const newLogin = `nouveau-${crypto.randomUUID().slice(0, 8)}`;
  try {
    const res = await handler.PATCH!(
      makeContext({
        user: setup.session,
        body: { login: newLogin, houseNumber: "27" },
      }),
    ) as Response;
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.login, newLogin);
    assertEquals(body.houseNumber, "27");
    assertEquals(body.email, setup.user.email);

    const [updatedUser] = await db.select().from(user).where(
      eq(user.id, setup.user.id),
    );
    assertEquals(updatedUser.login, newLogin);
    const [updatedHouse] = await db.select().from(house).where(
      eq(house.id, setup.user.houseId),
    );
    assertEquals(updatedHouse.number, "27");
  } finally {
    await teardown(setup);
  }
});

Deno.test("PATCH /api/v1/profile : numéro de foyer vide → effacé (null), pas une chaîne vide", async () => {
  const setup = await setupInhabitant("api-profile-5");
  try {
    await handler.PATCH!(
      makeContext({
        user: setup.session,
        body: { login: setup.user.login, houseNumber: "" },
      }),
    );
    const [updatedHouse] = await db.select().from(house).where(
      eq(house.id, setup.user.houseId),
    );
    assertEquals(updatedHouse.number, null);
  } finally {
    await teardown(setup);
  }
});

Deno.test("DELETE /api/v1/profile : non connecté → 401", async () => {
  const res = await handler.DELETE!(makeContext()) as Response;
  assertEquals(res.status, 401);
});

Deno.test("DELETE /api/v1/profile : connecté → compte soft-supprimé", async () => {
  const setup = await setupInhabitant("api-profile-6");
  try {
    const res = await handler.DELETE!(
      makeContext({ user: setup.session }),
    ) as Response;
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);

    const [reloaded] = await db.select().from(user).where(
      eq(user.id, setup.user.id),
    );
    assertNotEquals(reloaded.deletedAt, null);
  } finally {
    await teardown(setup);
  }
});
