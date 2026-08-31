import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import { db } from "./client.ts";
import { house, user } from "./schema.ts";
import { registerInhabitant } from "./users.ts";
import {
  clearPushToken,
  findPushRecipients,
  registerPushToken,
} from "./push.ts";
import { cleanupTestStreet, createTestStreet } from "./test_helpers.ts";

async function setupInhabitant(label: string) {
  const testStreet = await createTestStreet(label);
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID().slice(0, 8)}`,
    email: `push-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  return { testStreet, user: created };
}

async function teardown(setup: Awaited<ReturnType<typeof setupInhabitant>>) {
  await db.delete(user).where(eq(user.id, setup.user.id));
  await db.delete(house).where(eq(house.id, setup.user.houseId));
  await cleanupTestStreet(setup.testStreet);
}

Deno.test("registerPushToken : enregistre le jeton, remplacé par un appel suivant", async () => {
  const setup = await setupInhabitant("push-1");
  try {
    await registerPushToken(setup.user.id, "ExponentPushToken[aaa]");
    let [row] = await db.select().from(user).where(
      eq(user.id, setup.user.id),
    );
    assertEquals(row.pushToken, "ExponentPushToken[aaa]");

    await registerPushToken(setup.user.id, "ExponentPushToken[bbb]");
    [row] = await db.select().from(user).where(eq(user.id, setup.user.id));
    assertEquals(row.pushToken, "ExponentPushToken[bbb]");
  } finally {
    await teardown(setup);
  }
});

Deno.test("clearPushToken : retire le jeton", async () => {
  const setup = await setupInhabitant("push-2");
  try {
    await registerPushToken(setup.user.id, "ExponentPushToken[aaa]");
    await clearPushToken(setup.user.id);
    const [row] = await db.select().from(user).where(
      eq(user.id, setup.user.id),
    );
    assertEquals(row.pushToken, null);
  } finally {
    await teardown(setup);
  }
});

Deno.test("findPushRecipients : liste vide → tableau vide, sans requête", async () => {
  assertEquals(await findPushRecipients([]), []);
});

Deno.test("findPushRecipients : ne retient que les jetons enregistrés et pas en pause", async () => {
  const withToken = await setupInhabitant("push-3a");
  const noToken = await setupInhabitant("push-3b");
  const paused = await setupInhabitant("push-3c");

  try {
    await registerPushToken(withToken.user.id, "ExponentPushToken[aaa]");
    await registerPushToken(paused.user.id, "ExponentPushToken[ccc]");
    await db.update(user).set({ pushNotificationsPaused: true }).where(
      eq(user.id, paused.user.id),
    );

    const recipients = await findPushRecipients([
      withToken.user.id,
      noToken.user.id,
      paused.user.id,
    ]);
    assertEquals(recipients, [
      { userId: withToken.user.id, token: "ExponentPushToken[aaa]" },
    ]);
  } finally {
    await teardown(withToken);
    await teardown(noToken);
    await teardown(paused);
  }
});
