import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import type { Context } from "fresh";
import type { SessionUser, State } from "../utils.ts";
import { db } from "../db/client.ts";
import { house, user } from "../db/schema.ts";
import { registerInhabitant } from "../db/users.ts";
import { cleanupTestStreet, createTestStreet } from "../db/test_helpers.ts";
import { handler } from "./rejoindre.tsx";

const SESSION_USER: SessionUser = {
  id: 1,
  login: "camille",
  email: "camille@exemple.fr",
  isAmbassador: true,
  street: { id: 1, name: "Rue des Lilas", city: { id: 1, name: "Nantes" } },
};

function makeContext(
  options: { user?: SessionUser | null; form?: FormData; url?: string } = {},
): Context<State> {
  return {
    url: new URL(options.url ?? "http://localhost/rejoindre"),
    state: { user: options.user ?? null },
    redirect: (location: string) =>
      new Response(null, { status: 302, headers: { location } }),
    req: { formData: () => Promise.resolve(options.form ?? new FormData()) },
  } as unknown as Context<State>;
}

const EMPTY_FORM_DATA = {
  login: "",
  email: "",
  houseNumber: "",
  streetName: "",
  cityId: null,
  cityLabel: "",
  willBeAmbassador: true,
  ageConfirmed: false,
};

Deno.test("GET /rejoindre : non connecté → affiche le formulaire", async () => {
  const result = await handler.GET!(makeContext());
  assertEquals(result, { data: { error: null, ...EMPTY_FORM_DATA } });
});

Deno.test("GET /rejoindre : déjà connecté → redirigé vers /", async () => {
  const result = await handler.GET!(makeContext({ user: SESSION_USER }));
  assertEquals(result instanceof Response, true);
  assertEquals((result as Response).status, 302);
  assertEquals((result as Response).headers.get("location"), "/");
});

Deno.test("POST /rejoindre : déjà connecté → redirigé vers / sans traitement du formulaire", async () => {
  const result = await handler.POST!(makeContext({ user: SESSION_USER }));
  assertEquals(result instanceof Response, true);
  assertEquals((result as Response).status, 302);
});

Deno.test("POST /rejoindre : champs manquants → erreur, pas d'écriture en base", async () => {
  const form = new FormData();
  form.set("login", "");
  const result = await handler.POST!(makeContext({ form }));
  assertEquals(
    result,
    {
      data: {
        ...EMPTY_FORM_DATA,
        error:
          // Contrôlée avant le reste : formulaire vide ⇒ case d'âge non
          // cochée aussi, c'est cette erreur-là qui remonte en premier.
          "Merci de confirmer avoir plus de 15 ans pour vous inscrire (seuil légal du consentement numérique en France).",
      },
    },
  );
});

Deno.test("POST /rejoindre : case d'âge non cochée → erreur dédiée même avec le reste du formulaire complet", async () => {
  const form = new FormData();
  form.set("login", "camille");
  form.set("email", "camille@exemple.fr");
  form.set("street", "Rue des Lilas");
  form.set("cityId", "1");
  const result = await handler.POST!(makeContext({ form }));
  assertEquals(
    result,
    {
      data: {
        login: "camille",
        email: "camille@exemple.fr",
        houseNumber: "",
        streetName: "Rue des Lilas",
        cityId: 1,
        cityLabel: "",
        willBeAmbassador: true,
        ageConfirmed: false,
        error:
          "Merci de confirmer avoir plus de 15 ans pour vous inscrire (seuil légal du consentement numérique en France).",
      },
    },
  );
});

Deno.test("POST /rejoindre : e-mail sans @ → erreur de validation, le reste du formulaire est réaffiché", async () => {
  const form = new FormData();
  form.set("login", "camille");
  form.set("email", "pas-un-email");
  form.set("street", "Rue des Lilas");
  form.set("cityId", "1");
  form.set("ageConfirmed", "on");
  const result = await handler.POST!(makeContext({ form }));
  assertEquals(
    result,
    {
      data: {
        login: "camille",
        email: "pas-un-email",
        houseNumber: "",
        streetName: "Rue des Lilas",
        cityId: 1,
        cityLabel: "",
        willBeAmbassador: true,
        ageConfirmed: true,
        error:
          "Merci de renseigner un login, un e-mail valide, et de choisir votre ville et votre rue dans les suggestions.",
      },
    },
  );
});

