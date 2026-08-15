import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import { db } from "./client.ts";
import { house, post, postImage, user } from "./schema.ts";
import { createPost, listStreetPosts, softDeletePost } from "./posts.ts";
import { findViewablePostImage } from "./post_images.ts";
import { registerInhabitant } from "./users.ts";
import { cleanupTestStreet, createTestStreet } from "./test_helpers.ts";

const SAMPLE_IMAGE = { data: new Uint8Array([1, 2, 3]), width: 10, height: 5 };

async function setupAuthor(label: string) {
  const testStreet = await createTestStreet(label);
  const { user: author } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `post-image-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  return { testStreet, author };
}

async function teardown(
  { testStreet, author }: Awaited<ReturnType<typeof setupAuthor>>,
) {
  await db.delete(post).where(eq(post.userId, author.id));
  await db.delete(user).where(eq(user.id, author.id));
  await db.delete(house).where(eq(house.streetId, testStreet.testStreet.id));
  await cleanupTestStreet(testStreet);
}

Deno.test("createPost avec image : crée la demande et sa photo dans la même transaction", async () => {
  const setup = await setupAuthor("post-image-1");
  try {
    const created = await createPost({
      userId: setup.author.id,
      type: "cherche",
      content: "Je cherche une perceuse",
      image: { streetId: setup.testStreet.testStreet.id, ...SAMPLE_IMAGE },
    });

    const [row] = await db.select().from(postImage).where(
      eq(postImage.postId, created.id),
    );
    assertEquals(row.width, SAMPLE_IMAGE.width);
    assertEquals(row.height, SAMPLE_IMAGE.height);
    assertEquals([...row.data], [...SAMPLE_IMAGE.data]);

    const { posts } = await listStreetPosts({
      streetId: setup.testStreet.testStreet.id,
      page: 1,
    });
    assertEquals(posts[0].image, {
      id: row.id,
      width: SAMPLE_IMAGE.width,
      height: SAMPLE_IMAGE.height,
    });
  } finally {
    await teardown(setup);
  }
});

Deno.test("createPost sans image : aucune ligne post_image, image absente du listing", async () => {
  const setup = await setupAuthor("post-image-2");
  try {
    await createPost({
      userId: setup.author.id,
      type: "propose",
      content: "Je prête ma tondeuse",
    });

    const { posts } = await listStreetPosts({
      streetId: setup.testStreet.testStreet.id,
      page: 1,
    });
    assertEquals(posts[0].image, null);
  } finally {
    await teardown(setup);
  }
});

Deno.test("findViewablePostImage : refusée pour une autre rue que celle de l'upload", async () => {
  const setup = await setupAuthor("post-image-3");
  const otherStreet = await createTestStreet("post-image-3-other");
  try {
    const created = await createPost({
      userId: setup.author.id,
      type: "cherche",
      content: "Je cherche un marteau",
      image: { streetId: setup.testStreet.testStreet.id, ...SAMPLE_IMAGE },
    });
    const [row] = await db.select().from(postImage).where(
      eq(postImage.postId, created.id),
    );

    const viewable = await findViewablePostImage(
      row.id,
      setup.testStreet.testStreet.id,
    );
    assertEquals(viewable?.width, SAMPLE_IMAGE.width);
    assertEquals(viewable?.height, SAMPLE_IMAGE.height);
    assertEquals(viewable && [...viewable.data], [...SAMPLE_IMAGE.data]);

    assertEquals(
      await findViewablePostImage(row.id, otherStreet.testStreet.id),
      null,
    );
    assertEquals(
      await findViewablePostImage(-1, setup.testStreet.testStreet.id),
      null,
    );
  } finally {
    await teardown(setup);
    await cleanupTestStreet(otherStreet);
  }
});

Deno.test("findViewablePostImage : refusée une fois la demande supprimée (soft delete)", async () => {
  const setup = await setupAuthor("post-image-4");
  try {
    const created = await createPost({
      userId: setup.author.id,
      type: "cherche",
      content: "Je cherche une échelle",
      image: { streetId: setup.testStreet.testStreet.id, ...SAMPLE_IMAGE },
    });
    const [row] = await db.select().from(postImage).where(
      eq(postImage.postId, created.id),
    );

    await softDeletePost(created.id, setup.author.id);

    assertEquals(
      await findViewablePostImage(row.id, setup.testStreet.testStreet.id),
      null,
    );
  } finally {
    await teardown(setup);
  }
});
