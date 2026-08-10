import { assertEquals, assertStringIncludes } from "@std/assert";
import { and, eq } from "drizzle-orm";
import type { Context } from "fresh";
import type { SessionUser, State } from "../utils.ts";
import { db } from "../db/client.ts";
import { city, house, post, user } from "../db/schema.ts";
import { STREET_AWAKENING_THRESHOLD } from "../db/streets.ts";
import { registerInhabitant } from "../db/users.ts";
import {
  cleanupTestStreet,
  createTestCity,
  createTestStreet,
} from "../db/test_helpers.ts";
import { handler } from "./index.tsx";

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
    email: `index-${crypto.randomUUID()}@example.invalid`,
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

const EMPTY_POST_FORM_DATA = {
  postError: null,
  postPublished: false,
  postType: "cherche",
  postContent: "",
};

Deno.test("Page d'accueil : sans paramètre → aucun statut", async () => {
  const result = await handler.GET!(makeContext("http://localhost/"));
  assertEquals(result, {
    data: {
      street: "",
      cityId: null,
      cityLabel: "",
      status: null,
      ownStreetStatus: null,
      ...EMPTY_POST_FORM_DATA,
    },
  });
});

Deno.test("Page d'accueil : lien hérité /?rue=... (sans ville) → rue affichée mais pas de statut", async () => {
  const result = await handler.GET!(
    makeContext("http://localhost/?rue=Rue%20des%20Lilas"),
  );
  assertEquals(result, {
    data: {
      street: "Rue des Lilas",
      cityId: null,
      cityLabel: "",
      status: null,
      ownStreetStatus: null,
      ...EMPTY_POST_FORM_DATA,
    },
  });
});

Deno.test("Page d'accueil : rue jamais rejointe → statut « ambassadeur possible »", async () => {
  const testCity = await createTestCity("index-1");

  try {
    const url = `http://localhost/?cityId=${testCity.id}` +
      `&city=${encodeURIComponent(testCity.name)}` +
      `&street=${encodeURIComponent("Rue jamais rejointe")}`;
    const result = await handler.GET!(makeContext(url)) as {
      data: { status: unknown };
    };
    assertEquals(result.data.status, {
      street: null,
      housesCount: 0,
      remaining: STREET_AWAKENING_THRESHOLD,
      isAmbassadorSlot: true,
      isAwake: false,
    });
  } finally {
    await db.delete(city).where(eq(city.id, testCity.id));
  }
});

Deno.test("Page d'accueil : rue endormie avec des foyers → statut « il en manque N »", async () => {
  const { testCity, testStreet } = await createTestStreet("index-2");

  try {
    await db.insert(house).values([
      { streetId: testStreet.id },
      { streetId: testStreet.id },
    ]);

    const url = `http://localhost/?cityId=${testCity.id}` +
      `&city=${encodeURIComponent(testCity.name)}` +
      `&street=${encodeURIComponent(testStreet.name)}`;
    const result = await handler.GET!(makeContext(url)) as {
      data: {
        status: {
          housesCount: number;
          remaining: number;
          isAmbassadorSlot: boolean;
          isAwake: boolean;
        } | null;
      };
    };
    assertEquals(result.data.status?.housesCount, 2);
    assertEquals(
      result.data.status?.remaining,
      STREET_AWAKENING_THRESHOLD - 2,
    );
    assertEquals(result.data.status?.isAmbassadorSlot, false);
    assertEquals(result.data.status?.isAwake, false);
  } finally {
    await db.delete(house).where(eq(house.streetId, testStreet.id));
    await cleanupTestStreet({ testCity, testStreet });
  }
});

Deno.test("Page d'accueil : habitant connecté d'une rue non allumée → ownStreetStatus renseigné", async () => {
  const testStreet = await createTestStreet("index-3");
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `index-${crypto.randomUUID()}@example.invalid`,
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
    const result = await handler.GET!(
      makeContext("http://localhost/", { user: sessionUser }),
    ) as { data: { ownStreetStatus: unknown } };
    assertEquals(result.data.ownStreetStatus, {
      housesCount: 1,
      remaining: STREET_AWAKENING_THRESHOLD - 1,
      isAmbassadorSlot: false,
      isAwake: false,
    });
  } finally {
    await db.delete(user).where(eq(user.id, created.id));
    await db.delete(house).where(eq(house.id, created.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("Page d'accueil : non connecté → ownStreetStatus toujours null", async () => {
  const result = await handler.GET!(
    makeContext("http://localhost/"),
  ) as { data: { ownStreetStatus: unknown } };
  assertEquals(result.data.ownStreetStatus, null);
});

Deno.test("POST / : non connecté → redirigé vers /connexion", async () => {
  const response = await handler.POST!(
    makeContext("http://localhost/"),
  ) as Response;
  assertEquals(response.status, 302);
  assertEquals(response.headers.get("location"), "/connexion");
});

Deno.test("POST / : rue pas encore allumée → redirigé sans publier", async () => {
  const testStreet = await createTestStreet("index-4");
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `index-${crypto.randomUUID()}@example.invalid`,
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
      makeContext("http://localhost/", { user: sessionUser, form }),
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

Deno.test("POST / : contenu vide ou type invalide → erreur, rien en base", async () => {
  const awake = await createAwakeStreetWithUser("index-5");

  try {
    const form = new FormData();
    form.set("type", "n'importe quoi");
    form.set("content", "");

    const result = await handler.POST!(
      makeContext("http://localhost/", { user: awake.sessionUser, form }),
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

Deno.test("POST / : message agressif → bloqué, rien en base", async () => {
  const awake = await createAwakeStreetWithUser("index-6");

  try {
    const form = new FormData();
    form.set("type", "informe");
    form.set("content", "Bande de connard, dégagez de ma rue");

    const result = await handler.POST!(
      makeContext("http://localhost/", { user: awake.sessionUser, form }),
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

Deno.test("POST / : message valide sur une rue allumée → publié, redirection avec confirmation", async () => {
  const awake = await createAwakeStreetWithUser("index-7");

  try {
    const form = new FormData();
    form.set("type", "propose");
    form.set("content", "Je prête ma tondeuse ce week-end");

    const response = await handler.POST!(
      makeContext("http://localhost/", { user: awake.sessionUser, form }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/?published=1");

    const [created] = await db.select().from(post).where(
      and(eq(post.userId, awake.created.id), eq(post.type, "propose")),
    );
    assertEquals(created.content, "Je prête ma tondeuse ce week-end");
  } finally {
    await cleanupAwakeStreet(awake);
  }
});

Deno.test("GET / : ?published=1 pour un connecté → bandeau de confirmation", async () => {
  const awake = await createAwakeStreetWithUser("index-8");

  try {
    const result = await handler.GET!(
      makeContext("http://localhost/?published=1", {
        user: awake.sessionUser,
      }),
    ) as { data: { postPublished: boolean } };
    assertEquals(result.data.postPublished, true);
  } finally {
    await cleanupAwakeStreet(awake);
  }
});
