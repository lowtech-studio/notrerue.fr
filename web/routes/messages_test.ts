import {
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from "@std/assert";
import { and, eq } from "drizzle-orm";
import type { Context } from "fresh";
import type { SessionUser, State } from "../utils.ts";
import { db } from "../db/client.ts";
import { house, message, post, user } from "../db/schema.ts";
import { STREET_AWAKENING_THRESHOLD } from "../db/streets.ts";
import { registerInhabitant } from "../db/users.ts";
import { deleteUserAccount } from "../db/account.ts";
import { createPost } from "../db/posts.ts";
import { cleanupTestStreet, createTestStreet } from "../db/test_helpers.ts";
import { handler } from "./messages.tsx";

function makeContext(
  url: string,
  options: { user?: SessionUser | null; form?: FormData } = {},
): Context<State> {
  return {
    url: new URL(url),
    state: { user: options.user ?? null },
    redirect: (location: string) =>
      new Response(null, { status: 302, headers: { location } }),
    req: { formData: () => Promise.resolve(options.form ?? new FormData()) },
  } as unknown as Context<State>;
}

/** Rue allumée avec deux habitants connectés (Alice et Bob), pour tester une conversation entre eux. */
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

Deno.test("GET /messages : non connecté → redirigé vers /connexion", async () => {
  const response = await handler.GET!(
    makeContext("http://localhost/messages"),
  ) as Response;
  assertEquals(response.status, 302);
  assertEquals(response.headers.get("location"), "/connexion");
});

Deno.test("POST /messages : non connecté → redirigé vers /connexion", async () => {
  const response = await handler.POST!(
    makeContext("http://localhost/messages"),
  ) as Response;
  assertEquals(response.status, 302);
  assertEquals(response.headers.get("location"), "/connexion");
});

Deno.test("GET /messages : rue pas encore allumée → redirigé vers /", async () => {
  const testStreet = await createTestStreet("messages-1");
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `messages-${crypto.randomUUID()}@example.invalid`,
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
    const response = await handler.GET!(
      makeContext("http://localhost/messages", { user: sessionUser }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/");
  } finally {
    await db.delete(user).where(eq(user.id, created.id));
    await db.delete(house).where(eq(house.id, created.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("GET /messages : sans ?with → boîte de réception, vide au départ", async () => {
  const setup = await createAwakeStreetWithTwoUsers("messages-2");

  try {
    const result = await handler.GET!(
      makeContext("http://localhost/messages", { user: setup.aliceSession }),
    ) as { data: { view: string; conversations: unknown[] } };

    assertEquals(result.data.view, "inbox");
    assertEquals(result.data.conversations, []);
  } finally {
    await cleanupAwakeStreet(setup);
  }
});

Deno.test("POST puis GET /messages : message envoyé → conversation visible des deux côtés", async () => {
  const setup = await createAwakeStreetWithTwoUsers("messages-3");

  try {
    const form = new FormData();
    form.set("to", String(setup.bob.id));
    form.set("content", "Bonjour Bob, votre perceuse est-elle libre ?");

    const response = await handler.POST!(
      makeContext("http://localhost/messages", {
        user: setup.aliceSession,
        form,
      }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(
      response.headers.get("location"),
      `/messages?with=${setup.bob.id}`,
    );

    const asAlice = await handler.GET!(
      makeContext(`http://localhost/messages?with=${setup.bob.id}`, {
        user: setup.aliceSession,
      }),
    ) as {
      data: {
        view: string;
        otherUserLogin: string;
        messages: { content: string; fromViewer: boolean }[];
      };
    };
    assertEquals(asAlice.data.view, "thread");
    assertEquals(asAlice.data.otherUserLogin, setup.bob.login);
    assertEquals(asAlice.data.messages.length, 1);
    assertEquals(asAlice.data.messages[0].fromViewer, true);

    const inboxAsBob = await handler.GET!(
      makeContext("http://localhost/messages", { user: setup.bobSession }),
    ) as {
      data: {
        conversations: {
          otherUserId: number;
          lastMessage: string;
          lastMessageFromViewer: boolean;
        }[];
      };
    };
    assertEquals(inboxAsBob.data.conversations.length, 1);
    assertEquals(inboxAsBob.data.conversations[0].otherUserId, setup.alice.id);
    assertEquals(
      inboxAsBob.data.conversations[0].lastMessage,
      "Bonjour Bob, votre perceuse est-elle libre ?",
    );
    assertEquals(inboxAsBob.data.conversations[0].lastMessageFromViewer, false);
  } finally {
    await cleanupAwakeStreet(setup);
  }
});

Deno.test("POST /messages : contenu vide → erreur, rien en base", async () => {
  const setup = await createAwakeStreetWithTwoUsers("messages-4");

  try {
    const form = new FormData();
    form.set("to", String(setup.bob.id));
    form.set("content", "   ");

    const result = await handler.POST!(
      makeContext("http://localhost/messages", {
        user: setup.aliceSession,
        form,
      }),
    ) as { data: { composeError: string | null } };

    assertEquals(
      result.data.composeError,
      "Écrivez votre message avant de l'envoyer.",
    );

    const rows = await db.select().from(message).where(
      eq(message.userFromId, setup.alice.id),
    );
    assertEquals(rows.length, 0);
  } finally {
    await cleanupAwakeStreet(setup);
  }
});

Deno.test("POST /messages : message agressif → bloqué, rien en base", async () => {
  const setup = await createAwakeStreetWithTwoUsers("messages-5");

  try {
    const form = new FormData();
    form.set("to", String(setup.bob.id));
    form.set("content", "Bande de connard, dégagez de ma rue");

    const result = await handler.POST!(
      makeContext("http://localhost/messages", {
        user: setup.aliceSession,
        form,
      }),
    ) as { data: { composeError: string | null; composeContent: string } };

    assertStringIncludes(result.data.composeError ?? "", "reformuler");
    assertEquals(
      result.data.composeContent,
      "Bande de connard, dégagez de ma rue",
    );

    const rows = await db.select().from(message).where(
      eq(message.userFromId, setup.alice.id),
    );
    assertEquals(rows.length, 0);
  } finally {
    await cleanupAwakeStreet(setup);
  }
});

Deno.test("POST /messages : destinataire d'une autre rue → ignoré, rien envoyé", async () => {
  const setup = await createAwakeStreetWithTwoUsers("messages-6");
  const otherStreet = await createTestStreet("messages-6b");
  const { user: stranger } = await registerInhabitant({
    login: `stranger-${crypto.randomUUID()}`,
    email: `messages-stranger-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: otherStreet.testStreet.id,
  });

  try {
    const form = new FormData();
    form.set("to", String(stranger.id));
    form.set("content", "Bonjour !");

    const response = await handler.POST!(
      makeContext("http://localhost/messages", {
        user: setup.aliceSession,
        form,
      }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/messages");

    const rows = await db.select().from(message).where(
      eq(message.userFromId, setup.alice.id),
    );
    assertEquals(rows.length, 0);
  } finally {
    await db.delete(user).where(eq(user.id, stranger.id));
    await db.delete(house).where(eq(house.id, stranger.houseId));
    await cleanupTestStreet(otherStreet);
    await cleanupAwakeStreet(setup);
  }
});

Deno.test("POST /messages : à soi-même → ignoré, redirigé", async () => {
  const setup = await createAwakeStreetWithTwoUsers("messages-7");

  try {
    const form = new FormData();
    form.set("to", String(setup.alice.id));
    form.set("content", "Bonjour moi-même");

    const response = await handler.POST!(
      makeContext("http://localhost/messages", {
        user: setup.aliceSession,
        form,
      }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/messages");
  } finally {
    await cleanupAwakeStreet(setup);
  }
});

Deno.test("GET /messages?with=<autre rue> : ignoré, redirigé vers l'inbox", async () => {
  const setup = await createAwakeStreetWithTwoUsers("messages-8");
  const otherStreet = await createTestStreet("messages-8b");
  const { user: stranger } = await registerInhabitant({
    login: `stranger-${crypto.randomUUID()}`,
    email: `messages-stranger2-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: otherStreet.testStreet.id,
  });

  try {
    const response = await handler.GET!(
      makeContext(`http://localhost/messages?with=${stranger.id}`, {
        user: setup.aliceSession,
      }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/messages");
  } finally {
    await db.delete(user).where(eq(user.id, stranger.id));
    await db.delete(house).where(eq(house.id, stranger.houseId));
    await cleanupTestStreet(otherStreet);
    await cleanupAwakeStreet(setup);
  }
});

Deno.test("POST puis GET /messages : envoyé depuis une demande → contexte affiché, ignoré si usurpé", async () => {
  const setup = await createAwakeStreetWithTwoUsers("messages-9");

  try {
    const bobPost = await createPost({
      userId: setup.bob.id,
      type: "cherche",
      content: "Je cherche une perceuse",
    });

    const form = new FormData();
    form.set("to", String(setup.bob.id));
    form.set("postId", String(bobPost.id));
    form.set("content", "J'en ai une à vous prêter");
    const response = await handler.POST!(
      makeContext("http://localhost/messages", {
        user: setup.aliceSession,
        form,
      }),
    ) as Response;
    // Le postId validé est conservé dans la redirection, sinon le bandeau
    // « À propos de » disparaîtrait dès le premier message (cf. revue).
    assertEquals(
      response.headers.get("location"),
      `/messages?with=${setup.bob.id}&postId=${bobPost.id}`,
    );

    const [storedFirst] = await db.select().from(message).where(
      eq(message.userFromId, setup.alice.id),
    );
    assertEquals(storedFirst.postId, bobPost.id);

    const withContext = await handler.GET!(
      makeContext(
        `http://localhost/messages?with=${setup.bob.id}&postId=${bobPost.id}`,
        { user: setup.aliceSession },
      ),
    ) as { data: { postContext: { content: string } | null } };
    assertEquals(withContext.data.postContext?.content, bobPost.content);

    // postId d'une demande qui n'a pour auteur ni l'un ni l'autre des deux
    // participants de la conversation : contexte ignoré.
    const { user: carla } = await registerInhabitant({
      login: `carla-${crypto.randomUUID()}`,
      email: `messages-carla-${crypto.randomUUID()}@example.invalid`,
      houseNumber: null,
      streetId: setup.testStreet.testStreet.id,
    });
    const carlaPost = await createPost({
      userId: carla.id,
      type: "informe",
      content: "Info sans rapport",
    });
    const wrongContext = await handler.GET!(
      makeContext(
        `http://localhost/messages?with=${setup.bob.id}&postId=${carlaPost.id}`,
        { user: setup.aliceSession },
      ),
    ) as { data: { postContext: unknown } };
    assertEquals(wrongContext.data.postContext, null);

    // Même postId usurpé envoyé en POST : ignoré, jamais stocké tel quel
    // (cf. revue — pas de violation de FK ni de fuite d'une autre rue).
    const forgedForm = new FormData();
    forgedForm.set("to", String(setup.bob.id));
    forgedForm.set("postId", String(carlaPost.id));
    forgedForm.set("content", "Message avec un postId usurpé");
    const forgedResponse = await handler.POST!(
      makeContext("http://localhost/messages", {
        user: setup.aliceSession,
        form: forgedForm,
      }),
    ) as Response;
    assertEquals(
      forgedResponse.headers.get("location"),
      `/messages?with=${setup.bob.id}`,
    );
    const [storedForged] = await db.select().from(message).where(
      and(
        eq(message.userFromId, setup.alice.id),
        eq(message.content, "Message avec un postId usurpé"),
      ),
    );
    assertEquals(storedForged.postId, null);

    await db.delete(post).where(eq(post.userId, carla.id));
    await db.delete(user).where(eq(user.id, carla.id));
    await db.delete(house).where(eq(house.id, carla.houseId));
  } finally {
    await cleanupAwakeStreet(setup);
  }
});

Deno.test("GET /messages : auteur écrit à un voisin qui a tapé sa demande → contexte affiché aussi dans ce sens", async () => {
  const setup = await createAwakeStreetWithTwoUsers("messages-10");

  try {
    // Alice est l'auteure ; c'est Bob qui a tapé sur sa demande, et Alice
    // lui écrit depuis le lien affiché sur sa propre demande (cf. backlog
    // « message privé à un tapeur pour s'organiser »).
    const alicePost = await createPost({
      userId: setup.alice.id,
      type: "cherche",
      content: "Je cherche une perceuse",
    });

    const result = await handler.GET!(
      makeContext(
        `http://localhost/messages?with=${setup.bob.id}&postId=${alicePost.id}`,
        { user: setup.aliceSession },
      ),
    ) as { data: { postContext: { content: string } | null } };
    assertEquals(result.data.postContext?.content, alicePost.content);
  } finally {
    await cleanupAwakeStreet(setup);
  }
});

Deno.test("GET /messages?with=... : interlocuteur ayant depuis supprimé son compte → conversation toujours consultable, sous son pseudonyme anonymisé", async () => {
  const setup = await createAwakeStreetWithTwoUsers("messages-11");

  try {
    const sent = await handler.POST!(
      makeContext("http://localhost/messages", {
        user: setup.bobSession,
        form: (() => {
          const form = new FormData();
          form.set("to", String(setup.alice.id));
          form.set("content", "Bonjour Alice !");
          return form;
        })(),
      }),
    ) as Response;
    assertEquals(sent.status, 302);

    await deleteUserAccount(setup.bob.id);

    const result = await handler.GET!(
      makeContext(
        `http://localhost/messages?with=${setup.bob.id}`,
        { user: setup.aliceSession },
      ),
    ) as {
      data: {
        view: string;
        otherUserLogin?: string;
        otherUserDeleted?: boolean;
      };
    };
    assertEquals(result.data.view, "thread");
    assertNotEquals(result.data.otherUserLogin, setup.bob.login);
    // Le formulaire de composition doit être masqué : le POST est de toute
    // façon rejeté côté serveur, un message tapé ici serait perdu en
    // silence (cf. revue).
    assertEquals(result.data.otherUserDeleted, true);
  } finally {
    await cleanupAwakeStreet(setup);
  }
});
