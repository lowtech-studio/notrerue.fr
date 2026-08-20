import { assertEquals } from "@std/assert";
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
import { handler } from "./code.ts";

function makeContext(body: unknown): Context<State> {
  return {
    url: new URL("http://localhost/api/v1/auth/code"),
    state: { user: null },
    req: { json: () => Promise.resolve(body) },
  } as unknown as Context<State>;
}

Deno.test("POST /api/v1/auth/code : e-mail invalide → 400", async () => {
  const res = await handler.POST!(
    makeContext({ email: "pas-un-email" }),
  ) as Response;
  assertEquals(res.status, 400);
});

Deno.test("POST /api/v1/auth/code : JSON illisible → 400", async () => {
  const ctx = {
    url: new URL("http://localhost/api/v1/auth/code"),
    state: { user: null },
    req: { json: () => Promise.reject(new SyntaxError("corps invalide")) },
  } as unknown as Context<State>;
  const res = await handler.POST!(ctx) as Response;
  assertEquals(res.status, 400);
});

Deno.test("POST /api/v1/auth/code : e-mail inconnu → même réponse qu'un e-mail inscrit (pas d'énumération de comptes)", async () => {
  const unknownRes = await handler.POST!(
    makeContext({ email: `inconnu-${crypto.randomUUID()}@example.invalid` }),
  ) as Response;
  assertEquals(unknownRes.status, 200);
  assertEquals(await unknownRes.json(), { ok: true });

  const testStreet = await createTestStreet("api-auth-code-1");
  const email = `api-auth-code-${crypto.randomUUID()}@example.invalid`;
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });

  try {
    const knownRes = await handler.POST!(makeContext({ email })) as Response;
    assertEquals(knownRes.status, 200);
    assertEquals(await knownRes.json(), { ok: true });
  } finally {
    await db.delete(user).where(eq(user.id, created.id));
    await db.delete(house).where(eq(house.id, created.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("POST /api/v1/auth/code : échec d'envoi Brevo → 502, pas de 500 brute", async () => {
  // Même technique que routes/connexion_test.ts : clé Brevo délibérément
  // invalide plutôt que de dépendre d'un état réseau changeant.
  const realApiKey = Deno.env.get("BREVO_API_KEY");
  Deno.env.set("BREVO_API_KEY", "invalid-test-key");

  const testStreet = await createTestStreet("api-auth-code-2");
  const email = `api-auth-code-fail-${crypto.randomUUID()}@example.invalid`;
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  // `registerInhabitant` pose déjà `loginCodeSentAt` : on le recule pour
  // sortir de la fenêtre de throttle et retomber dans le cas "sent", celui
  // qui déclenche réellement `sendLoginCodeEmail`.
  await db.update(user).set({
    loginCodeSentAt: new Date(Date.now() - 120_000),
  }).where(eq(user.id, created.id));

  try {
    const res = await handler.POST!(makeContext({ email })) as Response;
    assertEquals(res.status, 502);
  } finally {
    if (realApiKey === undefined) {
      Deno.env.delete("BREVO_API_KEY");
    } else {
      Deno.env.set("BREVO_API_KEY", realApiKey);
    }
    await db.delete(user).where(eq(user.id, created.id));
    await db.delete(house).where(eq(house.id, created.houseId));
    await cleanupTestStreet(testStreet);
  }
});
