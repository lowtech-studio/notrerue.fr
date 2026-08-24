import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import type { Context } from "fresh";
import type { SessionUser, State } from "../../../../../utils.ts";
import { db } from "../../../../../db/client.ts";
import { comment, house, post, user } from "../../../../../db/schema.ts";
import { createPost } from "../../../../../db/posts.ts";
import { listCommentsByPost } from "../../../../../db/comments.ts";
import { registerInhabitant } from "../../../../../db/users.ts";
import { STREET_AWAKENING_THRESHOLD } from "../../../../../db/streets.ts";
import {
  cleanupTestStreet,
  createTestStreet,
} from "../../../../../db/test_helpers.ts";
import { handler } from "./comments.ts";

function makeContext(
  postId: number,
  options: { user?: SessionUser | null; content?: string } = {},
): Context<State> {
  return {
    url: new URL(`http://localhost/api/v1/posts/${postId}/comments`),
    params: { id: String(postId) },
    state: { user: options.user ?? null },
    req: {
      json: () =>
        options.content === undefined
          ? Promise.reject(new SyntaxError("corps invalide"))
          : Promise.resolve({ content: options.content }),
    },
  } as unknown as Context<State>;
}

/** Rue amenée au seuil d'éveil (cf. routes/reponses.ts : répondre exige une rue allumée). */
async function setupPost(label: string) {
  const testStreet = await createTestStreet(label);
  if (STREET_AWAKENING_THRESHOLD > 1) {
    await db.insert(house).values(
      Array.from(
        { length: STREET_AWAKENING_THRESHOLD - 1 },
        () => ({ streetId: testStreet.testStreet.id }),
      ),
    );
  }

  const { user: author } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `api-comments-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const createdPost = await createPost({
    userId: author.id,
    type: "cherche",
    content: "Un plombier fiable ?",
  });
  const { user: viewer } = await registerInhabitant({
    login: `login-viewer-${crypto.randomUUID()}`,
    email: `api-comments-viewer-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const street = {
    id: testStreet.testStreet.id,
    name: testStreet.testStreet.name,
    city: { id: testStreet.testCity.id, name: testStreet.testCity.name },
  };
  const authorSession: SessionUser = {
    id: author.id,
    login: author.login,
    email: author.email,
    isAmbassador: author.isAmbassador,
    street,
  };
  const viewerSession: SessionUser = {
    id: viewer.id,
    login: viewer.login,
    email: viewer.email,
    isAmbassador: viewer.isAmbassador,
    street,
  };
  return {
    testStreet,
    author,
    authorSession,
    post: createdPost,
    viewer,
    viewerSession,
  };
}

async function teardown(setup: Awaited<ReturnType<typeof setupPost>>) {
  await db.delete(comment).where(eq(comment.postId, setup.post.id));
  await db.delete(post).where(eq(post.id, setup.post.id));
  await db.delete(user).where(eq(user.id, setup.author.id));
  await db.delete(user).where(eq(user.id, setup.viewer.id));
  await db.delete(house).where(
    eq(house.streetId, setup.testStreet.testStreet.id),
  );
  await cleanupTestStreet(setup.testStreet);
}

Deno.test("POST /api/v1/posts/:id/comments : non connecté → 401", async () => {
  const res = await handler.POST!(makeContext(1)) as Response;
  assertEquals(res.status, 401);
});

Deno.test("POST /api/v1/posts/:id/comments : réponse valide → enregistrée, DTO renvoyé", async () => {
  const setup = await setupPost("api-comments-1");

  try {
    const res = await handler.POST!(
      makeContext(setup.post.id, {
        user: setup.viewerSession,
        content: "J'ai un excellent plombier à vous recommander",
      }),
    ) as Response;
    assertEquals(res.status, 201);
    const body = await res.json();
    assertEquals(
      body.comment.content,
      "J'ai un excellent plombier à vous recommander",
    );
    assertEquals(body.comment.authorLogin, setup.viewer.login);

    const byPost = await listCommentsByPost([setup.post.id]);
    assertEquals(byPost.get(setup.post.id)?.length, 1);
  } finally {
    await teardown(setup);
  }
});

Deno.test("POST /api/v1/posts/:id/comments : compte non vérifié → 403, rien enregistré", async () => {
  const setup = await setupPost("api-comments-2");
  const unverified = { ...setup.viewerSession, isVerified: false };

  try {
    const res = await handler.POST!(
      makeContext(setup.post.id, { user: unverified, content: "Réponse" }),
    ) as Response;
    assertEquals(res.status, 403);
  } finally {
    await teardown(setup);
  }
});

Deno.test("POST /api/v1/posts/:id/comments : réponse agressive → 422, rien enregistré", async () => {
  const setup = await setupPost("api-comments-3");

  try {
    const res = await handler.POST!(
      makeContext(setup.post.id, {
        user: setup.viewerSession,
        content: "connard",
      }),
    ) as Response;
    assertEquals(res.status, 422);
    const byPost = await listCommentsByPost([setup.post.id]);
    assertEquals(byPost.get(setup.post.id), undefined);
  } finally {
    await teardown(setup);
  }
});

Deno.test("POST /api/v1/posts/:id/comments : contenu vide → 400, rien enregistré", async () => {
  const setup = await setupPost("api-comments-4");

  try {
    const res = await handler.POST!(
      makeContext(setup.post.id, { user: setup.viewerSession, content: "  " }),
    ) as Response;
    assertEquals(res.status, 400);
  } finally {
    await teardown(setup);
  }
});

Deno.test("POST /api/v1/posts/:id/comments : demande d'une autre rue → 404, rien enregistré", async () => {
  const setup = await setupPost("api-comments-5");
  const otherStreet = await createTestStreet("api-comments-5b");
  // La rue du commenteur doit elle-même être allumée pour atteindre le
  // contrôle de correspondance de rue (sinon c'est ce garde-fou-là,
  // antérieur, qui bloquerait — cf. la même précaution dans
  // routes/reponses_test.ts#awakenStreet).
  if (STREET_AWAKENING_THRESHOLD > 1) {
    await db.insert(house).values(
      Array.from(
        { length: STREET_AWAKENING_THRESHOLD - 1 },
        () => ({ streetId: otherStreet.testStreet.id }),
      ),
    );
  }
  const { user: otherViewer } = await registerInhabitant({
    login: `login-other-${crypto.randomUUID()}`,
    email: `api-comments-other-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: otherStreet.testStreet.id,
  });
  const otherSession: SessionUser = {
    id: otherViewer.id,
    login: otherViewer.login,
    email: otherViewer.email,
    isAmbassador: otherViewer.isAmbassador,
    street: {
      id: otherStreet.testStreet.id,
      name: otherStreet.testStreet.name,
      city: { id: otherStreet.testCity.id, name: otherStreet.testCity.name },
    },
  };

  try {
    const res = await handler.POST!(
      makeContext(setup.post.id, { user: otherSession, content: "Réponse" }),
    ) as Response;
    assertEquals(res.status, 404);
  } finally {
    await db.delete(user).where(eq(user.id, otherViewer.id));
    // `streetId` plutôt que le seul foyer de `otherViewer` : la mise à
    // l'éveil ci-dessus a inséré des foyers supplémentaires sans habitant.
    await db.delete(house).where(eq(house.streetId, otherStreet.testStreet.id));
    await cleanupTestStreet(otherStreet);
    await teardown(setup);
  }
});