Deno.test("POST /rejoindre : ville inconnue → erreur dédiée, cityId réinitialisé mais le reste du formulaire réaffiché", async () => {
  const form = new FormData();
  form.set("login", "camille");
  form.set("email", "camille@exemple.fr");
  form.set("street", "Rue des Lilas");
  form.set("houseNumber", "14");
  form.set("cityId", "999999999");
  form.set("ageConfirmed", "on");
  const result = await handler.POST!(makeContext({ form }));
  assertEquals(
    result,
    {
      data: {
        login: "camille",
        email: "camille@exemple.fr",
        houseNumber: "14",
        streetName: "Rue des Lilas",
        cityId: null,
        cityLabel: "",
        willBeAmbassador: true,
        ageConfirmed: true,
        error: "Merci de choisir votre ville dans la liste proposée.",
      },
    },
  );
});

Deno.test("GET /rejoindre : rue déjà occupée (via cityId/street en query, lien court sans `city`) → pré-rempli, pas ambassadeur", async () => {
  const testStreet = await createTestStreet("rejoindre-1");
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `rejoindre-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });

  try {
    // Lien de partage raccourci (cf. revue) : `city` n'est plus émis, le
    // libellé ville est reconstruit depuis `cityId` en base.
    const url = `http://localhost/rejoindre?cityId=${testStreet.testCity.id}` +
      `&street=${encodeURIComponent(testStreet.testStreet.name)}`;
    const result = await handler.GET!(makeContext({ url })) as {
      data: {
        cityId: number;
        cityLabel: string;
        streetName: string;
        willBeAmbassador: boolean;
      };
    };
    assertEquals(result.data.cityId, testStreet.testCity.id);
    assertEquals(
      result.data.cityLabel,
      `${testStreet.testCity.name} (${testStreet.testCity.department})`,
    );
    assertEquals(result.data.streetName, testStreet.testStreet.name);
    assertEquals(result.data.willBeAmbassador, false);
  } finally {
    await db.delete(user).where(eq(user.id, created.id));
    await db.delete(house).where(eq(house.id, created.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("GET /rejoindre : ancien lien avec `city` en trop → toujours pré-rempli, le paramètre superflu est ignoré", async () => {
  const testStreet = await createTestStreet("rejoindre-1b");
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `rejoindre-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });

  try {
    const url = `http://localhost/rejoindre?cityId=${testStreet.testCity.id}` +
      `&city=${encodeURIComponent("Un ancien libellé quelconque")}` +
      `&street=${encodeURIComponent(testStreet.testStreet.name)}`;
    const result = await handler.GET!(makeContext({ url })) as {
      data: { cityId: number; cityLabel: string };
    };
    assertEquals(result.data.cityId, testStreet.testCity.id);
    // Le `city` de l'URL n'est plus lu : le libellé vient bien de la base,
    // pas de l'ancien paramètre.
    assertEquals(
      result.data.cityLabel,
      `${testStreet.testCity.name} (${testStreet.testCity.department})`,
    );
  } finally {
    await db.delete(user).where(eq(user.id, created.id));
    await db.delete(house).where(eq(house.id, created.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("GET /rejoindre : cityId inexistant en base → pas de pré-remplissage, pas de plantage", async () => {
  const url = `http://localhost/rejoindre?cityId=999999999&street=${
    encodeURIComponent("Rue des Lilas")
  }`;
  const result = await handler.GET!(makeContext({ url })) as {
    data: { cityId: number | null; cityLabel: string };
  };
  assertEquals(result.data.cityId, null);
  assertEquals(result.data.cityLabel, "");
});
