import { assertEquals, assertStringIncludes } from "@std/assert";
import { eq } from "drizzle-orm";
import type { Context } from "fresh";
import type { SessionUser, State } from "../utils.ts";
import { db } from "../db/client.ts";
import { comment, house, post, tap, user } from "../db/schema.ts";
import { STREET_AWAKENING_THRESHOLD } from "../db/streets.ts";
import { registerInhabitant } from "../db/users.ts";
import { toggleTap } from "../db/taps.ts";
import { createComment } from "../db/comments.ts";
import { createPost, MIN_POST_DURATION_MONTHS } from "../db/posts.ts";
import { cleanupTestStreet, createTestStreet } from "../db/test_helpers.ts";
import { handler } from "./fil.tsx";

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

/** Rue avec un habitant connecté, amenée au seuil d'éveil (rue « allumée »). */
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
    email: `fil-${crypto.randomUUID()}@example.invalid`,
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

Deno.test("GET /fil : non connecté → redirigé vers /connexion", async () => {
  const response = await handler.GET!(
    makeContext("http://localhost/fil"),
  ) as Response;
  assertEquals(response.status, 302);
  assertEquals(response.headers.get("location"), "/connexion");
});

Deno.test("POST /fil : non connecté → redirigé vers /connexion", async () => {
  const response = await handler.POST!(
    makeContext("http://localhost/fil"),
  ) as Response;
  assertEquals(response.status, 302);
  assertEquals(response.headers.get("location"), "/connexion");
});

