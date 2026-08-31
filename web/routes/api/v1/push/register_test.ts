import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import type { Context } from "fresh";
import type { SessionUser, State } from "../../../../utils.ts";
import { db } from "../../../../db/client.ts";
import { house, user } from "../../../../db/schema.ts";
import { registerInhabitant } from "../../../../db/users.ts";
import {
  cleanupTestStreet,
  createTestStreet,
} from "../../../../db/test_helpers.ts";
import { handler } from "./register.ts";

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
    email: `push-register-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const session: SessionUser = {
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
  return { testStreet, user: created, session };
}

async function teardown(setup: Awaited<ReturnType<typeof setupInhabitant>>) {
  await db.delete(user).where(eq(user.id, setup.user.id));
  await db.delete(house).where(eq(house.id, setup.user.houseId));
  await cleanupTestStreet(setup.testStreet);
}

Deno.test("POST /api/v1/push/register : non connecté → 401", async () => {
  const res = await handler.POST!(makeContext()) as Response;
  assertEquals(res.status, 401);
});

Deno.test("POST /api/v1/push/register : jeton vide → 400, rien enregistré", async () => {
  const setup = await setupInhabitant("push-register-1");
  try {
    const res = await handler.POST!(
      makeContext({ user: setup.session, body: { token: "  " } }),
    ) as Response;
    assertEquals(res.status, 400);
  } finally {
    await teardown(setup);
  }
});

Deno.test("POST /api/v1/push/register : jeton valide → enregistré", async () => {
  const setup = await setupInhabitant("push-register-2");
  try {
    const res = await handler.POST!(
      makeContext({
        user: setup.session,
        body: { token: "ExponentPushToken[abc123]" },
      }),
    ) as Response;
    assertEquals(res.status, 200);
    const [row] = await db.select().from(user).where(
      eq(user.id, setup.user.id),
    );
    assertEquals(row.pushToken, "ExponentPushToken[abc123]");
  } finally {
    await teardown(setup);
  }
});
