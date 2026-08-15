import { assertEquals, assertExists } from "@std/assert";
import { App } from "fresh";
import type { Context } from "fresh";
import { eq } from "drizzle-orm";
import type { State } from "../utils.ts";
import { db } from "../db/client.ts";
import { house, user } from "../db/schema.ts";
import { registerInhabitant } from "../db/users.ts";
import { cleanupTestStreet, createTestStreet } from "../db/test_helpers.ts";
import { parseCookies } from "../utils/cookies.ts";
import { SESSION_COOKIE } from "../utils/session.ts";
import { handler as middlewareHandler } from "./_middleware.ts";
import { handler as connexionHandler } from "./connexion.tsx";

function makeContext(
  options: { url?: string; form?: FormData } = {},
): Context<State> {
  return {
    url: new URL(options.url ?? "http://localhost/connexion"),
    state: { user: null },
    redirect: (location: string) =>
      new Response(null, { status: 302, headers: { location } }),
    req: { formData: () => Promise.resolve(options.form ?? new FormData()) },
  } as unknown as Context<State>;
}

/**
 * Intégration réelle (App Fresh + Postgres réel), même technique que les
 * tests d'auth du template dont ce projet reprend l'infra session/cookies :
 * `App.handler()` sans `fsRoutes()` ni pipeline de rendu de page. Le handler
 * de connexion.tsx renvoie soit une `Response` (code valide), soit un objet
 * `{ data }` pour re-rendu du formulaire (code invalide) — pas géré par cette
 * App minimale, adapté ici en réponse factice.
 */
function buildTestHandler() {
  const app = new App<State>();
  app.use(middlewareHandler);
  app.post("/connexion", async (ctx) => {
    const res = await connexionHandler.POST(ctx);
    return res instanceof Response ? res : new Response(null, { status: 200 });
  });
  app.get("/__probe", (ctx) => {
    return new Response(JSON.stringify(ctx.state.user), {
      headers: { "content-type": "application/json" },
    });
  });
  return app.handler();
}

Deno.test("GET /connexion : sans e-mail → étape 'email', avec e-mail → étape 'code'", async () => {
  const stepEmail = await connexionHandler.GET!(makeContext());
  assertEquals(stepEmail, {
    data: { email: "", error: null, step: "email", sent: false },
  });

  const stepCode = await connexionHandler.GET!(
    makeContext({
      url: "http://localhost/connexion?email=camille%40exemple.fr&sent=1",
    }),
  );
  assertEquals(stepCode, {
    data: {
      email: "camille@exemple.fr",
      error: null,
      step: "code",
      sent: true,
    },
  });
});

Deno.test("POST /connexion : demande de code sans champ `code` → validation de l'e-mail", async () => {
  const emptyForm = new FormData();
  emptyForm.set("email", "pas-un-email");
  const invalidResult = await connexionHandler.POST!(
    makeContext({ form: emptyForm }),
  );
  assertEquals(invalidResult, {
    data: {
      email: "pas-un-email",
      step: "email",
      sent: false,
      error: "Merci de renseigner un e-mail valide.",
    },
  });
});

Deno.test("POST /connexion : e-mail inconnu → même redirection qu'un e-mail inscrit (pas d'énumération de comptes)", async () => {
  const unknownForm = new FormData();
  unknownForm.set("email", `inconnu-${crypto.randomUUID()}@example.invalid`);
  const unknownResult = await connexionHandler.POST!(
    makeContext({ form: unknownForm }),
  ) as Response;
  assertEquals(unknownResult instanceof Response, true);
  assertEquals(unknownResult.status, 302);
  assertEquals(
    unknownResult.headers.get("location")?.includes("&sent=1"),
    true,
  );
});

