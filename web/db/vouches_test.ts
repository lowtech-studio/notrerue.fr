import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import { db } from "./client.ts";
import { house, user, vouch } from "./schema.ts";
import { registerInhabitant } from "./users.ts";
import { listPendingNeighbors, vouchForNeighbor } from "./vouches.ts";
import { cleanupTestStreet, createTestStreet } from "./test_helpers.ts";

async function setupStreetWithAmbassador(label: string) {
  const testStreet = await createTestStreet(label);
  const { user: ambassador } = await registerInhabitant({
    login: `ambassador-${crypto.randomUUID()}`,
    email: `vouches-amb-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  return { testStreet, ambassador };
}

async function teardown(
  testStreet: Awaited<ReturnType<typeof createTestStreet>>,
  userIds: number[],
) {
  for (const id of userIds) {
    await db.delete(vouch).where(eq(vouch.voucherId, id));
    await db.delete(vouch).where(eq(vouch.voucheeId, id));
    await db.delete(user).where(eq(user.id, id));
  }
  await db.delete(house).where(eq(house.streetId, testStreet.testStreet.id));
  await cleanupTestStreet(testStreet);
}

Deno.test("registerInhabitant : l'ambassadeur (premier habitant) est vérifié dès l'inscription, pas les suivants", async () => {
  const { testStreet, ambassador } = await setupStreetWithAmbassador(
    "vouches-1",
  );
  const { user: second } = await registerInhabitant({
    login: `second-${crypto.randomUUID()}`,
    email: `vouches-2nd-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });

  try {
    assertEquals(ambassador.isAmbassador, true);
    assertEquals(ambassador.verifiedAt !== null, true);
    assertEquals(second.isAmbassador, false);
    assertEquals(second.verifiedAt, null);
  } finally {
    await teardown(testStreet, [ambassador.id, second.id]);
  }
});

