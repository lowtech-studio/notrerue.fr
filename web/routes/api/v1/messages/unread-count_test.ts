import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import type { Context } from "fresh";
import type { SessionUser, State } from "../../../../utils.ts";
import { db } from "../../../../db/client.ts";
import { house, message, user } from "../../../../db/schema.ts";
import { registerInhabitant } from "../../../../db/users.ts";
import { sendMessage } from "../../../../db/messages.ts";
import {
  cleanupTestStreet,
  createTestStreet,
} from "../../../../db/test_helpers.ts";
import { handler } from "./unread-count.ts";

function makeContext(sessionUser: SessionUser | null): Context<State> {
  return { state: { user: sessionUser } } as unknown as Context<State>;
}

Deno.test("GET /api/v1/messages/unread-count : non connecté → 401", async () => {
  const res = await handler.GET!(makeContext(null)) as Response;
  assertEquals(res.status, 401);
});

Deno.test("GET /api/v1/messages/unread-count : false au départ, true après réception d'un message", async () => {
  const testStreet = await createTestStreet("api-msg-unread-1");
  const { user: alice } = await registerInhabitant({
    login: `alice-${crypto.randomUUID()}`,
    email: `api-msg-unread-a-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const { user: bob } = await registerInhabitant({
    login: `bob-${crypto.randomUUID()}`,
    email: `api-msg-unread-b-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const aliceSession: SessionUser = {
    id: alice.id,
    login: alice.login,
    email: alice.email,
    isAmbassador: alice.isAmbassador,
    street: {
      id: testStreet.testStreet.id,
      name: testStreet.testStreet.name,
      city: { id: testStreet.testCity.id, name: testStreet.testCity.name },
    },
  };

  try {
    const before = await handler.GET!(
      makeContext(aliceSession),
    ) as Response;
    assertEquals((await before.json()).hasUnread, false);

    await sendMessage({
      fromUserId: bob.id,
      toUserId: alice.id,
      content: "Coucou",
    });

    const after = await handler.GET!(makeContext(aliceSession)) as Response;
    assertEquals((await after.json()).hasUnread, true);
  } finally {
    await db.delete(message).where(eq(message.userFromId, bob.id));
    await db.delete(user).where(eq(user.id, alice.id));
    await db.delete(user).where(eq(user.id, bob.id));
    await db.delete(house).where(
      eq(house.streetId, testStreet.testStreet.id),
    );
    await cleanupTestStreet(testStreet);
  }
});
