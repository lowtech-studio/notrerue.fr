import { assertEquals, assertNotEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import type { Context } from "fresh";
import type { SessionUser, State } from "../utils.ts";
import { db } from "../db/client.ts";
import { house, user } from "../db/schema.ts";
import { registerInhabitant } from "../db/users.ts";
import { cleanupTestStreet, createTestStreet } from "../db/test_helpers.ts";
import { handler } from "./supprimer-compte.ts";

function makeContext(
  options: { user?: SessionUser | null } = {},
): Context<State> {
  return {
    state: { user: options.user ?? null },
    redirect: (location: string) =>
      new Response(null, { status: 302, headers: { location } }),
  } as unknown as Context<State>;
}

async function setupInhabitant(label: string) {
  const testStreet = await createTestStreet(label);
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID().slice(0, 8)}`,
    email: `supprimer-compte-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const street = {
    id: testStreet.testStreet.id,
    name: testStreet.testStreet.name,
    city: { id: testStreet.testCity.id, name: testStreet.testCity.name },
  };
  const session: SessionUser = {
    id: created.id,
    login: created.login,
    email: created.email,
    isAmbassador: created.isAmbassador,
    street,
  };
  return { testStreet, user: created, session };
}

async function teardown(setup: Awaited<ReturnType<typeof setupInhabitant>>) {
  await db.delete(user).where(eq(user.id, setup.user.id));
  await db.delete(house).where(eq(house.id, setup.user.houseId));
  await cleanupTestStreet(setup.testStreet);
}

Deno.test("POST /supprimer-compte : non connecté → redirigé vers /connexion, rien supprimé", async () => {
  const response = await handler.POST!(makeContext()) as Response;
  assertEquals(response.status, 302);
  assertEquals(response.headers.get("location"), "/connexion");
});

Deno.test("POST /supprimer-compte : connecté → compte supprimé, cookie expiré, redirigé vers l'accueil", async () => {
  const setup = await setupInhabitant("supprimer-compte-1");

  try {
    const response = await handler.POST!(
      makeContext({ user: setup.session }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/?compte_supprime=1");

    const setCookie = response.headers.get("set-cookie") ?? "";
    assertEquals(setCookie.includes("notrerue_session="), true);
    assertEquals(setCookie.includes("Max-Age=0"), true);

    const [reloadedUser] = await db.select().from(user).where(
      eq(user.id, setup.user.id),
    );
    assertNotEquals(reloadedUser.deletedAt, null);
  } finally {
    await teardown(setup);
  }
});
