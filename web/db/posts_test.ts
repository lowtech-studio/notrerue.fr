import { assert, assertEquals, assertFalse } from "@std/assert";
import { eq } from "drizzle-orm";
import { db } from "./client.ts";
import { house, post, user } from "./schema.ts";
import { createPost, isPostType } from "./posts.ts";
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
