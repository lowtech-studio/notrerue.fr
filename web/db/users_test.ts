import { assert, assertEquals, assertFalse, assertRejects } from "@std/assert";
import { eq } from "drizzle-orm";
import { db } from "./client.ts";
import { house, user } from "./schema.ts";
import {
  findUserByEmail,
  MAX_LOGIN_CODE_ATTEMPTS,
  registerInhabitant,
  verifyLoginCode,
} from "./users.ts";
import { cleanupTestStreet, createTestStreet } from "./test_helpers.ts";

Deno.test("registerInhabitant : le premier habitant d'une rue devient ambassadeur, pas le second", async () => {
  const testStreet = await createTestStreet("users-1");
  const emailA = `ambassador-${crypto.randomUUID()}@example.invalid`;
  const emailB = `second-${crypto.randomUUID()}@example.invalid`;

  let userAId: number | undefined;
  let userBId: number | undefined;
  let houseAId: number | undefined;
  let houseBId: number | undefined;

  try {
    const first = await registerInhabitant({
      login: `login-a-${crypto.randomUUID()}`,
      email: emailA,
      houseNumber: null,
      streetId: testStreet.testStreet.id,
    });
    userAId = first.user.id;
    houseAId = first.user.houseId;
    assert(first.user.isAmbassador);
    assertEquals(first.code.length, 6);

    const second = await registerInhabitant({
      login: `login-b-${crypto.randomUUID()}`,
      email: emailB,
      houseNumber: "14",
      streetId: testStreet.testStreet.id,
    });
    userBId = second.user.id;
    houseBId = second.user.houseId;
    assertFalse(second.user.isAmbassador);
  } finally {
    if (userAId) await db.delete(user).where(eq(user.id, userAId));
    if (userBId) await db.delete(user).where(eq(user.id, userBId));
    if (houseAId) await db.delete(house).where(eq(house.id, houseAId));
    if (houseBId) await db.delete(house).where(eq(house.id, houseBId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("registerInhabitant : e-mail déjà pris → le foyer créé pour cette tentative est annulé (pas de foyer fantôme)", async () => {
  const testStreet = await createTestStreet("users-1b");
  const email = `taken-${crypto.randomUUID()}@example.invalid`;

  let userAId: number | undefined;
  let houseAId: number | undefined;

  try {
    const first = await registerInhabitant({
      login: `login-a-${crypto.randomUUID()}`,
      email,
      houseNumber: null,
      streetId: testStreet.testStreet.id,
    });
    userAId = first.user.id;
    houseAId = first.user.houseId;

    // Même e-mail (contrainte `user_email_unique`) : l'insert `user` échoue,
    // et le foyer créé pour cette tentative doit disparaître avec — sinon il
    // compterait comme foyer existant pour le prochain inscrit de la rue.
    await assertRejects(
      () =>
        registerInhabitant({
          login: `login-b-${crypto.randomUUID()}`,
          email,
          houseNumber: null,
          streetId: testStreet.testStreet.id,
        }),
    );

    const houses = await db.select().from(house).where(
      eq(house.streetId, testStreet.testStreet.id),
    );
    assertEquals(houses.length, 1);
  } finally {
    if (userAId) await db.delete(user).where(eq(user.id, userAId));
    if (houseAId) await db.delete(house).where(eq(house.id, houseAId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("verifyLoginCode : accepte le bon code une seule fois, rejette le reste", async () => {
  const testStreet = await createTestStreet("users-2");
  const email = `code-${crypto.randomUUID()}@example.invalid`;

  let userId: number | undefined;
  let houseId: number | undefined;

  try {
    const { user: created, code } = await registerInhabitant({
      login: `login-${crypto.randomUUID()}`,
      email,
      houseNumber: null,
      streetId: testStreet.testStreet.id,
    });
    userId = created.id;
    houseId = created.houseId;

    assertEquals(await verifyLoginCode(email, "000000"), null);

    const verified = await verifyLoginCode(email, code);
    assert(verified);
    assertEquals(verified!.id, created.id);

    // Usage unique : le même code ne doit plus fonctionner une fois consommé.
    assertEquals(await verifyLoginCode(email, code), null);

    const reloaded = await findUserByEmail(email);
    assertEquals(reloaded!.loginCode, null);
    assertEquals(reloaded!.loginCodeExpiresAt, null);
  } finally {
    if (userId) await db.delete(user).where(eq(user.id, userId));
    if (houseId) await db.delete(house).where(eq(house.id, houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("verifyLoginCode : code expiré rejeté", async () => {
  const testStreet = await createTestStreet("users-3");
  const email = `expired-${crypto.randomUUID()}@example.invalid`;

  let userId: number | undefined;
  let houseId: number | undefined;

  try {
    const { user: created, code } = await registerInhabitant({
      login: `login-${crypto.randomUUID()}`,
      email,
      houseNumber: null,
      streetId: testStreet.testStreet.id,
    });
    userId = created.id;
    houseId = created.houseId;

    await db.update(user).set({
      loginCodeExpiresAt: new Date(Date.now() - 1000),
    }).where(eq(user.id, created.id));

    assertEquals(await verifyLoginCode(email, code), null);
  } finally {
    if (userId) await db.delete(user).where(eq(user.id, userId));
    if (houseId) await db.delete(house).where(eq(house.id, houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("verifyLoginCode : invalide le code après MAX_LOGIN_CODE_ATTEMPTS essais erronés (anti brute-force)", async () => {
  const testStreet = await createTestStreet("users-4");
  const email = `bruteforce-${crypto.randomUUID()}@example.invalid`;

  let userId: number | undefined;
  let houseId: number | undefined;

  try {
    const { user: created, code } = await registerInhabitant({
      login: `login-${crypto.randomUUID()}`,
      email,
      houseNumber: null,
      streetId: testStreet.testStreet.id,
    });
    userId = created.id;
    houseId = created.houseId;

    for (let i = 0; i < MAX_LOGIN_CODE_ATTEMPTS; i++) {
      assertEquals(await verifyLoginCode(email, "999999"), null);
    }

    // Le code correct est désormais invalidé, même si non expiré.
    assertEquals(await verifyLoginCode(email, code), null);
  } finally {
    if (userId) await db.delete(user).where(eq(user.id, userId));
    if (houseId) await db.delete(house).where(eq(house.id, houseId));
    await cleanupTestStreet(testStreet);
  }
});
