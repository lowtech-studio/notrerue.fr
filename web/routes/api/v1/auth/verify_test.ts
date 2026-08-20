import { assertEquals, assertExists } from "@std/assert";
import type { Context } from "fresh";
import { eq } from "drizzle-orm";
import type { State } from "../../../../utils.ts";
import { db } from "../../../../db/client.ts";
import { house, user } from "../../../../db/schema.ts";
import { registerInhabitant } from "../../../../db/users.ts";
import {
  cleanupTestStreet,
  createTestStreet,
} from "../../../../db/test_helpers.ts";
import { verifySessionValue } from "../../../../utils/session.ts";
import { handler } from "./verify.ts";

function makeContext(body: unknown): Context<State> {
  return {
    url: new URL("http://localhost/api/v1/auth/verify"),
    state: { user: null },
    req: { json: () => Promise.resolve(body) },
  } as unknown as Context<State>;
}

Deno.test("POST /api/v1/auth/verify : champs manquants → 400", async () => {
  const res = await handler.POST!(
    makeContext({ email: "a@b.fr" }),
  ) as Response;
  assertEquals(res.status, 400);
});

Deno.test("POST /api/v1/auth/verify : code correct → 200 + jeton exploitable par verifySessionValue", async () => {
  const testStreet = await createTestStreet("api-auth-verify-1");
  const email = `api-auth-verify-${crypto.randomUUID()}@example.invalid`;
  const { user: created, code } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });

  try {
    const res = await handler.POST!(makeContext({ email, code })) as Response;
    assertEquals(res.status, 200);
    const body = await res.json();
    assertExists(body.token);

    const verified = await verifySessionValue(body.token);
    assertExists(verified);
    assertEquals(verified.userId, created.id);
  } finally {
    await db.delete(user).where(eq(user.id, created.id));
    await db.delete(house).where(eq(house.id, created.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("POST /api/v1/auth/verify : code incorrect → 401", async () => {
  const testStreet = await createTestStreet("api-auth-verify-2");
  const email = `api-auth-verify-bad-${crypto.randomUUID()}@example.invalid`;
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });

  try {
    const res = await handler.POST!(
      makeContext({ email, code: "000000" }),
    ) as Response;
    assertEquals(res.status, 401);
  } finally {
    await db.delete(user).where(eq(user.id, created.id));
    await db.delete(house).where(eq(house.id, created.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("POST /api/v1/auth/verify : deuxième appel immédiat avec le même e-mail → 429 (cooldown anti brute-force)", async () => {
  const testStreet = await createTestStreet("api-auth-verify-3");
  const email =
    `api-auth-verify-cooldown-${crypto.randomUUID()}@example.invalid`;
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });

  try {
    const first = await handler.POST!(
      makeContext({ email, code: "000000" }),
    ) as Response;
    assertEquals(first.status, 401); // code faux, mais le cooldown est posé

    const second = await handler.POST!(
      makeContext({ email, code: "000000" }),
    ) as Response;
    assertEquals(second.status, 429);
  } finally {
    await db.delete(user).where(eq(user.id, created.id));
    await db.delete(house).where(eq(house.id, created.houseId));
    await cleanupTestStreet(testStreet);
  }
});
