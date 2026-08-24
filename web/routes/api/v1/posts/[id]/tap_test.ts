import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import type { Context } from "fresh";
import type { SessionUser, State } from "../../../../../utils.ts";
import { db } from "../../../../../db/client.ts";
import { house, post, tap, user } from "../../../../../db/schema.ts";
import { createPost } from "../../../../../db/posts.ts";
import { findTappedPostIds } from "../../../../../db/taps.ts";
import { registerInhabitant } from "../../../../../db/users.ts";
import {
  cleanupTestStreet,
  createTestStreet,
} from "../../../../../db/test_helpers.ts";
import { handler } from "./tap.ts";

function makeContext(
  postId: number,
  sessionUser: SessionUser | null,
): Context<State> {
  return {
    url: new URL("http://localhost/api/v1/posts/" + postId + "/tap"),
    params: { id: String(postId) },
    state: { user: sessionUser },
  } as unknown as Context<State>;
}

async function setupPost(label: string) {
  const testStreet = await createTestStreet(label);
  const { user: author } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `api-tap-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const createdPost = await createPost({
    userId: author.id,
    type: "cherche",
    content: "Je cherche une perceuse",
  });
  const { user: viewer } = await registerInhabitant({
    login: `login-viewer-${crypto.randomUUID()}`,
    email: `api-tap-viewer-${crypto.randomUUID()}@example.invalid`,
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
  await db.delete(tap).where(eq(tap.postId, setup.post.id));
  await db.delete(post).where(eq(post.id, setup.post.id));
  await db.delete(user).where(eq(user.id, setup.author.id));
  await db.delete(user).where(eq(user.id, setup.viewer.id));
  await db.delete(house).where(eq(house.id, setup.author.houseId));
  await db.delete(house).where(eq(house.id, setup.viewer.houseId));
  await cleanupTestStreet(setup.testStreet);
}

Deno.test("POST /api/v1/posts/:id/tap : non connecté → 401", async () => {
  const res = await handler.POST!(makeContext(1, null)) as Response;
  assertEquals(res.status, 401);
});

Deno.test("POST /api/v1/posts/:id/tap : bascule le tap, renvoie l'état à jour", async () => {
  const setup = await setupPost("api-tap-1");

  try {
    const first = await handler.POST!(
      makeContext(setup.post.id, setup.viewerSession),
    ) as Response;
    assertEquals(first.status, 200);
    const firstBody = await first.json();
    assertEquals(firstBody.tapped, true);
    assertEquals(firstBody.tapCount, 1);
    assertEquals(
      await findTappedPostIds(setup.viewer.id, [setup.post.id]),
      new Set([setup.post.id]),
    );

    const second = await handler.POST!(
      makeContext(setup.post.id, setup.viewerSession),
    ) as Response;
    const secondBody = await second.json();
    assertEquals(secondBody.tapped, false);
    assertEquals(secondBody.tapCount, 0);
  } finally {
    await teardown(setup);
  }
});

Deno.test("POST /api/v1/posts/:id/tap : compte non vérifié → 403, rien tapé", async () => {
  const setup = await setupPost("api-tap-2");
  const unverified = { ...setup.viewerSession, isVerified: false };

  try {
    const res = await handler.POST!(
      makeContext(setup.post.id, unverified),
    ) as Response;
    assertEquals(res.status, 403);
    assertEquals(
      await findTappedPostIds(setup.viewer.id, [setup.post.id]),
      new Set(),
    );
  } finally {
    await teardown(setup);
  }
});

Deno.test("POST /api/v1/posts/:id/tap : sur sa propre demande → 403, rien tapé", async () => {
  const setup = await setupPost("api-tap-3");

  try {
    const res = await handler.POST!(
      makeContext(setup.post.id, setup.authorSession),
    ) as Response;
    assertEquals(res.status, 403);
  } finally {
    await teardown(setup);
  }
});

Deno.test("POST /api/v1/posts/:id/tap : demande d'une autre rue → 404, rien tapé", async () => {
  const setup = await setupPost("api-tap-4");
  const otherStreet = await createTestStreet("api-tap-4b");
  const { user: otherViewer } = await registerInhabitant({
    login: `login-other-${crypto.randomUUID()}`,
    email: `api-tap-other-${crypto.randomUUID()}@example.invalid`,
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
      makeContext(setup.post.id, otherSession),
    ) as Response;
    assertEquals(res.status, 404);
  } finally {
    await db.delete(user).where(eq(user.id, otherViewer.id));
    await db.delete(house).where(eq(house.id, otherViewer.houseId));
    await cleanupTestStreet(otherStreet);
    await teardown(setup);
  }
});
