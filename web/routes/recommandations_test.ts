import { assertEquals, assertStringIncludes } from "@std/assert";
import { eq } from "drizzle-orm";
import type { Context } from "fresh";
import type { SessionUser, State } from "../utils.ts";
import { db } from "../db/client.ts";
import { comment, house, post, street, user } from "../db/schema.ts";
import { STREET_AWAKENING_THRESHOLD } from "../db/streets.ts";
import { registerInhabitant } from "../db/users.ts";
import { createComment } from "../db/comments.ts";
import { createPost, MAX_POST_DURATION_MONTHS } from "../db/posts.ts";
import { cleanupTestStreet, createTestStreet } from "../db/test_helpers.ts";
import { handler } from "./recommandations.tsx";

function makeContext(
  url: string,
  options: { user?: SessionUser | null; form?: FormData } = {},
): Context<State> {
  return {
    url: new URL(url),
    state: { user: options.user ?? null },
    redirect: (location: string) =>
      new Response(null, { status: 302, headers: { location } }),
    req: { formData: () => Promise.resolve(options.form ?? new FormData()) },
  } as unknown as Context<State>;
}

/** Rue avec un habitant connecté, amenée au seuil d'éveil (rue « allumée ») — cf. fil_test.ts. */
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
    email: `reco-${crypto.randomUUID()}@example.invalid`,
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
  await db.delete(comment).where(eq(comment.userId, created.id));
  await db.delete(post).where(eq(post.userId, created.id));
  await db.delete(user).where(eq(user.id, created.id));
  await db.delete(house).where(eq(house.streetId, testStreet.testStreet.id));
  await cleanupTestStreet(testStreet);
}

Deno.test("GET /recommandations : non connecté → redirigé vers /connexion", async () => {
  const response = await handler.GET!(
    makeContext("http://localhost/recommandations"),
  ) as Response;
  assertEquals(response.status, 302);
  assertEquals(response.headers.get("location"), "/connexion");
});

Deno.test("POST /recommandations : non connecté → redirigé vers /connexion", async () => {
  const response = await handler.POST!(
    makeContext("http://localhost/recommandations"),
  ) as Response;
  assertEquals(response.status, 302);
  assertEquals(response.headers.get("location"), "/connexion");
});

