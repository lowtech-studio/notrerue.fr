import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import type { Context } from "fresh";
import type { SessionUser, State } from "../utils.ts";
import { db } from "../db/client.ts";
import { comment, house, post, user } from "../db/schema.ts";
import { listCommentsByPost } from "../db/comments.ts";
import { createPost, type PostType } from "../db/posts.ts";
import { registerInhabitant } from "../db/users.ts";
import { STREET_AWAKENING_THRESHOLD } from "../db/streets.ts";
import { cleanupTestStreet, createTestStreet } from "../db/test_helpers.ts";
import { handler } from "./reponses.ts";

function makeContext(
  options: { user?: SessionUser | null; form?: FormData } = {},
): Context<State> {
  return {
    url: new URL("http://localhost/reponses"),
    state: { user: options.user ?? null },
    redirect: (location: string) =>
      new Response(null, { status: 302, headers: { location } }),
    req: { formData: () => Promise.resolve(options.form ?? new FormData()) },
  } as unknown as Context<State>;
}

/** Amène une rue de test au seuil d'éveil. */
async function awakenStreet(streetId: number): Promise<void> {
  if (STREET_AWAKENING_THRESHOLD > 1) {
    await db.insert(house).values(
      Array.from(
        { length: STREET_AWAKENING_THRESHOLD - 1 },
        () => ({ streetId }),
      ),
    );
  }
}

/** Une demande + son auteur, sur une rue de test allumée. */
async function setupPost(label: string, type: PostType = "cherche") {
  const testStreet = await createTestStreet(label);
  await awakenStreet(testStreet.testStreet.id);
  const { user: author } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `reponses-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const createdPost = await createPost({
    userId: author.id,
    type,
    content: "Un plombier fiable ?",
  });
  const authorSession: SessionUser = {
    id: author.id,
    login: author.login,
    email: author.email,
    isAmbassador: author.isAmbassador,
    street: {
      id: testStreet.testStreet.id,
      name: testStreet.testStreet.name,
      city: { id: testStreet.testCity.id, name: testStreet.testCity.name },
    },
  };
  return { testStreet, author, authorSession, post: createdPost };
}

async function teardown(setup: Awaited<ReturnType<typeof setupPost>>) {
  await db.delete(comment).where(eq(comment.postId, setup.post.id));
  await db.delete(post).where(eq(post.id, setup.post.id));
  await db.delete(user).where(eq(user.id, setup.author.id));
  // Toutes les maisons de la rue, pas seulement celle de l'auteur : les
  // maisons vides ajoutées par `awakenStreet` bloqueraient sinon la
  // suppression de la rue (FK `house.street_id`).
  await db.delete(house).where(
    eq(house.streetId, setup.testStreet.testStreet.id),
  );
  await cleanupTestStreet(setup.testStreet);
}

Deno.test("POST /reponses : non connecté → redirigé vers /connexion", async () => {
  const response = await handler.POST!(makeContext()) as Response;
  assertEquals(response.status, 302);
  assertEquals(response.headers.get("location"), "/connexion");
});

Deno.test("POST /reponses : réponse valide d'un voisin de la même rue → enregistrée, filtre/page préservés", async () => {
  const setup = await setupPost("reponses-1");
  const { user: responder } = await registerInhabitant({
    login: `login-r-${crypto.randomUUID()}`,
    email: `reponses-r-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: setup.testStreet.testStreet.id,
  });
  const responderSession: SessionUser = {
    id: responder.id,
    login: responder.login,
    email: responder.email,
    isAmbassador: responder.isAmbassador,
    street: setup.authorSession.street,
  };

  try {
    const form = new FormData();
    form.set("postId", String(setup.post.id));
    form.set("content", "Dupont Plomberie, très bien");
    form.set("type", "cherche");
    form.set("page", "2");

    const response = await handler.POST!(
      makeContext({ user: responderSession, form }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(
      response.headers.get("location"),
      "/fil?type=cherche&page=2",
    );

    const commentsByPost = await listCommentsByPost([setup.post.id]);
    assertEquals(
      commentsByPost.get(setup.post.id)?.map((c) => c.content),
      ["Dupont Plomberie, très bien"],
    );
  } finally {
    // Le commentaire du répondeur avant son compte (FK
    // `comment_user_id_user_id_fk`) : `teardown(setup)` supprime déjà les
    // commentaires de la demande, mais avant de supprimer `responder` ici.
    await db.delete(comment).where(eq(comment.userId, responder.id));
    await db.delete(user).where(eq(user.id, responder.id));
    await db.delete(house).where(eq(house.id, responder.houseId));
    await teardown(setup);
  }
});

