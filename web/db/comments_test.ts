import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import { db } from "./client.ts";
import { comment, house, post, user } from "./schema.ts";
import { createComment, listCommentsByPost } from "./comments.ts";
import { createPost } from "./posts.ts";
import { registerInhabitant } from "./users.ts";
import { cleanupTestStreet, createTestStreet } from "./test_helpers.ts";

async function setupPost(label: string) {
  const testStreet = await createTestStreet(label);
  const { user: author } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `comments-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const createdPost = await createPost({
    userId: author.id,
    type: "recommandation",
    content: "Un plombier fiable ?",
  });
  return { testStreet, author, post: createdPost };
}

/**
 * Nettoyage dans l'ordre des FK : `comment` (auteurs et répondeurs
 * confondus) puis `post`, puis chaque `user`/`house`, puis la rue et la
 * ville — sinon Postgres refuse (contrainte violée par une ligne encore
 * dépendante).
 */
async function teardown(
  setup: Awaited<ReturnType<typeof setupPost>>,
  responders: { id: number; houseId: number }[] = [],
) {
  await db.delete(comment).where(eq(comment.postId, setup.post.id));
  await db.delete(post).where(eq(post.id, setup.post.id));
  for (const responder of responders) {
    await db.delete(user).where(eq(user.id, responder.id));
    await db.delete(house).where(eq(house.id, responder.houseId));
  }
  await db.delete(user).where(eq(user.id, setup.author.id));
  await db.delete(house).where(eq(house.id, setup.author.houseId));
  await cleanupTestStreet(setup.testStreet);
}

Deno.test("createComment : enregistre l'auteur, la demande et le contenu", async () => {
  const setup = await setupPost("comments-1");
  const { user: responder } = await registerInhabitant({
    login: `login-r-${crypto.randomUUID()}`,
    email: `comments-r-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: setup.testStreet.testStreet.id,
  });

  try {
    const created = await createComment({
      userId: responder.id,
      postId: setup.post.id,
      content: "Dupont Plomberie, très bien, il y a de la place",
    });

    assertEquals(created.userId, responder.id);
    assertEquals(created.postId, setup.post.id);
    assertEquals(
      created.content,
      "Dupont Plomberie, très bien, il y a de la place",
    );
    assertEquals(created.deletedAt, null);
  } finally {
    await teardown(setup, [responder]);
  }
});

Deno.test("listCommentsByPost : chronologique (plus ancien d'abord), regroupé par demande, ignore les demandes sans réponse", async () => {
  const setupA = await setupPost("comments-2a");
  const setupB = await setupPost("comments-2b");
  const { user: responder } = await registerInhabitant({
    login: `login-r-${crypto.randomUUID()}`,
    email: `comments-r-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: setupA.testStreet.testStreet.id,
  });

  try {
    const first = await createComment({
      userId: responder.id,
      postId: setupA.post.id,
      content: "Premier avis",
    });
    const second = await createComment({
      userId: responder.id,
      postId: setupA.post.id,
      content: "Second avis",
    });

    const result = await listCommentsByPost([
      setupA.post.id,
      setupB.post.id,
    ]);

    assertEquals(
      result.get(setupA.post.id)?.map((c) => c.id),
      [first.id, second.id],
    );
    assertEquals(result.get(setupA.post.id)?.[0].authorLogin, responder.login);
    // Aucune réponse pour setupB : ni clé absente ni tableau vide inattendu.
    assertEquals(result.get(setupB.post.id), undefined);
  } finally {
    await teardown(setupA, [responder]);
    await teardown(setupB);
  }
});

Deno.test("listCommentsByPost : liste vide → map vide, sans requête inutile", async () => {
  const result = await listCommentsByPost([]);
  assertEquals(result.size, 0);
});