Deno.test("GET /recommandations : rue pas encore allumée → redirigé vers /", async () => {
  const testStreet = await createTestStreet("reco-1");
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `reco-${crypto.randomUUID()}@example.invalid`,
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
    const response = await handler.GET!(
      makeContext("http://localhost/recommandations", { user: sessionUser }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/");
  } finally {
    await db.delete(user).where(eq(user.id, created.id));
    await db.delete(house).where(eq(house.id, created.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("GET /recommandations : rue allumée → aucune erreur, durée par défaut la plus longue", async () => {
  const awake = await createAwakeStreetWithUser("reco-2");

  try {
    const result = await handler.GET!(
      makeContext("http://localhost/recommandations", {
        user: awake.sessionUser,
      }),
    ) as {
      data: {
        cityName: string;
        posts: unknown[];
        postError: string | null;
        postPublished: boolean;
        postDuration: string;
        postDurationMonths: number;
      };
    };

    assertEquals(result.data.cityName, awake.testStreet.testCity.name);
    assertEquals(result.data.posts, []);
    assertEquals(result.data.postError, null);
    assertEquals(result.data.postPublished, false);
    assertEquals(result.data.postDuration, "months");
    assertEquals(result.data.postDurationMonths, MAX_POST_DURATION_MONTHS);
  } finally {
    await cleanupAwakeStreet(awake);
  }
});

Deno.test("GET /recommandations : ?published=1 → bandeau de confirmation", async () => {
  const awake = await createAwakeStreetWithUser("reco-3");

  try {
    const result = await handler.GET!(
      makeContext("http://localhost/recommandations?published=1", {
        user: awake.sessionUser,
      }),
    ) as { data: { postPublished: boolean } };
    assertEquals(result.data.postPublished, true);
  } finally {
    await cleanupAwakeStreet(awake);
  }
});

Deno.test("POST /recommandations : rue pas encore allumée → redirigé sans publier", async () => {
  const testStreet = await createTestStreet("reco-4");
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `reco-${crypto.randomUUID()}@example.invalid`,
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
  const form = new FormData();
  form.set("duration", "week");
  form.set("content", "Un plombier fiable ?");

  try {
    const response = await handler.POST!(
      makeContext("http://localhost/recommandations", {
        user: sessionUser,
        form,
      }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/");

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

Deno.test("POST /recommandations : contenu vide → erreur, rien en base", async () => {
  const awake = await createAwakeStreetWithUser("reco-5");

  try {
    const form = new FormData();
    form.set("duration", "week");
    form.set("content", "");

    const result = await handler.POST!(
      makeContext("http://localhost/recommandations", {
        user: awake.sessionUser,
        form,
      }),
    ) as { data: { postError: string | null } };

    assertEquals(
      result.data.postError,
      "Merci de choisir une durée et d'écrire votre demande.",
    );

    const posts = await db.select().from(post).where(
      eq(post.userId, awake.created.id),
    );
    assertEquals(posts.length, 0);
  } finally {
    await cleanupAwakeStreet(awake);
  }
});

Deno.test("POST /recommandations : message agressif → bloqué, rien en base", async () => {
  const awake = await createAwakeStreetWithUser("reco-6");

  try {
    const form = new FormData();
    form.set("duration", "week");
    form.set("content", "Bande de connard, dégagez de ma rue");

    const result = await handler.POST!(
      makeContext("http://localhost/recommandations", {
        user: awake.sessionUser,
        form,
      }),
    ) as { data: { postError: string | null; postContent: string } };

    assertStringIncludes(result.data.postError ?? "", "reformuler");
    assertEquals(
      result.data.postContent,
      "Bande de connard, dégagez de ma rue",
    );

    const posts = await db.select().from(post).where(
      eq(post.userId, awake.created.id),
    );
    assertEquals(posts.length, 0);
  } finally {
    await cleanupAwakeStreet(awake);
  }
});

Deno.test("POST /recommandations : message valide → publié en type recommandation, redirection avec confirmation", async () => {
  const awake = await createAwakeStreetWithUser("reco-7");

  try {
    const form = new FormData();
    form.set("duration", "week");
    form.set("content", "Un plombier fiable pour une fuite ?");

    const response = await handler.POST!(
      makeContext("http://localhost/recommandations", {
        user: awake.sessionUser,
        form,
      }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(
      response.headers.get("location"),
      "/recommandations?published=1",
    );

    const [created] = await db.select().from(post).where(
      eq(post.userId, awake.created.id),
    );
    assertEquals(created.content, "Un plombier fiable pour une fuite ?");
    assertEquals(created.type, "recommandation");
  } finally {
    await cleanupAwakeStreet(awake);
  }
});

Deno.test("GET /recommandations : demandes de toute la ville (autre rue incluse), pas d'une autre ville", async () => {
  const awake = await createAwakeStreetWithUser("reco-8a");
  // Deuxième rue de la même ville : `findOrCreateStreet` n'est pas utilisé
  // ici, on insère directement avec le même `cityId`.
  const [otherStreetSameCity] = await db.insert(street).values({
    name: `Autre rue ${crypto.randomUUID()}`,
    cityId: awake.testStreet.testCity.id,
  }).returning();
  const { user: sameCityAuthor } = await registerInhabitant({
    login: `login-sc-${crypto.randomUUID()}`,
    email: `reco-sc-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: otherStreetSameCity.id,
  });
  const otherCity = await createAwakeStreetWithUser("reco-8b");

  try {
    const sameCityPost = await createPost({
      userId: sameCityAuthor.id,
      type: "recommandation",
      content: "Recommandation de l'autre rue, même ville",
    });
    await createPost({
      userId: otherCity.created.id,
      type: "recommandation",
      content: "Recommandation d'une autre ville",
    });

    const result = await handler.GET!(
      makeContext("http://localhost/recommandations", {
        user: awake.sessionUser,
      }),
    ) as { data: { posts: { id: number }[] } };

    const ids = result.data.posts.map((p) => p.id);
    assertEquals(ids.includes(sameCityPost.id), true);
    assertEquals(ids.length, 1);
  } finally {
    await db.delete(post).where(eq(post.userId, sameCityAuthor.id));
    await db.delete(user).where(eq(user.id, sameCityAuthor.id));
    await db.delete(house).where(eq(house.id, sameCityAuthor.houseId));
    await db.delete(street).where(eq(street.id, otherStreetSameCity.id));
    await cleanupAwakeStreet(awake);
    await cleanupAwakeStreet(otherCity);
  }
});

Deno.test("GET /recommandations : les réponses déjà données sont attachées à chaque demande", async () => {
  const awake = await createAwakeStreetWithUser("reco-9");

  try {
    const created = await createPost({
      userId: awake.created.id,
      type: "recommandation",
      content: "Un dentiste qui prend des patients ?",
    });
    await createComment({
      userId: awake.created.id,
      postId: created.id,
      content: "Dr Martin, cabinet rue des Lilas",
    });

    const result = await handler.GET!(
      makeContext("http://localhost/recommandations", {
        user: awake.sessionUser,
      }),
    ) as {
      data: { posts: { id: number; comments: { content: string }[] }[] };
    };

    assertEquals(
      result.data.posts.find((p) => p.id === created.id)?.comments.map((
        c,
      ) => c.content),
      ["Dr Martin, cabinet rue des Lilas"],
    );
  } finally {
    // `cleanupAwakeStreet` supprime déjà les commentaires de `created` (cf.
    // sa définition) avant le post et le compte.
    await cleanupAwakeStreet(awake);
  }
});

Deno.test("GET /recommandations : ?q=... filtre la liste et remonte le nombre de résultats", async () => {
  const awake = await createAwakeStreetWithUser("reco-10");

  try {
    const matching = await createPost({
      userId: awake.created.id,
      type: "recommandation",
      content: "Un plombier fiable pour une fuite ?",
    });
    await createPost({
      userId: awake.created.id,
      type: "recommandation",
      content: "Une nounou disponible le mercredi ?",
    });

    const result = await handler.GET!(
      makeContext("http://localhost/recommandations?q=plombier", {
        user: awake.sessionUser,
      }),
    ) as {
      data: {
        posts: { id: number }[];
        totalCount: number;
        search: string | null;
      };
    };

    assertEquals(result.data.posts.map((p) => p.id), [matching.id]);
    assertEquals(result.data.totalCount, 1);
    assertEquals(result.data.search, "plombier");
  } finally {
    await cleanupAwakeStreet(awake);
  }
});
