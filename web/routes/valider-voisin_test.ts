import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import type { Context } from "fresh";
import type { SessionUser, State } from "../utils.ts";
import { db } from "../db/client.ts";
import { house, user, vouch } from "../db/schema.ts";
import { registerInhabitant } from "../db/users.ts";
import { cleanupTestStreet, createTestStreet } from "../db/test_helpers.ts";
import { handler } from "./valider-voisin.ts";

function makeContext(
  options: { user?: SessionUser | null; form?: FormData } = {},
): Context<State> {
  return {
    url: new URL("http://localhost/valider-voisin"),
    state: { user: options.user ?? null },
    redirect: (location: string) =>
      new Response(null, { status: 302, headers: { location } }),
    req: { formData: () => Promise.resolve(options.form ?? new FormData()) },
  } as unknown as Context<State>;
}

async function setupAmbassadorAndPending(label: string) {
  const testStreet = await createTestStreet(label);
  const { user: ambassador } = await registerInhabitant({
    login: `amb-${crypto.randomUUID()}`,
    email: `valider-amb-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const { user: pending } = await registerInhabitant({
    login: `pending-${crypto.randomUUID()}`,
    email: `valider-pending-${crypto.randomUUID()}@example.invalid`,
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
  return { testStreet, ambassador, ambassadorSession, pending };
}

async function teardown(
  setup: Awaited<ReturnType<typeof setupAmbassadorAndPending>>,
) {
  await db.delete(vouch).where(eq(vouch.voucherId, setup.ambassador.id));
  await db.delete(user).where(eq(user.id, setup.ambassador.id));
  await db.delete(user).where(eq(user.id, setup.pending.id));
  await db.delete(house).where(
    eq(house.streetId, setup.testStreet.testStreet.id),
  );
  await cleanupTestStreet(setup.testStreet);
}

Deno.test("POST /valider-voisin : non connecté → redirigé vers /connexion", async () => {
  const response = await handler.POST!(makeContext()) as Response;
  assertEquals(response.status, 302);
  assertEquals(response.headers.get("location"), "/connexion");
});

Deno.test("POST /valider-voisin : voisin vérifié valide un habitant de sa rue → vérifié, redirigé vers /", async () => {
  const setup = await setupAmbassadorAndPending("valider-1");

  try {
    const form = new FormData();
    form.set("voucheeId", String(setup.pending.id));

    const response = await handler.POST!(
      makeContext({ user: setup.ambassadorSession, form }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/");

    const [reloaded] = await db.select().from(user).where(
      eq(user.id, setup.pending.id),
    );
    assertEquals(reloaded.verifiedAt !== null, true);
  } finally {
    await teardown(setup);
  }
});

Deno.test("POST /valider-voisin : voucheeId absent/invalide → ignoré sans planter", async () => {
  const setup = await setupAmbassadorAndPending("valider-2");

  try {
    const form = new FormData();
    form.set("voucheeId", "pas-un-nombre");

    const response = await handler.POST!(
      makeContext({ user: setup.ambassadorSession, form }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/");

    const [reloaded] = await db.select().from(user).where(
      eq(user.id, setup.pending.id),
    );
    assertEquals(reloaded.verifiedAt, null);
  } finally {
    await teardown(setup);
  }
});
