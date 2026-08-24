import { assertEquals, assertExists } from "@std/assert";
import { eq } from "drizzle-orm";
import type { Context } from "fresh";
import { Image } from "@cross/image";
import type { SessionUser, State } from "../../../../utils.ts";
import { db } from "../../../../db/client.ts";
import { house, post, user } from "../../../../db/schema.ts";
import { STREET_AWAKENING_THRESHOLD } from "../../../../db/streets.ts";
import { registerInhabitant } from "../../../../db/users.ts";
import { createPost } from "../../../../db/posts.ts";
import {
  cleanupTestStreet,
  createTestStreet,
} from "../../../../db/test_helpers.ts";
import { handler } from "./index.ts";
import { handler as photosHandler } from "../../../photos/[id].ts";

function makeContext(
  url: string,
  options: { user?: SessionUser | null; formData?: () => Promise<FormData> } =
    {},
): Context<State> {
  return {
    url: new URL(url),
    state: { user: options.user ?? null },
    req: {
      formData: options.formData ??
        (() => Promise.resolve(new FormData())),
    },
  } as unknown as Context<State>;
}

function formOf(fields: Record<string, string>): () => Promise<FormData> {
  return () => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.set(key, value);
    return Promise.resolve(form);
  };
}

/** Rue avec un habitant connecté et vérifié, amenée au seuil d'éveil. */
async function createAwakeStreetWithUser(label: string) {
  const testStreet = await createTestStreet(label);

  if (STREET_AWAKENING_THRESHOLD > 1) {
    await db.insert(house).values(
      Array.from(
        { length: STREET_AWAKENING_THRESHOLD - 1 },
        () => ({ streetId: testStreet.testStreet.id }),
      ),
    );
  }

  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `api-posts-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const sessionUser: SessionUser = {
    id: created.id,
    login: created.login,
    email: created.email,
    isAmbassador: created.isAmbassador,
    street: {
      id: testStreet.testStreet.id,
      name: testStreet.testStreet.name,
      city: { id: testStreet.testCity.id, name: testStreet.testCity.name },
    },
  };

  return { testStreet, created, sessionUser };
}

async function cleanupAwakeStreet(
  { testStreet, created }: Awaited<
    ReturnType<typeof createAwakeStreetWithUser>
  >,
) {
  await db.delete(post).where(eq(post.userId, created.id));
  await db.delete(user).where(eq(user.id, created.id));
  await db.delete(house).where(eq(house.streetId, testStreet.testStreet.id));
  await cleanupTestStreet(testStreet);
}

Deno.test("GET /api/v1/posts : non connecté → 401", async () => {
  const res = await handler.GET!(
    makeContext("http://localhost/api/v1/posts"),
  ) as Response;
  assertEquals(res.status, 401);
});

Deno.test("GET /api/v1/posts : rue pas encore allumée → 200, isStreetAwake false, aucune demande", async () => {
  const testStreet = await createTestStreet("api-posts-1");
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `api-posts-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const sessionUser: SessionUser = {
    id: created.id,
    login: created.login,
    email: created.email,
    isAmbassador: created.isAmbassador,
    street: {
      id: testStreet.testStreet.id,
      name: testStreet.testStreet.name,
      city: { id: testStreet.testCity.id, name: testStreet.testCity.name },
    },
  };

  try {
    const res = await handler.GET!(
      makeContext("http://localhost/api/v1/posts", { user: sessionUser }),
    ) as Response;
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.isStreetAwake, false);
    assertEquals(body.posts, []);
  } finally {
    await db.delete(user).where(eq(user.id, created.id));
    await db.delete(house).where(eq(house.id, created.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("GET /api/v1/posts : rue allumée → fil chronologique, avec le viewer", async () => {
  const awake = await createAwakeStreetWithUser("api-posts-2");

  try {
    await createPost({
      userId: awake.created.id,
      type: "cherche",
      content: "Je cherche une perceuse",
    });
    await createPost({
      userId: awake.created.id,
      type: "propose",
      content: "Je prête ma tondeuse",
    });

    const res = await handler.GET!(
      makeContext("http://localhost/api/v1/posts", {
        user: awake.sessionUser,
      }),
    ) as Response;
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.isStreetAwake, true);
    assertEquals(body.streetName, awake.testStreet.testStreet.name);
    assertEquals(body.viewer.id, awake.created.id);
    assertEquals(body.viewer.isVerified, true);
    assertEquals(body.posts.length, 2);
    assertEquals(body.posts[0].content, "Je prête ma tondeuse");
    assertEquals(body.posts[1].content, "Je cherche une perceuse");
    assertEquals(body.posts[0].tapCount, 0);
    assertEquals(body.posts[0].viewerHasTapped, false);
  } finally {
    await cleanupAwakeStreet(awake);
  }
});

Deno.test("GET /api/v1/posts : ?type=propose → ne filtre que ce type", async () => {
  const awake = await createAwakeStreetWithUser("api-posts-3");

  try {
    await createPost({
      userId: awake.created.id,
      type: "cherche",
      content: "Je cherche une perceuse",
    });
    await createPost({
      userId: awake.created.id,
      type: "propose",
      content: "Je prête ma tondeuse",
    });

    const res = await handler.GET!(
      makeContext("http://localhost/api/v1/posts?type=propose", {
        user: awake.sessionUser,
      }),
    ) as Response;
    const body = await res.json();
    assertEquals(body.posts.length, 1);
    assertEquals(body.posts[0].type, "propose");
  } finally {
    await cleanupAwakeStreet(awake);
  }
});

Deno.test("GET /api/v1/posts : ?q=... filtre par recherche", async () => {
  const awake = await createAwakeStreetWithUser("api-posts-3b");

  try {
    await createPost({
      userId: awake.created.id,
      type: "cherche",
      content: "Je cherche une perceuse",
    });
    await createPost({
      userId: awake.created.id,
      type: "propose",
      content: "Je prête ma tondeuse",
    });

    const res = await handler.GET!(
      makeContext("http://localhost/api/v1/posts?q=tondeuse", {
        user: awake.sessionUser,
      }),
    ) as Response;
    const body = await res.json();
    assertEquals(body.posts.length, 1);
    assertEquals(body.posts[0].content, "Je prête ma tondeuse");
  } finally {
    await cleanupAwakeStreet(awake);
  }
});

Deno.test("POST /api/v1/posts : non connecté → 401", async () => {
  const res = await handler.POST!(
    makeContext("http://localhost/api/v1/posts"),
  ) as Response;
  assertEquals(res.status, 401);
});

Deno.test("POST /api/v1/posts : rue pas encore allumée → 403, rien publié", async () => {
  const testStreet = await createTestStreet("api-posts-4");
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `api-posts-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const sessionUser: SessionUser = {
    id: created.id,
    login: created.login,
    email: created.email,
    isAmbassador: created.isAmbassador,
    street: {
      id: testStreet.testStreet.id,
      name: testStreet.testStreet.name,
      city: { id: testStreet.testCity.id, name: testStreet.testCity.name },
    },
  };

  try {
    const res = await handler.POST!(
      makeContext("http://localhost/api/v1/posts", {
        user: sessionUser,
        formData: formOf({
          type: "cherche",
          duration: "week",
          content: "Je cherche une perceuse",
        }),
      }),
    ) as Response;
    assertEquals(res.status, 403);
    const posts = await db.select().from(post).where(
      eq(post.userId, created.id),
    );
    assertEquals(posts.length, 0);
  } finally {
    await db.delete(user).where(eq(user.id, created.id));
    await db.delete(house).where(eq(house.id, created.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("POST /api/v1/posts : compte non vérifié → 403, rien publié (cf. db/vouches.ts)", async () => {
  const awake = await createAwakeStreetWithUser("api-posts-5");
  const unverified = { ...awake.sessionUser, isVerified: false };

  try {
    const res = await handler.POST!(
      makeContext("http://localhost/api/v1/posts", {
        user: unverified,
        formData: formOf({
          type: "cherche",
          duration: "week",
          content: "Je cherche une perceuse",
        }),
      }),
    ) as Response;
    assertEquals(res.status, 403);
    const posts = await db.select().from(post).where(
      eq(post.userId, awake.created.id),
    );
    assertEquals(posts.length, 0);
  } finally {
    await cleanupAwakeStreet(awake);
  }
});

Deno.test("POST /api/v1/posts : type/durée/contenu manquant → 400, rien publié", async () => {
  const awake = await createAwakeStreetWithUser("api-posts-6");

  try {
    const res = await handler.POST!(
      makeContext("http://localhost/api/v1/posts", {
        user: awake.sessionUser,
        formData: formOf({ type: "cherche", duration: "week", content: "" }),
      }),
    ) as Response;
    assertEquals(res.status, 400);
  } finally {
    await cleanupAwakeStreet(awake);
  }
});

Deno.test("POST /api/v1/posts : message agressif → 422, rien publié", async () => {
  const awake = await createAwakeStreetWithUser("api-posts-7");

  try {
    const res = await handler.POST!(
      makeContext("http://localhost/api/v1/posts", {
        user: awake.sessionUser,
        formData: formOf({
          type: "cherche",
          duration: "week",
          content: "connard",
        }),
      }),
    ) as Response;
    assertEquals(res.status, 422);
    const posts = await db.select().from(post).where(
      eq(post.userId, awake.created.id),
    );
    assertEquals(posts.length, 0);
  } finally {
    await cleanupAwakeStreet(awake);
  }
});

Deno.test("POST /api/v1/posts : demande valide → 201, publiée, DTO complet", async () => {
  const awake = await createAwakeStreetWithUser("api-posts-8");

  try {
    const res = await handler.POST!(
      makeContext("http://localhost/api/v1/posts", {
        user: awake.sessionUser,
        formData: formOf({
          type: "cherche",
          duration: "week",
          content: "Je cherche une perceuse",
        }),
      }),
    ) as Response;
    assertEquals(res.status, 201);
    const body = await res.json();
    assertEquals(body.post.type, "cherche");
    assertEquals(body.post.content, "Je cherche une perceuse");
    assertEquals(body.post.authorLogin, awake.created.login);
    assertEquals(body.post.tapCount, 0);
    assertEquals(body.post.image, null);
    assertExists(body.post.createdAt);

    const posts = await db.select().from(post).where(
      eq(post.userId, awake.created.id),
    );
    assertEquals(posts.length, 1);
  } finally {
    await cleanupAwakeStreet(awake);
  }
});

Deno.test("POST /api/v1/posts : deux publications rapprochées → la seconde est bloquée (429)", async () => {
  const awake = await createAwakeStreetWithUser("api-posts-9");

  try {
    const first = await handler.POST!(
      makeContext("http://localhost/api/v1/posts", {
        user: awake.sessionUser,
        formData: formOf({
          type: "cherche",
          duration: "week",
          content: "Je cherche une perceuse",
        }),
      }),
    ) as Response;
    assertEquals(first.status, 201);

    const second = await handler.POST!(
      makeContext("http://localhost/api/v1/posts", {
        user: awake.sessionUser,
        formData: formOf({
          type: "propose",
          duration: "week",
          content: "Je prête ma tondeuse",
        }),
      }),
    ) as Response;
    assertEquals(second.status, 429);

    const posts = await db.select().from(post).where(
      eq(post.userId, awake.created.id),
    );
    assertEquals(posts.length, 1);
  } finally {
    await cleanupAwakeStreet(awake);
  }
});

Deno.test("POST /api/v1/posts : avec une photo valide → 201, image dans le DTO, servie par /photos/:id", async () => {
  const awake = await createAwakeStreetWithUser("api-posts-10");

  try {
    const source = new Uint8Array(
      await Image.create(2000, 1000, 255, 0, 0).encode("png"),
    );
    const res = await handler.POST!(
      makeContext("http://localhost/api/v1/posts", {
        user: awake.sessionUser,
        formData: () => {
          const form = new FormData();
          form.set("type", "cherche");
          form.set("duration", "week");
          form.set("content", "Je cherche une perceuse, photo à l'appui");
          form.set(
            "image",
            new File([source], "photo.png", { type: "image/png" }),
          );
          return Promise.resolve(form);
        },
      }),
    ) as Response;
    assertEquals(res.status, 201);
    const body = await res.json();
    assertExists(body.post.image);
    // Redimensionnée (cf. utils/image.ts#MAX_IMAGE_DIMENSION), pas la
    // taille d'origine.
    assertEquals(body.post.image.width, 1600);
    assertEquals(body.post.image.height, 800);

    // La photo doit être effectivement récupérable par le même habitant,
    // via l'identifiant renvoyé dans le DTO — c'est ce chemin exact que
    // suit l'app mobile pour l'afficher (cf.
    // mobile/components/fil/PostImage.tsx).
    const photoRes = await photosHandler.GET!({
      params: { id: String(body.post.image.id) },
      state: { user: awake.sessionUser },
    } as unknown as Context<State>) as Response;
    assertEquals(photoRes.status, 200);
    assertEquals(photoRes.headers.get("content-type"), "image/jpeg");
  } finally {
    await cleanupAwakeStreet(awake);
  }
});
