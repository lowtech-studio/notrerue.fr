import { assertEquals } from "@std/assert";
import { App } from "fresh";
import { eq } from "drizzle-orm";
import type { State } from "../utils.ts";
import { db } from "../db/client.ts";
import { house, message, user } from "../db/schema.ts";
import { registerInhabitant } from "../db/users.ts";
import { STREET_AWAKENING_THRESHOLD } from "../db/streets.ts";
import { sendMessage } from "../db/messages.ts";
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
      JSON.stringify({
        isStreetAwake: ctx.state.isStreetAwake,
        theme: ctx.state.theme,
        hasUnreadMessages: ctx.state.hasUnreadMessages,
      }),
      { headers: { "content-type": "application/json" } },
    );
  });
  return app.handler();
}

Deno.test("_middleware : isStreetAwake nul et hasUnreadMessages faux si non authentifié", async () => {
  const handle = buildTestHandler();
  const res = await handle(new Request("http://localhost/__probe"));
  const body = await res.json();
  assertEquals(body.isStreetAwake, null);
  assertEquals(body.hasUnreadMessages, false);
});

Deno.test("_middleware : hasUnreadMessages reflète un message privé réellement en attente (cf. backlog pastille)", async () => {
  const testStreet = await createTestStreet("middleware-unread");
  const { user: recipient } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `middleware-unread-to-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const { user: sender } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `middleware-unread-from-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });

  const handle = buildTestHandler();

  try {
    const cookie = await createSessionValue(recipient.id);
    const beforeRes = await handle(
      new Request("http://localhost/__probe", {
        headers: { cookie: `${SESSION_COOKIE}=${cookie}` },
      }),
    );
    assertEquals((await beforeRes.json()).hasUnreadMessages, false);

    await sendMessage({
      fromUserId: sender.id,
      toUserId: recipient.id,
      content: "Bonjour !",
    });

    const afterRes = await handle(
      new Request("http://localhost/__probe", {
        headers: { cookie: `${SESSION_COOKIE}=${cookie}` },
      }),
    );
    assertEquals((await afterRes.json()).hasUnreadMessages, true);
  } finally {
    await db.delete(message).where(eq(message.userFromId, sender.id));
    await db.delete(user).where(eq(user.id, recipient.id));
    await db.delete(user).where(eq(user.id, sender.id));
    await db.delete(house).where(eq(house.streetId, testStreet.testStreet.id));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("_middleware : theme nul par défaut, reflète le cookie notrerue_theme sinon — même sans authentification (cf. routes/theme.ts)", async () => {
  const handle = buildTestHandler();

  const withoutCookie = await handle(new Request("http://localhost/__probe"));
  assertEquals((await withoutCookie.json()).theme, null);

  const withDarkCookie = await handle(
    new Request("http://localhost/__probe", {
      headers: { cookie: "notrerue_theme=dark" },
    }),
  );
  assertEquals((await withDarkCookie.json()).theme, "dark");

  const withInvalidCookie = await handle(
    new Request("http://localhost/__probe", {
      headers: { cookie: "notrerue_theme=n'importe quoi" },
    }),
  );
  assertEquals((await withInvalidCookie.json()).theme, null);
});

Deno.test("_middleware : en-têtes de sécurité posés sur toute réponse (cf. AGENTS.md, ANSSI-PA-009)", async () => {
  // La CSP elle-même est posée par le middleware `csp()` de Fresh dans
  // main.ts (cf. utils/csp_test.ts), pas ici : elle a besoin du nonce
  // généré au rendu d'une page réelle, hors de portée de cette sonde
  // minimale sans page à rendre.
  const handle = buildTestHandler();
  const res = await handle(new Request("http://localhost/__probe"));

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
