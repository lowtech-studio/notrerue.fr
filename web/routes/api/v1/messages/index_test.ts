import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import type { Context } from "fresh";
import type { SessionUser, State } from "../../../../utils.ts";
import { db } from "../../../../db/client.ts";
import { house, message, user } from "../../../../db/schema.ts";
import { STREET_AWAKENING_THRESHOLD } from "../../../../db/streets.ts";
import { registerInhabitant } from "../../../../db/users.ts";
import { sendMessage } from "../../../../db/messages.ts";
import {
  cleanupTestStreet,
  createTestStreet,
} from "../../../../db/test_helpers.ts";
import { handler } from "./index.ts";

function makeContext(sessionUser: SessionUser | null): Context<State> {
  return { state: { user: sessionUser } } as unknown as Context<State>;
}

/** Rue allumée avec deux habitants connectés (Alice et Bob). */
async function createAwakeStreetWithTwoUsers(label: string) {
  const testStreet = await createTestStreet(label);
  if (STREET_AWAKENING_THRESHOLD > 1) {
    await db.insert(house).values(
      Array.from(
        { length: STREET_AWAKENING_THRESHOLD - 1 },
        () => ({ streetId: testStreet.testStreet.id }),
      ),
    );
  }
  const { user: alice } = await registerInhabitant({
    login: `alice-${crypto.randomUUID()}`,
    email: `api-messages-a-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const { user: bob } = await registerInhabitant({
    login: `bob-${crypto.randomUUID()}`,
    email: `api-messages-b-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const street = {
    id: testStreet.testStreet.id,
    name: testStreet.testStreet.name,
    city: { id: testStreet.testCity.id, name: testStreet.testCity.name },
  };
  const aliceSession: SessionUser = {
    id: alice.id,
    login: alice.login,
    email: alice.email,
    isAmbassador: alice.isAmbassador,
    street,
  };
  const bobSession: SessionUser = {
    id: bob.id,
    login: bob.login,
    email: bob.email,
    isAmbassador: bob.isAmbassador,
    street,
  };
  return { testStreet, alice, bob, aliceSession, bobSession };
}

async function cleanupAwakeStreet(
  setup: Awaited<ReturnType<typeof createAwakeStreetWithTwoUsers>>,
) {
  await db.delete(message).where(eq(message.userFromId, setup.alice.id));
  await db.delete(message).where(eq(message.userFromId, setup.bob.id));
  await db.delete(user).where(eq(user.id, setup.alice.id));
  await db.delete(user).where(eq(user.id, setup.bob.id));
  await db.delete(house).where(
    eq(house.streetId, setup.testStreet.testStreet.id),
  );
  await cleanupTestStreet(setup.testStreet);
}

Deno.test("GET /api/v1/messages : non connecté → 401", async () => {
  const res = await handler.GET!(makeContext(null)) as Response;
  assertEquals(res.status, 401);
});

Deno.test("GET /api/v1/messages : rue pas encore allumée → isStreetAwake false, aucune conversation", async () => {
  const testStreet = await createTestStreet("api-messages-1");
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `api-messages-${crypto.randomUUID()}@example.invalid`,
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
    const res = await handler.GET!(makeContext(sessionUser)) as Response;
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.isStreetAwake, false);
    assertEquals(body.conversations, []);
  } finally {
    await db.delete(user).where(eq(user.id, created.id));
    await db.delete(house).where(eq(house.id, created.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("GET /api/v1/messages : vide au départ, puis une conversation après un message", async () => {
  const setup = await createAwakeStreetWithTwoUsers("api-messages-2");

  try {
    const empty = await handler.GET!(
      makeContext(setup.aliceSession),
    ) as Response;
    const emptyBody = await empty.json();
    assertEquals(emptyBody.conversations, []);

    await sendMessage({
      fromUserId: setup.alice.id,
      toUserId: setup.bob.id,
      content: "Salut voisin !",
    });

    const res = await handler.GET!(
      makeContext(setup.aliceSession),
    ) as Response;
    const body = await res.json();
    assertEquals(body.conversations.length, 1);
    assertEquals(body.conversations[0].otherUserId, setup.bob.id);
    assertEquals(body.conversations[0].lastMessage, "Salut voisin !");
    assertEquals(body.conversations[0].lastMessageFromViewer, true);

    // Visible aussi côté destinataire, avec `lastMessageFromViewer: false`.
    const bobRes = await handler.GET!(
      makeContext(setup.bobSession),
    ) as Response;
    const bobBody = await bobRes.json();
    assertEquals(bobBody.conversations[0].otherUserId, setup.alice.id);
    assertEquals(bobBody.conversations[0].lastMessageFromViewer, false);
  } finally {
    await cleanupAwakeStreet(setup);
  }
});