Deno.test("POST /connexion : e-mail échoue à l'envoi → erreur affichée plutôt qu'une 500 brute, rien ne bloque l'utilisateur", async () => {
  // Intégration réelle vers Brevo (même logique que taps_test.ts/
  // reponses_test.ts pour leurs notifications), forcée en échec via une
  // clé délibérément invalide plutôt que de dépendre de la validité
  // (changeante) de la vraie clé de l'environnement de test — déterministe
  // dans un sens comme dans l'autre, restaurée dans `finally`.
  const realApiKey = Deno.env.get("BREVO_API_KEY");
  Deno.env.set("BREVO_API_KEY", "invalid-test-key");

  const testStreet = await createTestStreet("connexion-email-failure");
  const email = `connexion-fail-${crypto.randomUUID()}@example.invalid`;
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  // `registerInhabitant` pose déjà `loginCodeSentAt` : on le recule pour
  // sortir de la fenêtre de throttle et retomber dans le cas "sent", celui
  // qui déclenche réellement `sendLoginCodeEmail`.
  await db.update(user).set({
    loginCodeSentAt: new Date(Date.now() - 120_000),
  }).where(eq(user.id, created.id));

  try {
    const form = new FormData();
    form.set("email", email);
    const result = await connexionHandler.POST!(makeContext({ form }));
    assertEquals(result, {
      data: {
        email,
        step: "email",
        sent: false,
        error: "Erreur d'envoi de l'e-mail — réessayez dans quelques instants.",
      },
    });
  } finally {
    if (realApiKey === undefined) {
      Deno.env.delete("BREVO_API_KEY");
    } else {
      Deno.env.set("BREVO_API_KEY", realApiKey);
    }
    await db.delete(user).where(eq(user.id, created.id));
    await db.delete(house).where(eq(house.id, created.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("POST /connexion : code valide pose un cookie de session qui authentifie ensuite les requêtes", async (t) => {
  const testStreet = await createTestStreet("connexion-1");

  const email = `connexion-${crypto.randomUUID()}@example.invalid`;
  const { user: created, code } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });

  const handle = buildTestHandler();
  let sessionCookieValue = "";

  try {
    await t.step("code incorrect ne pose pas de cookie", async () => {
      const form = new FormData();
      form.set("email", email);
      form.set("code", "000000");
      const res = await handle(
        new Request("http://localhost/connexion", {
          method: "POST",
          body: form,
        }),
      );
      assertEquals(res.headers.get("set-cookie"), null);
    });

    await t.step(
      "code correct pose un cookie de session valide",
      async () => {
        const form = new FormData();
        form.set("email", email);
        form.set("code", code);
        const res = await handle(
          new Request("http://localhost/connexion", {
            method: "POST",
            body: form,
          }),
        );
        assertEquals(res.status, 302);
        assertEquals(res.headers.get("location"), "/");

        const setCookie = res.headers.get("set-cookie");
        assertExists(setCookie);
        sessionCookieValue =
          parseCookies(setCookie!.split(";")[0])[SESSION_COOKIE];
        assertExists(sessionCookieValue);
      },
    );

    await t.step(
      "requête avec le cookie → state.user peuplé avec la rue et la ville",
      async () => {
        const res = await handle(
          new Request("http://localhost/__probe", {
            headers: {
              cookie: `${SESSION_COOKIE}=${
                encodeURIComponent(sessionCookieValue)
              }`,
            },
          }),
        );
        const body = await res.json();
        assertEquals(body.id, created.id);
        assertEquals(body.isAmbassador, true);
        assertEquals(body.street.name, "Rue de test connexion-1");
        assertEquals(body.street.city.name, "Ville de test connexion-1");
      },
    );

    await t.step(
      "le code, une fois utilisé, ne fonctionne plus (usage unique)",
      async () => {
        const form = new FormData();
        form.set("email", email);
        form.set("code", code);
        const res = await handle(
          new Request("http://localhost/connexion", {
            method: "POST",
            body: form,
          }),
        );
        assertEquals(res.headers.get("set-cookie"), null);
      },
    );
  } finally {
    await db.delete(user).where(eq(user.id, created.id));
    await db.delete(house).where(eq(house.id, created.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("POST /connexion : renvoi du code moins de 60 s après le précédent → nouvelle redirection sans erreur (throttle silencieux)", async () => {
  const testStreet = await createTestStreet("connexion-2");
  const email = `connexion-throttle-${crypto.randomUUID()}@example.invalid`;
  const { user: created } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });

  try {
    const form = new FormData();
    form.set("email", email);
    // `registerInhabitant` vient déjà de poser `loginCodeSentAt` : ce renvoi
    // tombe dans la fenêtre de throttle. La réponse doit rester une
    // redirection normale (pas d'erreur) pour ne rien laisser deviner.
    const result = await connexionHandler.POST!(makeContext({ form }));
    assertEquals(result instanceof Response, true);
    assertEquals((result as Response).status, 302);
  } finally {
    await db.delete(user).where(eq(user.id, created.id));
    await db.delete(house).where(eq(house.id, created.houseId));
    await cleanupTestStreet(testStreet);
  }
});
