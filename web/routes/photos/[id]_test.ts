import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import type { Context } from "fresh";
import type { SessionUser, State } from "../../utils.ts";
import { db } from "../../db/client.ts";
import { house, post, postImage, user } from "../../db/schema.ts";
import { createPost } from "../../db/posts.ts";
import { registerInhabitant } from "../../db/users.ts";
import { cleanupTestStreet, createTestStreet } from "../../db/test_helpers.ts";
import { handler } from "./[id].ts";

const SAMPLE_IMAGE = {
  data: new Uint8Array([1, 2, 3, 4]),
  width: 10,
  height: 5,
};

function makeContext(
  imageId: number,
  sessionUser: SessionUser | null,
): Context<State> {
  return {
    params: { id: String(imageId) },
    state: { user: sessionUser },
  } as unknown as Context<State>;
}

async function setup(label: string) {
  const testStreet = await createTestStreet(label);
  const { user: author } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `photos-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const created = await createPost({
    userId: author.id,
    type: "cherche",
    content: "Je cherche une perceuse",
    image: { streetId: testStreet.testStreet.id, ...SAMPLE_IMAGE },
  });
  const [image] = await db.select().from(postImage).where(
    eq(postImage.postId, created.id),
  );
  const sessionUser: SessionUser = {
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
  return { testStreet, author, post: created, image, sessionUser };
}

Deno.test("GET /photos/:id : non connecté → 404 (jamais de redirection sur une <img>)", async () => {
  const response = await handler.GET!(makeContext(1, null)) as Response;
  assertEquals(response.status, 404);
});

Deno.test("GET /photos/:id : identifiant non numérique → 404 sans planter", async () => {
  const ctx = {
    params: { id: "abc" },
    state: { user: null },
  } as unknown as Context<
    State
  >;
  const response = await handler.GET!(ctx) as Response;
  assertEquals(response.status, 404);
});

Deno.test("GET /photos/:id : voisin de la même rue → 200, JPEG servi", async () => {
  const s = await setup("photos-1");
  try {
    const response = await handler.GET!(
      makeContext(s.image.id, s.sessionUser),
    ) as Response;
    assertEquals(response.status, 200);
    assertEquals(response.headers.get("Content-Type"), "image/jpeg");
    const body = new Uint8Array(await response.arrayBuffer());
    assertEquals([...body], [...SAMPLE_IMAGE.data]);
  } finally {
    await db.delete(post).where(eq(post.id, s.post.id));
    await db.delete(user).where(eq(user.id, s.author.id));
    await db.delete(house).where(
      eq(house.streetId, s.testStreet.testStreet.id),
    );
    await cleanupTestStreet(s.testStreet);
  }
});

Deno.test("GET /photos/:id : habitant d'une autre rue → 404", async () => {
  const s = await setup("photos-2");
  const otherStreet = await createTestStreet("photos-2-other");
  try {
    const { user: otherUser } = await registerInhabitant({
      login: `login-${crypto.randomUUID()}`,
      email: `photos-other-${crypto.randomUUID()}@example.invalid`,
      houseNumber: null,
      streetId: otherStreet.testStreet.id,
    });
    const otherSession: SessionUser = {
      id: otherUser.id,
      login: otherUser.login,
      email: otherUser.email,
      isAmbassador: otherUser.isAmbassador,
      street: {
        id: otherStreet.testStreet.id,
        name: otherStreet.testStreet.name,
        city: { id: otherStreet.testCity.id, name: otherStreet.testCity.name },
      },
    };

    const response = await handler.GET!(
      makeContext(s.image.id, otherSession),
    ) as Response;
    assertEquals(response.status, 404);

    await db.delete(user).where(eq(user.id, otherUser.id));
    await db.delete(house).where(eq(house.streetId, otherStreet.testStreet.id));
  } finally {
    await db.delete(post).where(eq(post.id, s.post.id));
    await db.delete(user).where(eq(user.id, s.author.id));
    await db.delete(house).where(
      eq(house.streetId, s.testStreet.testStreet.id),
    );
    await cleanupTestStreet(s.testStreet);
    await cleanupTestStreet(otherStreet);
  }
});
