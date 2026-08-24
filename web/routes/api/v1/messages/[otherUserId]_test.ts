import { assertEquals, assertExists } from "@std/assert";
import { eq } from "drizzle-orm";
import type { Context } from "fresh";
import type { SessionUser, State } from "../../../../utils.ts";
import { db } from "../../../../db/client.ts";
import { house, message, post, user } from "../../../../db/schema.ts";
import { STREET_AWAKENING_THRESHOLD } from "../../../../db/streets.ts";
import { registerInhabitant } from "../../../../db/users.ts";
import { deleteUserAccount } from "../../../../db/account.ts";
import { createPost } from "../../../../db/posts.ts";
import { sendMessage } from "../../../../db/messages.ts";
import {
  cleanupTestStreet,
  createTestStreet,
} from "../../../../db/test_helpers.ts";
import { handler } from "./[otherUserId].ts";

function makeContext(
  otherUserId: number | string,
  options: {
    user?: SessionUser | null;
    search?: Record<string, string>;
    content?: string;
    postId?: number;
  } = {},
): Context<State> {
  const url = new URL(
    `http://localhost/api/v1/messages/${otherUserId}`,
  );
  for (const [key, value] of Object.entries(options.search ?? {})) {
    url.searchParams.set(key, value);
  }
  return {
    url,
    params: { otherUserId: String(otherUserId) },
    state: { user: options.user ?? null },
    req: {
      json: () =>
        options.content === undefined
          ? Promise.reject(new SyntaxError("corps invalide"))
          : Promise.resolve({
            content: options.content,
            postId: options.postId,
          }),
    },
  } as unknown as Context<State>;
}

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
    email: `api-msg-a-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const { user: bob } = await registerInhabitant({
    login: `bob-${crypto.randomUUID()}`,
    email: `api-msg-b-${crypto.randomUUID()}@example.invalid`,
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
  await db.delete(post).where(eq(post.userId, setup.alice.id));
  await db.delete(post).where(eq(post.userId, setup.bob.id));
  await db.delete(user).where(eq(user.id, setup.alice.id));
  await db.delete(user).where(eq(user.id, setup.bob.id));
  await db.delete(house).where(
    eq(house.streetId, setup.testStreet.testStreet.id),
  );
  await cleanupTestStreet(setup.testStreet);
}

Deno.test("GET /api/v1/messages/:otherUserId : non connecté → 401", async () => {
  const res = await handler.GET!(makeContext(1)) as Response;
  assertEquals(res.status, 401);
});

Deno.test("GET /api/v1/messages/:otherUserId : id invalide ou soi-même → 400", async () => {
  const setup = await createAwakeStreetWithTwoUsers("api-msg-thread-1");
  try {
    const invalid = await handler.GET!(
      makeContext("nawak", { user: setup.aliceSession }),
    ) as Response;
    assertEquals(invalid.status, 400);

    const self = await handler.GET!(
      makeContext(setup.alice.id, { user: setup.aliceSession }),
    ) as Response;
    assertEquals(self.status, 400);
  } finally {
    await cleanupAwakeStreet(setup);
  }
});

Deno.test("GET /api/v1/messages/:otherUserId : interlocuteur d'une autre rue → 404", async () => {
  const setup = await createAwakeStreetWithTwoUsers("api-msg-thread-2");
  const otherStreet = await createTestStreet("api-msg-thread-2b");
  const { user: stranger } = await registerInhabitant({
    login: `stranger-${crypto.randomUUID()}`,
    email: `api-msg-stranger-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: otherStreet.testStreet.id,
  });

  try {
    const res = await handler.GET!(
      makeContext(stranger.id, { user: setup.aliceSession }),
    ) as Response;
    assertEquals(res.status, 404);
  } finally {
    await db.delete(user).where(eq(user.id, stranger.id));
    await db.delete(house).where(eq(house.id, stranger.houseId));
    await cleanupTestStreet(otherStreet);
    await cleanupAwakeStreet(setup);
  }
});