Deno.test("listPendingNeighbors : habitants actifs non vérifiés de la rue, plus ancien d'abord, isolé par rue", async () => {
  const { testStreet, ambassador } = await setupStreetWithAmbassador(
    "vouches-2",
  );
  const { user: pendingA } = await registerInhabitant({
    login: `pending-a-${crypto.randomUUID()}`,
    email: `vouches-pa-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const { user: pendingB } = await registerInhabitant({
    login: `pending-b-${crypto.randomUUID()}`,
    email: `vouches-pb-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const otherStreet = await createTestStreet("vouches-2b");
  const { user: otherStreetUser } = await registerInhabitant({
    login: `other-${crypto.randomUUID()}`,
    email: `vouches-other-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: otherStreet.testStreet.id,
  });

  try {
    const pending = await listPendingNeighbors(testStreet.testStreet.id);
    assertEquals(pending.map((p) => p.id), [pendingA.id, pendingB.id]);
    // L'ambassadeur (déjà vérifié) et un habitant d'une autre rue n'apparaissent pas.
    assertEquals(pending.some((p) => p.id === ambassador.id), false);
    assertEquals(pending.some((p) => p.id === otherStreetUser.id), false);
  } finally {
    await teardown(testStreet, [ambassador.id, pendingA.id, pendingB.id]);
    await db.delete(user).where(eq(user.id, otherStreetUser.id));
    await db.delete(house).where(
      eq(house.streetId, otherStreet.testStreet.id),
    );
    await cleanupTestStreet(otherStreet);
  }
});

Deno.test("vouchForNeighbor : un habitant vérifié valide un voisin de sa rue → vérifié, un vouch enregistré", async () => {
  const { testStreet, ambassador } = await setupStreetWithAmbassador(
    "vouches-3",
  );
  const { user: pending } = await registerInhabitant({
    login: `pending-${crypto.randomUUID()}`,
    email: `vouches-p3-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });

  try {
    const outcome = await vouchForNeighbor(ambassador.id, pending.id);
    assertEquals(outcome, "ok");

    const [reloaded] = await db.select().from(user).where(
      eq(user.id, pending.id),
    );
    assertEquals(reloaded.verifiedAt !== null, true);

    const [vouchRow] = await db.select().from(vouch).where(
      eq(vouch.voucheeId, pending.id),
    );
    assertEquals(vouchRow.voucherId, ambassador.id);
  } finally {
    await teardown(testStreet, [ambassador.id, pending.id]);
  }
});

Deno.test("vouchForNeighbor : idempotent (déjà vérifié) → 'already_verified', pas d'erreur", async () => {
  const { testStreet, ambassador } = await setupStreetWithAmbassador(
    "vouches-4",
  );
  const { user: pending } = await registerInhabitant({
    login: `pending-${crypto.randomUUID()}`,
    email: `vouches-p4-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });

  try {
    assertEquals(await vouchForNeighbor(ambassador.id, pending.id), "ok");
    assertEquals(
      await vouchForNeighbor(ambassador.id, pending.id),
      "already_verified",
    );
  } finally {
    await teardown(testStreet, [ambassador.id, pending.id]);
  }
});

Deno.test("vouchForNeighbor : refuse de se vérifier soi-même", async () => {
  const { testStreet, ambassador } = await setupStreetWithAmbassador(
    "vouches-5",
  );

  try {
    assertEquals(await vouchForNeighbor(ambassador.id, ambassador.id), "self");
  } finally {
    await teardown(testStreet, [ambassador.id]);
  }
});

Deno.test("vouchForNeighbor : un habitant non vérifié ne peut vérifier personne", async () => {
  const { testStreet, ambassador } = await setupStreetWithAmbassador(
    "vouches-6",
  );
  const { user: pendingA } = await registerInhabitant({
    login: `pending-a-${crypto.randomUUID()}`,
    email: `vouches-pa6-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const { user: pendingB } = await registerInhabitant({
    login: `pending-b-${crypto.randomUUID()}`,
    email: `vouches-pb6-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });

  try {
    const outcome = await vouchForNeighbor(pendingA.id, pendingB.id);
    assertEquals(outcome, "voucher_not_verified");

    const [reloaded] = await db.select().from(user).where(
      eq(user.id, pendingB.id),
    );
    assertEquals(reloaded.verifiedAt, null);
  } finally {
    await teardown(testStreet, [ambassador.id, pendingA.id, pendingB.id]);
  }
});

Deno.test("vouchForNeighbor : refuse de vérifier un habitant d'une autre rue", async () => {
  const { testStreet, ambassador } = await setupStreetWithAmbassador(
    "vouches-7",
  );
  const otherStreet = await createTestStreet("vouches-7b");
  const { user: otherStreetPending } = await registerInhabitant({
    login: `pending-${crypto.randomUUID()}`,
    email: `vouches-p7-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: otherStreet.testStreet.id,
  });

  try {
    const outcome = await vouchForNeighbor(
      ambassador.id,
      otherStreetPending.id,
    );
    assertEquals(outcome, "not_same_street");
  } finally {
    await teardown(testStreet, [ambassador.id]);
    await db.delete(user).where(eq(user.id, otherStreetPending.id));
    await db.delete(house).where(
      eq(house.streetId, otherStreet.testStreet.id),
    );
    await cleanupTestStreet(otherStreet);
  }
});

Deno.test("vouchForNeighbor : voucher ou vouchee inexistant → 'not_found'", async () => {
  const { testStreet, ambassador } = await setupStreetWithAmbassador(
    "vouches-8",
  );

  try {
    assertEquals(
      await vouchForNeighbor(ambassador.id, 999_999_999),
      "not_found",
    );
    assertEquals(
      await vouchForNeighbor(999_999_999, ambassador.id),
      "not_found",
    );
  } finally {
    await teardown(testStreet, [ambassador.id]);
  }
});
