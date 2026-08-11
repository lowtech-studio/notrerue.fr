import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import type { Context } from "fresh";
import type { SessionUser, State } from "../utils.ts";
import { db } from "../db/client.ts";
import { house, post, tap, user } from "../db/schema.ts";
import { createPost } from "../db/posts.ts";
import { findTappedPostIds } from "../db/taps.ts";
import { registerInhabitant } from "../db/users.ts";
import { cleanupTestStreet, createTestStreet } from "../db/test_helpers.ts";
import { handler } from "./taps.ts";

function makeContext(
  options: { user?: SessionUser | null; form?: FormData } = {},
): Context<State> {
  return {
    url: new URL("http://localhost/taps"),
    state: { user: options.user ?? null },
    redirect: (location: string) =>
      new Response(null, { status: 302, headers: { location } }),
    req: { formData: () => Promise.resolve(options.form ?? new FormData()) },
  } as unknown as Context<State>;
}

async function setupPost(label: string) {
  const testStreet = await createTestStreet(label);
  const { user: author } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `taps-${crypto.randomUUID()}@example.invalid`,
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
    email: `taps-viewer-${crypto.randomUUID()}@example.invalid`,
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

Deno.test("POST /taps : non connecté → redirigé vers /connexion", async () => {
  const response = await handler.POST!(makeContext()) as Response;
  assertEquals(response.status, 302);
  assertEquals(response.headers.get("location"), "/connexion");
});

Deno.test("POST /taps : bascule le tap et revient au fil, filtre et page préservés", async () => {
  const setup = await setupPost("taps-route-1");

  try {
    const form = new FormData();
    form.set("postId", String(setup.post.id));
    form.set("type", "cherche");
    form.set("page", "2");

    const response = await handler.POST!(
      makeContext({ user: setup.viewerSession, form }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(
      response.headers.get("location"),
      "/fil?type=cherche&page=2",
    );

    assertEquals(
      await findTappedPostIds(setup.viewer.id, [setup.post.id]),
      new Set([setup.post.id]),
    );
  } finally {
    await teardown(setup);
  }
});

Deno.test("POST /taps : demande d'une autre rue → ignoré, rien tapé", async () => {
  const setup = await setupPost("taps-route-2");
  const otherStreet = await createTestStreet("taps-route-2b");
  const { user: otherViewer } = await registerInhabitant({
    login: `login-other-${crypto.randomUUID()}`,
    email: `taps-other-${crypto.randomUUID()}@example.invalid`,
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
    const form = new FormData();
    form.set("postId", String(setup.post.id));

    const response = await handler.POST!(
      makeContext({ user: otherSession, form }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/fil");

    assertEquals(
      await findTappedPostIds(otherViewer.id, [setup.post.id]),
      new Set(),
    );
  } finally {
    await db.delete(user).where(eq(user.id, otherViewer.id));
    await db.delete(house).where(eq(house.id, otherViewer.houseId));
    await cleanupTestStreet(otherStreet);
    await teardown(setup);
  }
});

Deno.test("POST /taps : sur sa propre demande → ignoré, rien tapé (cf. revue : POST forgé sans passer par l'UI)", async () => {
  const setup = await setupPost("taps-route-4");

  try {
    const form = new FormData();
    form.set("postId", String(setup.post.id));

    const response = await handler.POST!(
      makeContext({ user: setup.authorSession, form }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/fil");

    assertEquals(
      await findTappedPostIds(setup.author.id, [setup.post.id]),
      new Set(),
    );
  } finally {
    await teardown(setup);
  }
});

Deno.test("POST /taps : postId absent/invalide → redirigé sans planter", async () => {
  const setup = await setupPost("taps-route-3");

  try {
    const form = new FormData();
    form.set("postId", "pas-un-nombre");

    const response = await handler.POST!(
      makeContext({ user: setup.viewerSession, form }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/fil");
  } finally {
    await teardown(setup);
  }
});

Deno.test("POST /taps : recherche active (?q=) préservée dans la redirection", async () => {
  const setup = await setupPost("taps-route-5");

  try {
    const form = new FormData();
    form.set("postId", String(setup.post.id));
    form.set("q", "perceuse");

    const response = await handler.POST!(
      makeContext({ user: setup.viewerSession, form }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(
      response.headers.get("location"),
      "/fil?q=perceuse",
    );
  } finally {
    await teardown(setup);
  }
});