Deno.test("GET /fil : rue pas encore allumée → redirigé vers /", async () => {
  const testStreet = await createTestStreet("fil-1");
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `fil-${crypto.randomUUID()}@example.invalid`,
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
      makeContext("http://localhost/fil", { user: sessionUser }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/");
  } finally {
    await db.delete(user).where(eq(user.id, created.id));
    await db.delete(house).where(eq(house.id, created.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("GET /fil : rue allumée → fil de la rue de l'utilisateur, pas d'erreur ni de bandeau par défaut", async () => {
  const awake = await createAwakeStreetWithUser("fil-2");

  try {
    const result = await handler.GET!(
      makeContext("http://localhost/fil", { user: awake.sessionUser }),
    ) as {
      data: {
        streetName: string;
        posts: unknown[];
        page: number;
        totalPages: number;
        activeType: string | null;
        postError: string | null;
        postPublished: boolean;
      };
    };

    assertEquals(result.data.streetName, awake.testStreet.testStreet.name);
    assertEquals(result.data.posts, []);
    assertEquals(result.data.page, 1);
    assertEquals(result.data.totalPages, 1);
    assertEquals(result.data.activeType, null);
    assertEquals(result.data.postError, null);
    assertEquals(result.data.postPublished, false);
  } finally {
    await cleanupAwakeStreet(awake);
  }
});

Deno.test("GET /fil : ?published=1 → bandeau de confirmation", async () => {
  const awake = await createAwakeStreetWithUser("fil-3");

  try {
    const result = await handler.GET!(
      makeContext("http://localhost/fil?published=1", {
        user: awake.sessionUser,
      }),
    ) as { data: { postPublished: boolean } };
    assertEquals(result.data.postPublished, true);
  } finally {
    await cleanupAwakeStreet(awake);
  }
});

Deno.test("GET /fil : ?type=propose → ne filtre que ce type", async () => {
  const awake = await createAwakeStreetWithUser("fil-4");

  try {
    await handler.POST!(
      makeContext("http://localhost/fil", {
        user: awake.sessionUser,
        form: (() => {
          const form = new FormData();
          form.set("type", "cherche");
          form.set("duration", "week");
          form.set("content", "Je cherche une perceuse");
          return form;
        })(),
      }),
    );
    await handler.POST!(
      makeContext("http://localhost/fil", {
        user: awake.sessionUser,
        form: (() => {
          const form = new FormData();
          form.set("type", "propose");
          form.set("duration", "week");
          form.set("content", "Je prête ma tondeuse");
          return form;
        })(),
      }),
    );

    const result = await handler.GET!(
      makeContext("http://localhost/fil?type=propose", {
        user: awake.sessionUser,
      }),
    ) as { data: { posts: { content: string; type: string }[] } };

    assertEquals(result.data.posts.length, 1);
    assertEquals(result.data.posts[0].type, "propose");
    assertEquals(result.data.posts[0].content, "Je prête ma tondeuse");
  } finally {
    await cleanupAwakeStreet(awake);
  }
});

Deno.test("POST /fil : rue pas encore allumée → redirigé sans publier", async () => {
  const testStreet = await createTestStreet("fil-5");
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `fil-${crypto.randomUUID()}@example.invalid`,
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
  form.set("type", "cherche");
  form.set("content", "Je cherche une perceuse");

  try {
    const response = await handler.POST!(
      makeContext("http://localhost/fil", { user: sessionUser, form }),
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

Deno.test("POST /fil : contenu vide ou type invalide → erreur, rien en base", async () => {
  const awake = await createAwakeStreetWithUser("fil-6");

  try {
    const form = new FormData();
    form.set("type", "n'importe quoi");
    form.set("content", "");

    const result = await handler.POST!(
      makeContext("http://localhost/fil", { user: awake.sessionUser, form }),
    ) as { data: { postError: string | null } };

    assertEquals(
      result.data.postError,
      "Merci de choisir un type, une durée et d'écrire votre demande.",
    );

    const posts = await db.select().from(post).where(
      eq(post.userId, awake.created.id),
    );
    assertEquals(posts.length, 0);
  } finally {
    await cleanupAwakeStreet(awake);
  }
});

Deno.test("POST /fil : message agressif → bloqué, rien en base", async () => {
  const awake = await createAwakeStreetWithUser("fil-7");

  try {
    const form = new FormData();
    form.set("type", "informe");
    form.set("duration", "week");
    form.set("content", "Bande de connard, dégagez de ma rue");

    const result = await handler.POST!(
      makeContext("http://localhost/fil", { user: awake.sessionUser, form }),
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

Deno.test("POST /fil : message valide → publié, redirection avec confirmation", async () => {
  const awake = await createAwakeStreetWithUser("fil-8");

  try {
    const form = new FormData();
    form.set("type", "propose");
    form.set("duration", "week");
    form.set("content", "Je prête ma tondeuse ce week-end");

    const response = await handler.POST!(
      makeContext("http://localhost/fil", { user: awake.sessionUser, form }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/fil?published=1");

    const [created] = await db.select().from(post).where(
      eq(post.userId, awake.created.id),
    );
    assertEquals(created.content, "Je prête ma tondeuse ce week-end");
    assertEquals(created.type, "propose");
  } finally {
    await cleanupAwakeStreet(awake);
  }
});

Deno.test("GET /fil : tappers rempli (id + login) sur ses propres demandes, vide sur celles des autres", async () => {
  const awake = await createAwakeStreetWithUser("fil-9");
  const { user: tapper } = await registerInhabitant({
    login: `tapper-${crypto.randomUUID()}`,
    email: `fil-tapper-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: awake.testStreet.testStreet.id,
  });

  try {
    const publishForm = new FormData();
    publishForm.set("type", "cherche");
    publishForm.set("duration", "week");
    publishForm.set("content", "Je cherche une perceuse");
    await handler.POST!(
      makeContext("http://localhost/fil", {
        user: awake.sessionUser,
        form: publishForm,
      }),
    );
    const [created] = await db.select().from(post).where(
      eq(post.userId, awake.created.id),
    );

    const tapperSession: SessionUser = {
      id: tapper.id,
      login: tapper.login,
      email: tapper.email,
      isAmbassador: tapper.isAmbassador,
      street: awake.sessionUser.street,
    };
    await toggleTap(tapper.id, created.id);

    const asAuthor = await handler.GET!(
      makeContext("http://localhost/fil", { user: awake.sessionUser }),
    ) as {
      data: {
        posts: { id: number; tappers: { id: number; login: string }[] }[];
      };
    };
    assertEquals(
      asAuthor.data.posts.find((p) => p.id === created.id)?.tappers,
      [{ id: tapper.id, login: tapper.login }],
    );

    const asTapper = await handler.GET!(
      makeContext("http://localhost/fil", { user: tapperSession }),
    ) as {
      data: {
        posts: { id: number; tappers: { id: number; login: string }[] }[];
      };
    };
    assertEquals(
      asTapper.data.posts.find((p) => p.id === created.id)?.tappers,
      [],
    );
  } finally {
    await db.delete(tap).where(eq(tap.userId, tapper.id));
    await db.delete(user).where(eq(user.id, tapper.id));
    await db.delete(house).where(eq(house.id, tapper.houseId));
    await cleanupAwakeStreet(awake);
  }
});

Deno.test('GET /fil : durée par défaut "cette semaine" à l\'ouverture du formulaire', async () => {
  const awake = await createAwakeStreetWithUser("fil-10");

  try {
    const result = await handler.GET!(
      makeContext("http://localhost/fil", { user: awake.sessionUser }),
    ) as { data: { postDuration: string; postDurationMonths: number } };

    assertEquals(result.data.postDuration, "week");
    assertEquals(result.data.postDurationMonths, MIN_POST_DURATION_MONTHS);
  } finally {
    await cleanupAwakeStreet(awake);
  }
});

Deno.test("POST /fil : durée absente ou invalide → erreur mentionnant la durée, rien en base", async () => {
  const awake = await createAwakeStreetWithUser("fil-11");

  try {
    const form = new FormData();
    form.set("type", "cherche");
    form.set("content", "Je cherche une perceuse");
    // Pas de "duration" du tout.

    const result = await handler.POST!(
      makeContext("http://localhost/fil", { user: awake.sessionUser, form }),
    ) as { data: { postError: string | null } };

    assertStringIncludes(result.data.postError ?? "", "durée");

    const posts = await db.select().from(post).where(
      eq(post.userId, awake.created.id),
    );
    assertEquals(posts.length, 0);
  } finally {
    await cleanupAwakeStreet(awake);
  }
});

Deno.test("POST /fil : erreur → durée et nombre de mois resoumis réaffichés", async () => {
  const awake = await createAwakeStreetWithUser("fil-12");

  try {
    const form = new FormData();
    form.set("type", "cherche");
    form.set("duration", "months");
    form.set("durationMonths", "4");
    form.set("content", ""); // contenu vide → erreur

    const result = await handler.POST!(
      makeContext("http://localhost/fil", { user: awake.sessionUser, form }),
    ) as { data: { postDuration: string; postDurationMonths: number } };

    assertEquals(result.data.postDuration, "months");
    assertEquals(result.data.postDurationMonths, 4);
  } finally {
    await cleanupAwakeStreet(awake);
  }
});

Deno.test('POST /fil : durée "months" → expiresAt calculée avec le nombre de mois choisi', async () => {
  const awake = await createAwakeStreetWithUser("fil-13");

  try {
    const form = new FormData();
    form.set("type", "cherche");
    form.set("duration", "months");
    form.set("durationMonths", "3");
    form.set("content", "Je cherche une perceuse");

    const before = new Date();
    await handler.POST!(
      makeContext("http://localhost/fil", { user: awake.sessionUser, form }),
    );
    const after = new Date();

    const [created] = await db.select().from(post).where(
      eq(post.userId, awake.created.id),
    );
    // ~3 mois : large tolérance (28-31 j/mois) plutôt que de recalculer la
    // date exacte ici — ce détail est déjà couvert par les tests de
    // `computeExpiresAt` dans db/posts_test.ts.
    const minExpected = new Date(before.getTime() + 85 * 24 * 60 * 60 * 1000);
    const maxExpected = new Date(after.getTime() + 95 * 24 * 60 * 60 * 1000);
    assertEquals(created.expiresAt !== null, true);
    assertEquals(created.expiresAt!.getTime() >= minExpected.getTime(), true);
    assertEquals(created.expiresAt!.getTime() <= maxExpected.getTime(), true);
  } finally {
    await cleanupAwakeStreet(awake);
  }
});

Deno.test("GET /fil : une demande expirée n'apparaît plus dans le fil", async () => {
  const awake = await createAwakeStreetWithUser("fil-14");

  try {
    const expired = await createPost({
      userId: awake.created.id,
      type: "cherche",
      content: "Demande expirée",
      expiresAt: new Date(Date.now() - 60_000),
    });
    const stillValid = await createPost({
      userId: awake.created.id,
      type: "cherche",
      content: "Demande encore valide",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await handler.GET!(
      makeContext("http://localhost/fil", { user: awake.sessionUser }),
    ) as { data: { posts: { id: number }[] } };

    const ids = result.data.posts.map((p) => p.id);
    assertEquals(ids.includes(expired.id), false);
    assertEquals(ids.includes(stillValid.id), true);
  } finally {
    await cleanupAwakeStreet(awake);
  }
});

Deno.test("GET /fil : ?q=... filtre la liste et remonte le nombre de résultats", async () => {
  const awake = await createAwakeStreetWithUser("fil-15");

  try {
    const matching = await createPost({
      userId: awake.created.id,
      type: "cherche",
      content: "Je cherche une perceuse",
    });
    await createPost({
      userId: awake.created.id,
      type: "propose",
      content: "Je prête ma tondeuse",
    });

    const result = await handler.GET!(
      makeContext("http://localhost/fil?q=perceuse", {
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
    assertEquals(result.data.search, "perceuse");
  } finally {
    await cleanupAwakeStreet(awake);
  }
});

Deno.test("GET /fil : les réponses publiques déjà données sont attachées à chaque demande, quel que soit son type", async () => {
  const awake = await createAwakeStreetWithUser("fil-16");
  let sought: { id: number } | undefined;

  try {
    sought = await createPost({
      userId: awake.created.id,
      type: "cherche",
      content: "Un bon plombier ?",
    });
    await createComment({
      userId: awake.created.id,
      postId: sought.id,
      content: "Dupont Plomberie, très sérieux",
    });

    const result = await handler.GET!(
      makeContext("http://localhost/fil", { user: awake.sessionUser }),
    ) as {
      data: {
        posts: { id: number; comments: { content: string }[] }[];
      };
    };

    assertEquals(
      result.data.posts.find((p) => p.id === sought!.id)?.comments.map((c) =>
        c.content
      ),
      ["Dupont Plomberie, très sérieux"],
    );
  } finally {
    if (sought) await db.delete(comment).where(eq(comment.postId, sought.id));
    await cleanupAwakeStreet(awake);
  }
});
