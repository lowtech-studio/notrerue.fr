import { assertEquals, assertExists } from "@std/assert";
import { eq } from "drizzle-orm";
import type { Context } from "fresh";
import type { SessionUser, State } from "../utils.ts";
import { db } from "../db/client.ts";
import { house, user } from "../db/schema.ts";
import { registerInhabitant } from "../db/users.ts";
import { cleanupTestStreet, createTestStreet } from "../db/test_helpers.ts";
import { handler } from "./profil.tsx";

function makeContext(
  options: { user?: SessionUser | null; form?: FormData; url?: string } = {},
): Context<State> {
  return {
    url: new URL(options.url ?? "http://localhost/profil"),
    state: { user: options.user ?? null },
    redirect: (location: string) =>
      new Response(null, { status: 302, headers: { location } }),
    req: { formData: () => Promise.resolve(options.form ?? new FormData()) },
  } as unknown as Context<State>;
}

async function setupUser(label: string, houseNumber: string | null = "12") {
  const testStreet = await createTestStreet(label);
  // Login tronqué à 8 caractères d'UUID : reste sous MAX_LOGIN_LENGTH (40)
  // même préfixé, pour que les comparaisons d'égalité dans les tests portent
  // sur la même valeur que celle réellement enregistrée (le handler tronque
  // tout login soumis à MAX_LOGIN_LENGTH).
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID().slice(0, 8)}`,
    email: `profil-${crypto.randomUUID()}@example.invalid`,
    houseNumber,
    streetId: testStreet.testStreet.id,
  });
  const street = {
    id: testStreet.testStreet.id,
    name: testStreet.testStreet.name,
    city: { id: testStreet.testCity.id, name: testStreet.testCity.name },
  };
  const session: SessionUser = {
    id: created.id,
    login: created.login,
    email: created.email,
    isAmbassador: created.isAmbassador,
    street,
    houseNumber,
  };
  return { testStreet, user: created, session };
}

async function teardown(
  ...setups: Awaited<ReturnType<typeof setupUser>>[]
) {
  for (const setup of setups) {
    await db.delete(user).where(eq(user.id, setup.user.id));
    await db.delete(house).where(eq(house.id, setup.user.houseId));
    await cleanupTestStreet(setup.testStreet);
  }
}

Deno.test("GET /profil : non connecté → redirigé vers /connexion", async () => {
  const response = await handler.GET!(makeContext()) as Response;
  assertEquals(response.status, 302);
  assertEquals(response.headers.get("location"), "/connexion");
});

Deno.test("GET /profil : connecté → login/e-mail/numéro/rue affichés, pas de bandeau par défaut", async () => {
  const setup = await setupUser("profil-1");
  try {
    const result = await handler.GET!(makeContext({ user: setup.session }));
    assertEquals(result, {
      data: {
        login: setup.session.login,
        email: setup.session.email,
        houseNumber: "12",
        streetName: setup.testStreet.testStreet.name,
        cityName: setup.testStreet.testCity.name,
        error: null,
        updated: false,
      },
    });
  } finally {
    await teardown(setup);
  }
});

Deno.test("GET /profil : ?updated=1 → bandeau de confirmation", async () => {
  const setup = await setupUser("profil-2");
  try {
    const result = await handler.GET!(
      makeContext({
        user: setup.session,
        url: "http://localhost/profil?updated=1",
      }),
    ) as { data: { updated: boolean } };
    assertEquals(result.data.updated, true);
  } finally {
    await teardown(setup);
  }
});

Deno.test("POST /profil : non connecté → redirigé vers /connexion", async () => {
  const response = await handler.POST!(makeContext()) as Response;
  assertEquals(response.status, 302);
  assertEquals(response.headers.get("location"), "/connexion");
});

Deno.test("POST /profil : login et numéro corrigés → enregistrés, redirection avec confirmation", async () => {
  const setup = await setupUser("profil-3");
  try {
    const newLogin = `login-${crypto.randomUUID().slice(0, 8)}`;
    const form = new FormData();
    form.set("login", newLogin);
    form.set("houseNumber", "14 bis");

    const response = await handler.POST!(
      makeContext({ user: setup.session, form }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/profil?updated=1");

    const [reloadedUser] = await db.select().from(user).where(
      eq(user.id, setup.user.id),
    );
    assertEquals(reloadedUser.login, newLogin);
    const [reloadedHouse] = await db.select().from(house).where(
      eq(house.id, setup.user.houseId),
    );
    assertEquals(reloadedHouse.number, "14 bis");
  } finally {
    await teardown(setup);
  }
});

Deno.test("POST /profil : numéro vidé → foyer sans numéro (facultatif)", async () => {
  const setup = await setupUser("profil-4");
  try {
    const form = new FormData();
    form.set("login", setup.session.login);
    form.set("houseNumber", "");

    await handler.POST!(makeContext({ user: setup.session, form }));

    const [reloadedHouse] = await db.select().from(house).where(
      eq(house.id, setup.user.houseId),
    );
    assertEquals(reloadedHouse.number, null);
  } finally {
    await teardown(setup);
  }
});

Deno.test("POST /profil : login vide → erreur, rien modifié", async () => {
  const setup = await setupUser("profil-5");
  try {
    const form = new FormData();
    form.set("login", "  ");
    form.set("houseNumber", "99");

    const result = await handler.POST!(
      makeContext({ user: setup.session, form }),
    ) as { data: { error: string | null } };
    assertExists(result.data.error);

    const [reloadedUser] = await db.select().from(user).where(
      eq(user.id, setup.user.id),
    );
    assertEquals(reloadedUser.login, setup.session.login);
  } finally {
    await teardown(setup);
  }
});

Deno.test("POST /profil : login déjà pris → erreur, rien modifié", async () => {
  const setupA = await setupUser("profil-6a");
  const setupB = await setupUser("profil-6b");
  try {
    const form = new FormData();
    form.set("login", setupB.session.login);
    form.set("houseNumber", "1");

    const result = await handler.POST!(
      makeContext({ user: setupA.session, form }),
    ) as { data: { error: string | null } };
    assertEquals(result.data.error, "Ce login est déjà utilisé.");

    const [reloadedUser] = await db.select().from(user).where(
      eq(user.id, setupA.user.id),
    );
    assertEquals(reloadedUser.login, setupA.session.login);
  } finally {
    await teardown(setupA, setupB);
  }
});
