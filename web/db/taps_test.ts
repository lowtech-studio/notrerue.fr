import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import { db } from "./client.ts";
import { house, post, tap, user } from "./schema.ts";
import { createPost } from "./posts.ts";
import {
  countTapsByPost,
  findTappedPostIds,
  getPostStreetId,
  listTappers,
  toggleTap,
} from "./taps.ts";
import { registerInhabitant } from "./users.ts";
import { cleanupTestStreet, createTestStreet } from "./test_helpers.ts";

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
  return { testStreet, author, post: createdPost };
}

/**
 * Nettoie une demande de test et ses taps. `viewers` : habitants
 * supplémentaires (au-delà de l'auteur) ayant tapé dessus — dans l'ordre de
 * dépendance : taps puis post d'abord (FK vers `user`), utilisateurs
 * ensuite, foyers, puis rue/ville.
 */
async function teardown(
  setup: Awaited<ReturnType<typeof setupPost>>,
  viewers: { id: number; houseId: number }[] = [],
) {
  await db.delete(tap).where(eq(tap.postId, setup.post.id));
  await db.delete(post).where(eq(post.id, setup.post.id));
  await db.delete(user).where(eq(user.id, setup.author.id));
  for (const viewer of viewers) {
    await db.delete(user).where(eq(user.id, viewer.id));
  }
  await db.delete(house).where(eq(house.id, setup.author.houseId));
  for (const viewer of viewers) {
    await db.delete(house).where(eq(house.id, viewer.houseId));
  }
  await cleanupTestStreet(setup.testStreet);
}

Deno.test("toggleTap : crée un tap actif, puis le retire au second appel", async () => {
  const setup = await setupPost("taps-1");
  const { user: viewer } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `taps-viewer-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: setup.testStreet.testStreet.id,
  });

  try {
    const firstToggle = await toggleTap(viewer.id, setup.post.id);
    assertEquals(firstToggle, true);
    assertEquals(
      await findTappedPostIds(viewer.id, [setup.post.id]),
      new Set([setup.post.id]),
    );

    const secondToggle = await toggleTap(viewer.id, setup.post.id);
    assertEquals(secondToggle, false);
    assertEquals(
      await findTappedPostIds(viewer.id, [setup.post.id]),
      new Set(),
    );
  } finally {
    await teardown(setup, [viewer]);
  }
});

Deno.test("countTapsByPost : compte uniquement les taps actifs, par demande", async () => {
  const setup = await setupPost("taps-2");
  const { user: viewerA } = await registerInhabitant({
    login: `login-a-${crypto.randomUUID()}`,
    email: `taps-a-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: setup.testStreet.testStreet.id,
  });
  const { user: viewerB } = await registerInhabitant({
    login: `login-b-${crypto.randomUUID()}`,
    email: `taps-b-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: setup.testStreet.testStreet.id,
  });

  try {
    await toggleTap(viewerA.id, setup.post.id);
    await toggleTap(viewerB.id, setup.post.id);
    // A se rétracte : ne doit plus compter.
    await toggleTap(viewerA.id, setup.post.id);

    const counts = await countTapsByPost([setup.post.id]);
    assertEquals(counts.get(setup.post.id), 1);
  } finally {
    await teardown(setup, [viewerA, viewerB]);
  }
});

Deno.test("listTappers : id + login des taps actifs, dans l'ordre, sans les rétractés", async () => {
  const setup = await setupPost("taps-4");
  const { user: viewerA } = await registerInhabitant({
    login: `alice-${crypto.randomUUID()}`,
    email: `taps-a-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: setup.testStreet.testStreet.id,
  });
  const { user: viewerB } = await registerInhabitant({
    login: `bob-${crypto.randomUUID()}`,
    email: `taps-b-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: setup.testStreet.testStreet.id,
  });
  const { user: viewerC } = await registerInhabitant({
    login: `carla-${crypto.randomUUID()}`,
    email: `taps-c-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: setup.testStreet.testStreet.id,
  });

  try {
    await toggleTap(viewerA.id, setup.post.id);
    await toggleTap(viewerB.id, setup.post.id);
    await toggleTap(viewerC.id, setup.post.id);
    // B se rétracte : ne doit plus apparaître.
    await toggleTap(viewerB.id, setup.post.id);

    const tappers = await listTappers([setup.post.id]);
    assertEquals(tappers.get(setup.post.id), [
      { id: viewerA.id, login: viewerA.login },
      { id: viewerC.id, login: viewerC.login },
    ]);
  } finally {
    await teardown(setup, [viewerA, viewerB, viewerC]);
  }
});

Deno.test("listTappers : liste de postId vide → carte vide", async () => {
  assertEquals(await listTappers([]), new Map());
});

Deno.test("getPostStreetId : retrouve la rue de l'auteur, null si le post n'existe pas", async () => {
  const setup = await setupPost("taps-3");

  try {
    assertEquals(
      await getPostStreetId(setup.post.id),
      setup.testStreet.testStreet.id,
    );
    assertEquals(await getPostStreetId(-1), null);
  } finally {
    await teardown(setup);
  }
});
