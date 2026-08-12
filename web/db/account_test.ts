import { assertEquals, assertNotEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import { db } from "./client.ts";
import { comment, house, post, tap, user } from "./schema.ts";
import { deleteUserAccount } from "./account.ts";
import { createComment } from "./comments.ts";
import { createPost } from "./posts.ts";
import { getStreetHousesStatus } from "./streets.ts";
import { toggleTap } from "./taps.ts";
import { registerInhabitant } from "./users.ts";
import { cleanupTestStreet, createTestStreet } from "./test_helpers.ts";

async function setupInhabitant(label: string) {
  const testStreet = await createTestStreet(label);
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID().slice(0, 8)}`,
    email: `account-${crypto.randomUUID()}@example.invalid`,
    houseNumber: "12",
    streetId: testStreet.testStreet.id,
  });
  return { testStreet, user: created };
}

/** Nettoyage dans l'ordre des FK — tolère les lignes déjà supprimées par le test lui-même. */
async function teardown(setup: Awaited<ReturnType<typeof setupInhabitant>>) {
  await db.delete(comment).where(eq(comment.userId, setup.user.id));
  await db.delete(post).where(eq(post.userId, setup.user.id));
  await db.delete(user).where(eq(user.id, setup.user.id));
  await db.delete(house).where(eq(house.id, setup.user.houseId));
  await cleanupTestStreet(setup.testStreet);
}

Deno.test("deleteUserAccount : compte, foyer et publications soft-supprimés", async () => {
  const setup = await setupInhabitant("account-1");
  const createdPost = await createPost({
    userId: setup.user.id,
    type: "cherche",
    content: "Je cherche une perceuse",
  });
  const otherPost = await createPost({
    userId: setup.user.id,
    type: "recommandation",
    content: "Un plombier fiable ?",
  });
  const createdComment = await createComment({
    userId: setup.user.id,
    postId: otherPost.id,
    content: "Essayez Dupont Plomberie",
  });

  try {
    const statusBefore = await getStreetHousesStatus(
      setup.testStreet.testStreet.id,
    );
    assertEquals(statusBefore.housesCount, 1);

    await deleteUserAccount(setup.user.id);

    const [reloadedUser] = await db.select().from(user).where(
      eq(user.id, setup.user.id),
    );
    assertNotEquals(reloadedUser.deletedAt, null);
    assertNotEquals(reloadedUser.login, setup.user.login);
    assertNotEquals(reloadedUser.email, setup.user.email);
    assertEquals(reloadedUser.email.endsWith("@notrerue.invalid"), true);

    const [reloadedHouse] = await db.select().from(house).where(
      eq(house.id, setup.user.houseId),
    );
    assertNotEquals(reloadedHouse.deletedAt, null);
    // Numéro de foyer (donnée personnelle) effacé en même temps que le
    // foyer soft-supprimé (cf. revue « rester maître de mes données »).
    assertEquals(reloadedHouse.number, null);

    const [reloadedPost] = await db.select().from(post).where(
      eq(post.id, createdPost.id),
    );
    assertNotEquals(reloadedPost.deletedAt, null);
    const [reloadedOtherPost] = await db.select().from(post).where(
      eq(post.id, otherPost.id),
    );
    assertNotEquals(reloadedOtherPost.deletedAt, null);

    const [reloadedComment] = await db.select().from(comment).where(
      eq(comment.id, createdComment.id),
    );
    assertNotEquals(reloadedComment.deletedAt, null);

    // Le foyer est exclu du décompte de la rue une fois supprimé (cf.
    // countHouses dans db/streets.ts) : la rue peut redescendre sous le
    // seuil d'éveil — conséquence assumée.
    const statusAfter = await getStreetHousesStatus(
      setup.testStreet.testStreet.id,
    );
    assertEquals(statusAfter.housesCount, 0);
  } finally {
    await teardown(setup);
  }
});

Deno.test("deleteUserAccount : login/e-mail anonymisés restent uniques (pas de collision entre deux suppressions)", async () => {
  const setupA = await setupInhabitant("account-2a");
  const setupB = await setupInhabitant("account-2b");

  try {
    await deleteUserAccount(setupA.user.id);
    await deleteUserAccount(setupB.user.id);

    const [reloadedA] = await db.select().from(user).where(
      eq(user.id, setupA.user.id),
    );
    const [reloadedB] = await db.select().from(user).where(
      eq(user.id, setupB.user.id),
    );
    assertNotEquals(reloadedA.login, reloadedB.login);
    assertNotEquals(reloadedA.email, reloadedB.email);
  } finally {
    await teardown(setupA);
    await teardown(setupB);
  }
});

Deno.test("deleteUserAccount : foyer partagé avec un autre habitant actif → foyer conservé", async () => {
  const setup = await setupInhabitant("account-3");
  const [roommate] = await db.insert(user).values({
    login: `login-${crypto.randomUUID().slice(0, 8)}`,
    email: `account-roommate-${crypto.randomUUID()}@example.invalid`,
    houseId: setup.user.houseId,
  }).returning();

  try {
    await deleteUserAccount(setup.user.id);

    const [reloadedHouse] = await db.select().from(house).where(
      eq(house.id, setup.user.houseId),
    );
    assertEquals(reloadedHouse.deletedAt, null);
  } finally {
    await db.delete(user).where(eq(user.id, roommate.id));
    await teardown(setup);
  }
});

Deno.test("deleteUserAccount : taps actifs de l'utilisateur soft-supprimés", async () => {
  const setup = await setupInhabitant("account-5");
  const otherAuthor = await setupInhabitant("account-5b");
  const targetPost = await createPost({
    userId: otherAuthor.user.id,
    type: "cherche",
    content: "Je cherche une perceuse",
  });
  await toggleTap(setup.user.id, targetPost.id);

  try {
    await deleteUserAccount(setup.user.id);

    const [reloadedTap] = await db.select().from(tap).where(
      eq(tap.userId, setup.user.id),
    );
    assertNotEquals(reloadedTap.deletedAt, null);
  } finally {
    await db.delete(tap).where(eq(tap.userId, setup.user.id));
    await db.delete(post).where(eq(post.id, targetPost.id));
    await teardown(setup);
    await teardown(otherAuthor);
  }
});

Deno.test("deleteUserAccount : rejoué sur un compte déjà supprimé → aucune erreur, rien ne change", async () => {
  const setup = await setupInhabitant("account-4");

  try {
    await deleteUserAccount(setup.user.id);
    const [firstPass] = await db.select().from(user).where(
      eq(user.id, setup.user.id),
    );

    await deleteUserAccount(setup.user.id);
    const [secondPass] = await db.select().from(user).where(
      eq(user.id, setup.user.id),
    );

    assertEquals(secondPass.login, firstPass.login);
    assertEquals(secondPass.email, firstPass.email);
    assertEquals(secondPass.deletedAt, firstPass.deletedAt);
  } finally {
    await teardown(setup);
  }
});