Deno.test("POST /reponses : demande d'une autre rue → ignoré, rien enregistré", async () => {
  const setup = await setupPost("reponses-2");
  const otherStreet = await createTestStreet("reponses-2b");
  await awakenStreet(otherStreet.testStreet.id);
  const { user: otherStreetUser } = await registerInhabitant({
    login: `login-other-${crypto.randomUUID()}`,
    email: `reponses-other-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: otherStreet.testStreet.id,
  });
  const otherStreetSession: SessionUser = {
    id: otherStreetUser.id,
    login: otherStreetUser.login,
    email: otherStreetUser.email,
    isAmbassador: otherStreetUser.isAmbassador,
    street: {
      id: otherStreet.testStreet.id,
      name: otherStreet.testStreet.name,
      city: { id: otherStreet.testCity.id, name: otherStreet.testCity.name },
    },
  };

  try {
    const form = new FormData();
    form.set("postId", String(setup.post.id));
    form.set("content", "Une réponse qui ne devrait pas passer");

    const response = await handler.POST!(
      makeContext({ user: otherStreetSession, form }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/fil");

    const commentsByPost = await listCommentsByPost([setup.post.id]);
    assertEquals(commentsByPost.get(setup.post.id), undefined);
  } finally {
    await db.delete(user).where(eq(user.id, otherStreetUser.id));
    await db.delete(house).where(eq(house.streetId, otherStreet.testStreet.id));
    await cleanupTestStreet(otherStreet);
    await teardown(setup);
  }
});

Deno.test("POST /reponses : fonctionne pour les trois types de demande, pas seulement 'cherche'", async () => {
  const setup = await setupPost("reponses-2c", "propose");

  try {
    const form = new FormData();
    form.set("postId", String(setup.post.id));
    form.set("content", "Toujours dispo ?");

    const response = await handler.POST!(
      makeContext({ user: setup.authorSession, form }),
    ) as Response;
    assertEquals(response.status, 302);

    const commentsByPost = await listCommentsByPost([setup.post.id]);
    assertEquals(
      commentsByPost.get(setup.post.id)?.map((c) => c.content),
      ["Toujours dispo ?"],
    );
  } finally {
    await teardown(setup);
  }
});

Deno.test("POST /reponses : compte non vérifié → redirigé avec verif_error=1, rien enregistré (cf. db/vouches.ts)", async () => {
  const setup = await setupPost("reponses-2d");
  const unverifiedSession = { ...setup.authorSession, isVerified: false };

  try {
    const form = new FormData();
    form.set("postId", String(setup.post.id));
    form.set("content", "Une réponse qui ne devrait pas passer");

    const response = await handler.POST!(
      makeContext({ user: unverifiedSession, form }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/fil?verif_error=1");

    const commentsByPost = await listCommentsByPost([setup.post.id]);
    assertEquals(commentsByPost.get(setup.post.id), undefined);
  } finally {
    await teardown(setup);
  }
});

Deno.test("POST /reponses : rue de l'utilisateur endormie → redirigé vers /, rien enregistré", async () => {
  const setup = await setupPost("reponses-3b");
  const sleepingStreet = await createTestStreet("reponses-3b-sleeping");
  const { user: sleepingUser } = await registerInhabitant({
    login: `login-sleeping-${crypto.randomUUID()}`,
    email: `reponses-sleeping-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: sleepingStreet.testStreet.id,
  });
  const sleepingSession: SessionUser = {
    id: sleepingUser.id,
    login: sleepingUser.login,
    email: sleepingUser.email,
    isAmbassador: sleepingUser.isAmbassador,
    street: {
      id: sleepingStreet.testStreet.id,
      name: sleepingStreet.testStreet.name,
      city: {
        id: sleepingStreet.testCity.id,
        name: sleepingStreet.testCity.name,
      },
    },
  };

  try {
    const form = new FormData();
    form.set("postId", String(setup.post.id));
    form.set("content", "Une réponse depuis une rue endormie");

    const response = await handler.POST!(
      makeContext({ user: sleepingSession, form }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/");

    const commentsByPost = await listCommentsByPost([setup.post.id]);
    assertEquals(commentsByPost.get(setup.post.id), undefined);
  } finally {
    await db.delete(user).where(eq(user.id, sleepingUser.id));
    await db.delete(house).where(eq(house.id, sleepingUser.houseId));
    await cleanupTestStreet(sleepingStreet);
    await teardown(setup);
  }
});

Deno.test("POST /reponses : réponse agressive → bloquée, redirection signale l'erreur (reponse_error=1)", async () => {
  const setup = await setupPost("reponses-3c");

  try {
    const form = new FormData();
    form.set("postId", String(setup.post.id));
    form.set("content", "Bande de connard, dégagez de ma rue");
    form.set("page", "2");

    const response = await handler.POST!(
      makeContext({ user: setup.authorSession, form }),
    ) as Response;
    assertEquals(response.status, 302);
    // Sans ce signal, la réponse tapée disparaît sans aucune explication
    // (cf. revue) — lu par /fil pour afficher un message d'erreur.
    assertEquals(
      response.headers.get("location"),
      "/fil?page=2&reponse_error=1",
    );

    const commentsByPost = await listCommentsByPost([setup.post.id]);
    assertEquals(commentsByPost.get(setup.post.id), undefined);
  } finally {
    await teardown(setup);
  }
});

Deno.test("POST /reponses : contenu vide ou postId invalide → ignoré sans planter", async () => {
  const setup = await setupPost("reponses-4");

  try {
    const form = new FormData();
    form.set("postId", "pas-un-nombre");
    form.set("content", "Peu importe");

    const response = await handler.POST!(
      makeContext({ user: setup.authorSession, form }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/fil");

    const commentsByPost = await listCommentsByPost([setup.post.id]);
    assertEquals(commentsByPost.get(setup.post.id), undefined);
  } finally {
    await teardown(setup);
  }
});

Deno.test("POST /reponses : recherche active (?q=) préservée dans la redirection", async () => {
  const setup = await setupPost("reponses-5");

  try {
    const form = new FormData();
    form.set("postId", String(setup.post.id));
    form.set("content", "Dupont Plomberie");
    form.set("q", "plombier");

    const response = await handler.POST!(
      makeContext({ user: setup.authorSession, form }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(
      response.headers.get("location"),
      "/fil?q=plombier",
    );
  } finally {
    await teardown(setup);
  }
});