Deno.test("GET /api/v1/messages/:otherUserId : conversation vide puis remplie, marquée lue à l'ouverture", async () => {
  const setup = await createAwakeStreetWithTwoUsers("api-msg-thread-3");

  try {
    const empty = await handler.GET!(
      makeContext(setup.bob.id, { user: setup.aliceSession }),
    ) as Response;
    const emptyBody = await empty.json();
    assertEquals(emptyBody.messages, []);
    assertEquals(emptyBody.otherUserLogin, setup.bob.login);
    assertEquals(emptyBody.otherUserDeleted, false);

    await sendMessage({
      fromUserId: setup.bob.id,
      toUserId: setup.alice.id,
      content: "Salut !",
    });

    const res = await handler.GET!(
      makeContext(setup.bob.id, { user: setup.aliceSession }),
    ) as Response;
    const body = await res.json();
    assertEquals(body.messages.length, 1);
    assertEquals(body.messages[0].content, "Salut !");
    assertEquals(body.messages[0].fromViewer, false);

    const [row] = await db.select().from(message).where(
      eq(message.userFromId, setup.bob.id),
    );
    assertExists(row.readAt);
  } finally {
    await cleanupAwakeStreet(setup);
  }
});

Deno.test("GET /api/v1/messages/:otherUserId : ?postId= résout le contexte de demande", async () => {
  const setup = await createAwakeStreetWithTwoUsers("api-msg-thread-4");

  try {
    const bobPost = await createPost({
      userId: setup.bob.id,
      type: "cherche",
      content: "Je cherche une échelle",
    });

    const res = await handler.GET!(
      makeContext(setup.bob.id, {
        user: setup.aliceSession,
        search: { postId: String(bobPost.id) },
      }),
    ) as Response;
    const body = await res.json();
    assertEquals(body.postContext.id, bobPost.id);
    assertEquals(body.postContext.content, "Je cherche une échelle");
  } finally {
    await cleanupAwakeStreet(setup);
  }
});

Deno.test("GET /api/v1/messages/:otherUserId : interlocuteur ayant supprimé son compte → toujours consultable, otherUserDeleted true", async () => {
  const setup = await createAwakeStreetWithTwoUsers("api-msg-thread-5");

  try {
    await sendMessage({
      fromUserId: setup.bob.id,
      toUserId: setup.alice.id,
      content: "Avant de partir...",
    });
    await deleteUserAccount(setup.bob.id);

    const res = await handler.GET!(
      makeContext(setup.bob.id, { user: setup.aliceSession }),
    ) as Response;
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.otherUserDeleted, true);
    assertEquals(body.messages.length, 1);
  } finally {
    await cleanupAwakeStreet(setup);
  }
});

Deno.test("POST /api/v1/messages/:otherUserId : non connecté → 401", async () => {
  const res = await handler.POST!(makeContext(1)) as Response;
  assertEquals(res.status, 401);
});

Deno.test("POST /api/v1/messages/:otherUserId : compte non vérifié → 403, rien envoyé", async () => {
  const setup = await createAwakeStreetWithTwoUsers("api-msg-post-1");
  const unverified = { ...setup.aliceSession, isVerified: false };

  try {
    const res = await handler.POST!(
      makeContext(setup.bob.id, { user: unverified, content: "Salut" }),
    ) as Response;
    assertEquals(res.status, 403);
    const rows = await db.select().from(message).where(
      eq(message.userFromId, setup.alice.id),
    );
    assertEquals(rows.length, 0);
  } finally {
    await cleanupAwakeStreet(setup);
  }
});

Deno.test("POST /api/v1/messages/:otherUserId : contenu vide → 400, rien envoyé", async () => {
  const setup = await createAwakeStreetWithTwoUsers("api-msg-post-2");
  try {
    const res = await handler.POST!(
      makeContext(setup.bob.id, { user: setup.aliceSession, content: "  " }),
    ) as Response;
    assertEquals(res.status, 400);
  } finally {
    await cleanupAwakeStreet(setup);
  }
});

