import { assertEquals, assertExists } from "@std/assert";
import type { Context } from "fresh";
import { eq } from "drizzle-orm";
import type { SessionUser, State } from "../../../utils.ts";
import { db } from "../../../db/client.ts";
import { city, house, street, user } from "../../../db/schema.ts";
import { registerInhabitant } from "../../../db/users.ts";
import { createTestCity } from "../../../db/test_helpers.ts";
import { handler } from "./join.ts";

function makeContext(
  body: unknown,
  sessionUser: SessionUser | null = null,
): Context<State> {
  return {
    url: new URL("http://localhost/api/v1/join"),
    state: { user: sessionUser },
    req: { json: () => Promise.resolve(body) },
  } as unknown as Context<State>;
}

/** Supprime l'utilisateur (et son foyer) créés pour cet e-mail, s'ils existent. */
async function cleanupByEmail(email: string): Promise<void> {
  const [found] = await db.select().from(user).where(eq(user.email, email));
  if (found) {
    await db.delete(user).where(eq(user.id, found.id));
    await db.delete(house).where(eq(house.id, found.houseId));
  }
}

/** Supprime toutes les rues créées sous cette ville de test, puis la ville. */
async function cleanupCity(testCity: { id: number }): Promise<void> {
  await db.delete(street).where(eq(street.cityId, testCity.id));
  await db.delete(city).where(eq(city.id, testCity.id));
}

Deno.test("POST /api/v1/join : déjà connecté → 409, rien traité", async () => {
  const fakeSessionUser = {
    id: 1,
    login: "x",
    email: "x@example.invalid",
    isAmbassador: false,
    street: { id: 1, name: "x", city: { id: 1, name: "x" } },
  } as SessionUser;
  const res = await handler.POST!(
    makeContext({}, fakeSessionUser),
  ) as Response;
  assertEquals(res.status, 409);
});

Deno.test("POST /api/v1/join : JSON illisible → 400", async () => {
  const ctx = {
    url: new URL("http://localhost/api/v1/join"),
    state: { user: null },
    req: { json: () => Promise.reject(new SyntaxError("corps invalide")) },
  } as unknown as Context<State>;
  const res = await handler.POST!(ctx) as Response;
  assertEquals(res.status, 400);
});

Deno.test("POST /api/v1/join : champs manquants → 400", async () => {
  const res = await handler.POST!(
    makeContext({ login: "camille" }),
  ) as Response;
  assertEquals(res.status, 400);
});

Deno.test("POST /api/v1/join : âge non confirmé → 400 dédié", async () => {
  const testCity = await createTestCity("api-join-age");
  try {
    const res = await handler.POST!(
      makeContext({
        login: `login-${crypto.randomUUID()}`,
        email: `api-join-age-${crypto.randomUUID()}@example.invalid`,
        street: "Rue Neuve",
        cityId: testCity.id,
        ageConfirmed: false,
      }),
    ) as Response;
    assertEquals(res.status, 400);
    const body = await res.json();
    assertEquals(body.error.includes("15 ans"), true);
  } finally {
    await cleanupCity(testCity);
  }
});

Deno.test("POST /api/v1/join : ville inconnue → 400", async () => {
  const res = await handler.POST!(
    makeContext({
      login: `login-${crypto.randomUUID()}`,
      email: `api-join-noville-${crypto.randomUUID()}@example.invalid`,
      street: "Rue Neuve",
      cityId: 999_999_999,
      ageConfirmed: true,
    }),
  ) as Response;
  assertEquals(res.status, 400);
});

Deno.test("POST /api/v1/join : inscription valide sur une rue nouvelle → 200, ambassadeur, code posé en base, jamais renvoyé", async () => {
  const testCity = await createTestCity("api-join-1");
  const email = `api-join-1-${crypto.randomUUID()}@example.invalid`;
  const streetName = `Rue de test api-join-1 ${crypto.randomUUID()}`;

  try {
    const res = await handler.POST!(
      makeContext({
        login: `login-${crypto.randomUUID()}`,
        email,
        street: streetName,
        cityId: testCity.id,
        ageConfirmed: true,
      }),
    ) as Response;
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.ok, true);
    assertEquals(body.isAmbassador, true);
    // Jamais le code dans la réponse (cf. commentaire de join.ts : la
    // vérification par e-mail doit rester le seul chemin).
    assertEquals("code" in body, false);

    const [created] = await db.select().from(user).where(
      eq(user.email, email),
    );
    assertExists(created);
    assertExists(created.loginCode);
    assertEquals(created.isAmbassador, true);

    const [createdStreet] = await db.select().from(street).where(
      eq(street.cityId, testCity.id),
    );
    assertExists(createdStreet);
    assertEquals(createdStreet.name, streetName);
  } finally {
    await cleanupByEmail(email);
    await cleanupCity(testCity);
  }
});

