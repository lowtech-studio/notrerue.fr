import { assertEquals } from "@std/assert";
import { App } from "fresh";
import { eq } from "drizzle-orm";
import type { State } from "../utils.ts";
import { db } from "../db/client.ts";
import { house, user } from "../db/schema.ts";
import { registerInhabitant } from "../db/users.ts";
import { STREET_AWAKENING_THRESHOLD } from "../db/streets.ts";
import { cleanupTestStreet, createTestStreet } from "../db/test_helpers.ts";
import { createSessionValue, SESSION_COOKIE } from "../utils/session.ts";
import { handler as middlewareHandler } from "./_middleware.ts";

/**
 * `App` minimale avec le middleware réel branché devant une route sonde —
 * même pattern que `routes/connexion_test.ts` — pour vérifier `ctx.state`
 * tel que peuplé en conditions réelles plutôt qu'en appelant la fonction à
 * la main avec un contexte factice.
 */
function buildTestHandler() {
  const app = new App<State>();
  app.use(middlewareHandler);
  app.get("/__probe", (ctx) => {
    return new Response(
      JSON.stringify({ isStreetAwake: ctx.state.isStreetAwake }),
      { headers: { "content-type": "application/json" } },
    );
  });
  return app.handler();
}

Deno.test("_middleware : isStreetAwake nul si non authentifié", async () => {
  const handle = buildTestHandler();
  const res = await handle(new Request("http://localhost/__probe"));
  const body = await res.json();
  assertEquals(body.isStreetAwake, null);
});

Deno.test("_middleware : en-têtes de sécurité posés sur toute réponse (cf. AGENTS.md, ANSSI-PA-009)", async () => {
  const handle = buildTestHandler();
  const res = await handle(new Request("http://localhost/__probe"));

  const csp = res.headers.get("Content-Security-Policy");
  assertEquals(csp?.includes("default-src 'self'"), true);
  assertEquals(csp?.includes("frame-ancestors 'none'"), true);
  // Sous `deno test`, non passé par Vite : CSP stricte (pas d'assouplissement
  // dev), donc rien de tout ça ne doit apparaître (cf. commentaire dans
  // _middleware.ts sur `import.meta.env?.DEV`).
  assertEquals(csp?.includes("unsafe-inline"), false);
  assertEquals(csp?.includes("unsafe-eval"), false);
  assertEquals(csp?.includes("data:"), false);

  assertEquals(res.headers.get("X-Frame-Options"), "DENY");
  assertEquals(
    res.headers.get("Referrer-Policy"),
    "strict-origin-when-cross-origin",
  );
});

Deno.test("_middleware : isStreetAwake reflète l'état réel de la rue de l'utilisateur", async () => {
  const asleepStreet = await createTestStreet("middleware-asleep");
  const { user: asleepUser } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `middleware-asleep-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: asleepStreet.testStreet.id,
  });

  const awakeStreet = await createTestStreet("middleware-awake");
  if (STREET_AWAKENING_THRESHOLD > 1) {
    await db.insert(house).values(
      Array.from(
        { length: STREET_AWAKENING_THRESHOLD - 1 },
        () => ({ streetId: awakeStreet.testStreet.id }),
      ),
    );
  }
  const { user: awakeUser } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `middleware-awake-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: awakeStreet.testStreet.id,
  });

  const handle = buildTestHandler();

  try {
    const asleepCookie = await createSessionValue(asleepUser.id);
    const asleepRes = await handle(
      new Request("http://localhost/__probe", {
        headers: { cookie: `${SESSION_COOKIE}=${asleepCookie}` },
      }),
    );
    assertEquals((await asleepRes.json()).isStreetAwake, false);

    const awakeCookie = await createSessionValue(awakeUser.id);
    const awakeRes = await handle(
      new Request("http://localhost/__probe", {
        headers: { cookie: `${SESSION_COOKIE}=${awakeCookie}` },
      }),
    );
    assertEquals((await awakeRes.json()).isStreetAwake, true);
  } finally {
    await db.delete(user).where(eq(user.id, asleepUser.id));
    await db.delete(user).where(eq(user.id, awakeUser.id));
    await db.delete(house).where(eq(house.id, asleepUser.houseId));
    await db.delete(house).where(
      eq(house.streetId, awakeStreet.testStreet.id),
    );
    await cleanupTestStreet(asleepStreet);
    await cleanupTestStreet(awakeStreet);
  }
});
