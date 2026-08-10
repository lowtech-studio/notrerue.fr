import { assertEquals, assertStringIncludes } from "@std/assert";
import { eq } from "drizzle-orm";
import type { Context } from "fresh";
import type { SessionUser, State } from "../utils.ts";
import { db } from "../db/client.ts";
import { house, user } from "../db/schema.ts";
import { registerInhabitant } from "../db/users.ts";
import { STREET_AWAKENING_THRESHOLD } from "../db/streets.ts";
import { cleanupTestStreet, createTestStreet } from "../db/test_helpers.ts";
import { handler } from "./inviter.tsx";

function makeContext(
  user: SessionUser | null,
  options: { url?: string; form?: FormData } = {},
): Context<State> {
  return {
    url: new URL(options.url ?? "http://localhost/inviter"),
    state: { user },
    redirect: (location: string) =>
      new Response(null, { status: 302, headers: { location } }),
    req: { formData: () => Promise.resolve(options.form ?? new FormData()) },
  } as unknown as Context<State>;
}

Deno.test("GET /inviter : non connecté → redirigé vers /connexion", async () => {
  const response = await handler.GET!(makeContext(null)) as Response;
  assertEquals(response.status, 302);
  assertEquals(response.headers.get("location"), "/connexion");
});

Deno.test("POST /inviter : non connecté → redirigé vers /connexion", async () => {
  const response = await handler.POST!(makeContext(null)) as Response;
  assertEquals(response.status, 302);
  assertEquals(response.headers.get("location"), "/connexion");
});

Deno.test("GET /inviter : connecté sur une rue non allumée → statut et lien d'invitation absolu", async () => {
  const testStreet = await createTestStreet("inviter-1");
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `inviter-${crypto.randomUUID()}@example.invalid`,
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
    const result = await handler.GET!(makeContext(sessionUser)) as {
      data: {
        streetName: string;
        cityName: string;
        status: { housesCount: number; isAwake: boolean };
        joinUrl: string;
        message: string;
        inviteError: string | null;
        invitedEmail: string | null;
      };
    };

    assertEquals(result.data.streetName, testStreet.testStreet.name);
    assertEquals(result.data.cityName, testStreet.testCity.name);
    assertEquals(result.data.status.housesCount, 1);
    assertEquals(result.data.status.isAwake, STREET_AWAKENING_THRESHOLD <= 1);
    assertEquals(
      result.data.joinUrl,
      `http://localhost/rejoindre?cityId=${testStreet.testCity.id}` +
        `&city=${encodeURIComponent(testStreet.testCity.name)}` +
        `&street=${encodeURIComponent(testStreet.testStreet.name)}`,
    );
    assertStringIncludes(result.data.message, result.data.joinUrl);
    assertStringIncludes(result.data.message, testStreet.testStreet.name);
    assertEquals(result.data.inviteError, null);
    assertEquals(result.data.invitedEmail, null);
  } finally {
    await db.delete(user).where(eq(user.id, created.id));
    await db.delete(house).where(eq(house.id, created.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("GET /inviter : ?invited=... → bandeau de confirmation", async () => {
  const testStreet = await createTestStreet("inviter-2");
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `inviter-${crypto.randomUUID()}@example.invalid`,
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
      makeContext(sessionUser, {
        url: "http://localhost/inviter?invited=voisin%40exemple.fr",
      }),
    ) as { data: { invitedEmail: string | null } };

    assertEquals(result.data.invitedEmail, "voisin@exemple.fr");
  } finally {
    await db.delete(user).where(eq(user.id, created.id));
    await db.delete(house).where(eq(house.id, created.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("POST /inviter : e-mail du voisin invalide → erreur, pas d'envoi tenté", async () => {
  const testStreet = await createTestStreet("inviter-3");
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `inviter-${crypto.randomUUID()}@example.invalid`,
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
  const form = new FormData();
  form.set("neighborEmail", "pas-un-email");

  try {
    const result = await handler.POST!(
      makeContext(sessionUser, { form }),
    ) as { data: { inviteError: string | null; invitedEmail: string | null } };

    assertEquals(
      result.data.inviteError,
      "Merci de renseigner un e-mail valide.",
    );
    assertEquals(result.data.invitedEmail, null);
  } finally {
    await db.delete(user).where(eq(user.id, created.id));
    await db.delete(house).where(eq(house.id, created.houseId));
    await cleanupTestStreet(testStreet);
  }
});