Deno.test("POST /api/v1/join : deuxième inscription sur la même rue → pas ambassadeur, ne plante pas (notification tolérante)", async () => {
  const testCity = await createTestCity("api-join-2");
  const streetName = `Rue de test api-join-2 ${crypto.randomUUID()}`;
  const firstEmail = `api-join-2-first-${crypto.randomUUID()}@example.invalid`;
  const secondEmail =
    `api-join-2-second-${crypto.randomUUID()}@example.invalid`;

  try {
    const firstRes = await handler.POST!(
      makeContext({
        login: `login-${crypto.randomUUID()}`,
        email: firstEmail,
        street: streetName,
        cityId: testCity.id,
        ageConfirmed: true,
      }),
    ) as Response;
    assertEquals(firstRes.status, 200);
    assertEquals((await firstRes.json()).isAmbassador, true);

    const secondRes = await handler.POST!(
      makeContext({
        login: `login-${crypto.randomUUID()}`,
        email: secondEmail,
        street: streetName,
        cityId: testCity.id,
        ageConfirmed: true,
      }),
    ) as Response;
    assertEquals(secondRes.status, 200);
    assertEquals((await secondRes.json()).isAmbassador, false);
  } finally {
    await cleanupByEmail(firstEmail);
    await cleanupByEmail(secondEmail);
    await cleanupCity(testCity);
  }
});

Deno.test("POST /api/v1/join : login déjà pris → 409, rien de plus créé", async () => {
  const testCity = await createTestCity("api-join-3");
  // Volontairement court (pas `login-${crypto.randomUUID()}`, 42
  // caractères) : au-delà de MAX_LOGIN_LENGTH (40), la route le tronque via
  // `parseBody` mais pas l'insert direct ci-dessous, qui obtiendrait alors
  // deux logins différents en base — pas de conflit, faux négatif.
  const takenLogin = `login-${crypto.randomUUID().slice(0, 8)}`;
  const firstEmail = `api-join-3-first-${crypto.randomUUID()}@example.invalid`;
  const secondEmail =
    `api-join-3-second-${crypto.randomUUID()}@example.invalid`;

  try {
    // Premier compte, login pris directement via registerInhabitant (pas
    // besoin de repasser par la route pour le poser).
    await registerInhabitant({
      login: takenLogin,
      email: firstEmail,
      houseNumber: null,
      streetId: (await db.insert(street).values({
        name: `Rue de test api-join-3 ${crypto.randomUUID()}`,
        cityId: testCity.id,
      }).returning())[0].id,
    });

    const res = await handler.POST!(
      makeContext({
        login: takenLogin,
        email: secondEmail,
        street: `Rue de test api-join-3-bis ${crypto.randomUUID()}`,
        cityId: testCity.id,
        ageConfirmed: true,
      }),
    ) as Response;
    assertEquals(res.status, 409);

    const [secondUser] = await db.select().from(user).where(
      eq(user.email, secondEmail),
    );
    assertEquals(secondUser, undefined);
  } finally {
    await cleanupByEmail(firstEmail);
    await cleanupByEmail(secondEmail);
    await cleanupCity(testCity);
  }
});

Deno.test("POST /api/v1/join : e-mail déjà inscrit → 409, message dédié", async () => {
  const testCity = await createTestCity("api-join-4");
  const email = `api-join-4-${crypto.randomUUID()}@example.invalid`;

  try {
    await registerInhabitant({
      login: `login-${crypto.randomUUID()}`,
      email,
      houseNumber: null,
      streetId: (await db.insert(street).values({
        name: `Rue de test api-join-4 ${crypto.randomUUID()}`,
        cityId: testCity.id,
      }).returning())[0].id,
    });

    const res = await handler.POST!(
      makeContext({
        login: `login-${crypto.randomUUID()}`,
        email,
        street: `Rue de test api-join-4-bis ${crypto.randomUUID()}`,
        cityId: testCity.id,
        ageConfirmed: true,
      }),
    ) as Response;
    assertEquals(res.status, 409);
    const body = await res.json();
    assertEquals(body.error.includes("déjà inscrit"), true);
  } finally {
    await cleanupByEmail(email);
    await cleanupCity(testCity);
  }
});

Deno.test("POST /api/v1/join : échec d'envoi Brevo → 502, mais le compte existe déjà en base", async () => {
  const realApiKey = Deno.env.get("BREVO_API_KEY");
  Deno.env.set("BREVO_API_KEY", "invalid-test-key");

  const testCity = await createTestCity("api-join-5");
  const email = `api-join-5-${crypto.randomUUID()}@example.invalid`;
  const streetName = `Rue de test api-join-5 ${crypto.randomUUID()}`;

  try {
    const res = await handler.POST!(
      makeContext({
        login: `login-${crypto.randomUUID()}`,
        email,
        street: streetName,
        cityId: testCity.id,
        ageConfirmed: true,
      }),
    ) as Response;
    assertEquals(res.status, 502);

    const [created] = await db.select().from(user).where(
      eq(user.email, email),
    );
    assertExists(created);
  } finally {
    if (realApiKey === undefined) {
      Deno.env.delete("BREVO_API_KEY");
    } else {
      Deno.env.set("BREVO_API_KEY", realApiKey);
    }
    await cleanupByEmail(email);
    await cleanupCity(testCity);
  }
});
