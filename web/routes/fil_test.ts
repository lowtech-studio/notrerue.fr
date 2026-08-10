import { assertEquals, assertStringIncludes } from "@std/assert";
import { eq } from "drizzle-orm";
import type { Context } from "fresh";
import type { SessionUser, State } from "../utils.ts";
import { db } from "../db/client.ts";
import { house, post, user } from "../db/schema.ts";
import { STREET_AWAKENING_THRESHOLD } from "../db/streets.ts";
import { registerInhabitant } from "../db/users.ts";
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
      "Merci de choisir un type et d'écrire votre demande.",
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