Deno.test("POST /api/v1/messages/:otherUserId : message agressif → 422, rien envoyé", async () => {
  const setup = await createAwakeStreetWithTwoUsers("api-msg-post-3");
  try {
    const res = await handler.POST!(
      makeContext(setup.bob.id, {
        user: setup.aliceSession,
        content: "connard",
      }),
    ) as Response;
    assertEquals(res.status, 422);
    const rows = await db.select().from(message).where(
      eq(message.userFromId, setup.alice.id),
    );
    assertEquals(rows.length, 0);
  } finally {
    await cleanupAwakeStreet(setup);
  }
});

Deno.test("POST /api/v1/messages/:otherUserId : destinataire d'une autre rue → 404, rien envoyé", async () => {
  const setup = await createAwakeStreetWithTwoUsers("api-msg-post-4");
  const otherStreet = await createTestStreet("api-msg-post-4b");
  const { user: stranger } = await registerInhabitant({
    login: `stranger-${crypto.randomUUID()}`,
    email: `api-msg-stranger-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: otherStreet.testStreet.id,
  });

  try {
    const res = await handler.POST!(
      makeContext(stranger.id, { user: setup.aliceSession, content: "Salut" }),
    ) as Response;
    assertEquals(res.status, 404);
  } finally {
    await db.delete(user).where(eq(user.id, stranger.id));
    await db.delete(house).where(eq(house.id, stranger.houseId));
    await cleanupTestStreet(otherStreet);
    await cleanupAwakeStreet(setup);
  }
});

Deno.test("POST /api/v1/messages/:otherUserId : message valide → 201, enregistré, DTO renvoyé", async () => {
  const setup = await createAwakeStreetWithTwoUsers("api-msg-post-5");
  try {
    const res = await handler.POST!(
      makeContext(setup.bob.id, {
        user: setup.aliceSession,
        content: "Ça te dit un café ?",
      }),
    ) as Response;
    assertEquals(res.status, 201);
    const body = await res.json();
    assertEquals(body.message.content, "Ça te dit un café ?");
    assertEquals(body.message.fromViewer, true);
    assertEquals(body.postContext, null);

    const rows = await db.select().from(message).where(
      eq(message.userFromId, setup.alice.id),
    );
    assertEquals(rows.length, 1);
  } finally {
    await cleanupAwakeStreet(setup);
  }
});

Deno.test("POST /api/v1/messages/:otherUserId : deux envois rapprochés → le second est bloqué (429)", async () => {
  const setup = await createAwakeStreetWithTwoUsers("api-msg-post-6");
  try {
    const first = await handler.POST!(
      makeContext(setup.bob.id, { user: setup.aliceSession, content: "Un" }),
    ) as Response;
    assertEquals(first.status, 201);

    const second = await handler.POST!(
      makeContext(setup.bob.id, { user: setup.aliceSession, content: "Deux" }),
    ) as Response;
    assertEquals(second.status, 429);

    const rows = await db.select().from(message).where(
      eq(message.userFromId, setup.alice.id),
    );
    assertEquals(rows.length, 1);
  } finally {
    await cleanupAwakeStreet(setup);
  }
});

Deno.test("POST /api/v1/messages/:otherUserId : avec postId valide → contexte attaché au message", async () => {
  const setup = await createAwakeStreetWithTwoUsers("api-msg-post-7");
  try {
    const bobPost = await createPost({
      userId: setup.bob.id,
      type: "propose",
      content: "Je prête ma perceuse",
    });

    const res = await handler.POST!(
      makeContext(setup.bob.id, {
        user: setup.aliceSession,
        content: "Je suis intéressée !",
        postId: bobPost.id,
      }),
    ) as Response;
    const body = await res.json();
    assertEquals(body.postContext.id, bobPost.id);

    const [row] = await db.select().from(message).where(
      eq(message.userFromId, setup.alice.id),
    );
    assertEquals(row.postId, bobPost.id);
  } finally {
    await cleanupAwakeStreet(setup);
  }
});
