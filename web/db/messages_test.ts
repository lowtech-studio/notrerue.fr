import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import { db } from "./client.ts";
import { house, message, user } from "./schema.ts";
import { getConversation, listConversations, sendMessage } from "./messages.ts";
import { registerInhabitant } from "./users.ts";
import { cleanupTestStreet, createTestStreet } from "./test_helpers.ts";

async function setupPair(label: string) {
  const testStreet = await createTestStreet(label);
  const { user: alice } = await registerInhabitant({
    login: `alice-${crypto.randomUUID()}`,
    email: `messages-a-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const { user: bob } = await registerInhabitant({
    login: `bob-${crypto.randomUUID()}`,
    email: `messages-b-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  return { testStreet, alice, bob };
}

async function teardown(
  setup: Awaited<ReturnType<typeof setupPair>>,
  extraUsers: { id: number; houseId: number }[] = [],
) {
  await db.delete(message).where(eq(message.userFromId, setup.alice.id));
  await db.delete(message).where(eq(message.userFromId, setup.bob.id));
  for (const extra of extraUsers) {
    await db.delete(message).where(eq(message.userFromId, extra.id));
  }
  await db.delete(user).where(eq(user.id, setup.alice.id));
  await db.delete(user).where(eq(user.id, setup.bob.id));
  for (const extra of extraUsers) {
    await db.delete(user).where(eq(user.id, extra.id));
  }
  await db.delete(house).where(eq(house.id, setup.alice.houseId));
  await db.delete(house).where(eq(house.id, setup.bob.houseId));
  for (const extra of extraUsers) {
    await db.delete(house).where(eq(house.id, extra.houseId));
  }
  await cleanupTestStreet(setup.testStreet);
}

Deno.test("sendMessage : enregistre l'expéditeur, le destinataire et le contenu", async () => {
  const setup = await setupPair("messages-1");

  try {
    const sent = await sendMessage({
      fromUserId: setup.alice.id,
      toUserId: setup.bob.id,
      content: "Bonjour, votre perceuse est-elle disponible ?",
    });

    assertEquals(sent.userFromId, setup.alice.id);
    assertEquals(sent.userToId, setup.bob.id);
    assertEquals(sent.postId, null);
    assertEquals(sent.content, "Bonjour, votre perceuse est-elle disponible ?");
  } finally {
    await teardown(setup);
  }
});

Deno.test("getConversation : les deux sens, ordre chronologique, isolé des autres conversations", async () => {
  const setup = await setupPair("messages-2");
  const { user: carla } = await registerInhabitant({
    login: `carla-${crypto.randomUUID()}`,
    email: `messages-c-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: setup.testStreet.testStreet.id,
  });

  try {
    const first = await sendMessage({
      fromUserId: setup.alice.id,
      toUserId: setup.bob.id,
      content: "Salut Bob",
    });
    const second = await sendMessage({
      fromUserId: setup.bob.id,
      toUserId: setup.alice.id,
      content: "Salut Alice",
    });
    // Conversation avec un tiers : ne doit pas apparaître.
    await sendMessage({
      fromUserId: carla.id,
      toUserId: setup.alice.id,
      content: "Message d'une autre conversation",
    });

    const conversation = await getConversation(setup.alice.id, setup.bob.id);

    assertEquals(conversation.map((m) => m.id), [first.id, second.id]);
    assertEquals(conversation[0].fromViewer, true);
    assertEquals(conversation[1].fromViewer, false);
  } finally {
    await teardown(setup, [carla]);
  }
});

Deno.test("listConversations : une ligne par interlocuteur, la plus récente d'abord", async () => {
  const setup = await setupPair("messages-3");
  const { user: carla } = await registerInhabitant({
    login: `carla-${crypto.randomUUID()}`,
    email: `messages-c2-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: setup.testStreet.testStreet.id,
  });

  try {
    await sendMessage({
      fromUserId: setup.alice.id,
      toUserId: setup.bob.id,
      content: "Premier message à Bob",
    });
    await sendMessage({
      fromUserId: setup.alice.id,
      toUserId: carla.id,
      content: "Message à Carla",
    });
    // Dernier échange avec Bob : sa conversation doit repasser en tête.
    const lastWithBob = await sendMessage({
      fromUserId: setup.bob.id,
      toUserId: setup.alice.id,
      content: "Oui, toujours dispo",
    });

    const conversations = await listConversations(setup.alice.id);

    assertEquals(conversations.map((c) => c.otherUserId), [
      setup.bob.id,
      carla.id,
    ]);
    assertEquals(conversations[0].otherUserLogin, setup.bob.login);
    assertEquals(conversations[0].lastMessage, lastWithBob.content);
    assertEquals(conversations[0].lastMessageFromViewer, false);
    assertEquals(conversations[1].lastMessageFromViewer, true);
  } finally {
    await teardown(setup, [carla]);
  }
});

Deno.test("listConversations : aucun message → liste vide", async () => {
  const setup = await setupPair("messages-4");

  try {
    assertEquals(await listConversations(setup.alice.id), []);
  } finally {
    await teardown(setup);
  }
});
