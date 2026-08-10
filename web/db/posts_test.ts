import { assert, assertEquals, assertFalse } from "@std/assert";
import { eq } from "drizzle-orm";
import { db } from "./client.ts";
import { house, post, user } from "./schema.ts";
import {
  createPost,
  isPostType,
  listStreetPosts,
  POSTS_PER_PAGE,
} from "./posts.ts";
import { registerInhabitant } from "./users.ts";
import { cleanupTestStreet, createTestStreet } from "./test_helpers.ts";

Deno.test("isPostType : accepte les trois valeurs de l'enum, rejette le reste", () => {
  assert(isPostType("cherche"));
  assert(isPostType("propose"));
  assert(isPostType("informe"));
  assertFalse(isPostType("autre chose"));
  assertFalse(isPostType(""));
});

Deno.test("createPost : enregistre le type et le contenu pour l'auteur donné", async () => {
  const testStreet = await createTestStreet("posts-1");
  const { user: author } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `posts-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });

  try {
    const created = await createPost({
      userId: author.id,
      type: "propose",
      content: "Je prête ma tondeuse ce week-end",
    });

    assertEquals(created.userId, author.id);
    assertEquals(created.type, "propose");
    assertEquals(created.content, "Je prête ma tondeuse ce week-end");
    assertEquals(created.deletedAt, null);

    const [reloaded] = await db.select().from(post).where(
      eq(post.id, created.id),
    );
    assertEquals(reloaded.content, "Je prête ma tondeuse ce week-end");
  } finally {
    await db.delete(post).where(eq(post.userId, author.id));
    await db.delete(user).where(eq(user.id, author.id));
    await db.delete(house).where(eq(house.id, author.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("listStreetPosts : chronologique (plus récent d'abord), isolé par rue", async () => {
  const streetA = await createTestStreet("posts-2a");
  const streetB = await createTestStreet("posts-2b");
  const { user: authorA } = await registerInhabitant({
    login: `login-a-${crypto.randomUUID()}`,
    email: `posts-a-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: streetA.testStreet.id,
  });
  const { user: authorB } = await registerInhabitant({
    login: `login-b-${crypto.randomUUID()}`,
    email: `posts-b-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: streetB.testStreet.id,
  });

  try {
    const first = await createPost({
      userId: authorA.id,
      type: "cherche",
      content: "Premier message (rue A)",
    });
    const second = await createPost({
      userId: authorA.id,
      type: "informe",
      content: "Second message (rue A)",
    });
    await createPost({
      userId: authorB.id,
      type: "cherche",
      content: "Message sur l'autre rue",
    });

    const result = await listStreetPosts({
      streetId: streetA.testStreet.id,
      page: 1,
    });

    assertEquals(result.totalCount, 2);
    assertEquals(result.posts.map((p) => p.id), [second.id, first.id]);
    assertEquals(result.posts[0].authorLogin, authorA.login);
  } finally {
    await db.delete(post).where(eq(post.userId, authorA.id));
    await db.delete(post).where(eq(post.userId, authorB.id));
    await db.delete(user).where(eq(user.id, authorA.id));
    await db.delete(user).where(eq(user.id, authorB.id));
    await db.delete(house).where(eq(house.id, authorA.houseId));
    await db.delete(house).where(eq(house.id, authorB.houseId));
    await cleanupTestStreet(streetA);
    await cleanupTestStreet(streetB);
  }
});

Deno.test("listStreetPosts : filtre par type", async () => {
  const testStreet = await createTestStreet("posts-3");
  const { user: author } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `posts-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });

  try {
    await createPost({
      userId: author.id,
      type: "cherche",
      content: "Je cherche une perceuse",
    });
    const proposed = await createPost({
      userId: author.id,
      type: "propose",
      content: "Je prête ma tondeuse",
    });

    const result = await listStreetPosts({
      streetId: testStreet.testStreet.id,
      type: "propose",
      page: 1,
    });

    assertEquals(result.totalCount, 1);
    assertEquals(result.posts.map((p) => p.id), [proposed.id]);
  } finally {
    await db.delete(post).where(eq(post.userId, author.id));
    await db.delete(user).where(eq(user.id, author.id));
    await db.delete(house).where(eq(house.id, author.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("listStreetPosts : pagine et ramène une page hors bornes dans les limites", async () => {
  const testStreet = await createTestStreet("posts-4");
  const { user: author } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `posts-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });

  try {
    const count = POSTS_PER_PAGE + 3;
    await db.insert(post).values(
      Array.from({ length: count }, (_, i) => ({
        userId: author.id,
        type: "informe" as const,
        content: `Message ${i}`,
      })),
    );

    const firstPage = await listStreetPosts({
      streetId: testStreet.testStreet.id,
      page: 1,
    });
    assertEquals(firstPage.totalCount, count);
    assertEquals(firstPage.totalPages, 2);
    assertEquals(firstPage.posts.length, POSTS_PER_PAGE);

    const secondPage = await listStreetPosts({
      streetId: testStreet.testStreet.id,
      page: 2,
    });
    assertEquals(secondPage.posts.length, 3);

    // Page demandée au-delà du nombre de pages → ramenée à la dernière.
    const outOfRange = await listStreetPosts({
      streetId: testStreet.testStreet.id,
      page: 99,
    });
    assertEquals(outOfRange.page, 2);
  } finally {
    await db.delete(post).where(eq(post.userId, author.id));
    await db.delete(user).where(eq(user.id, author.id));
    await db.delete(house).where(eq(house.id, author.houseId));
    await cleanupTestStreet(testStreet);
  }
});
