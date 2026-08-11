import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import type { Context } from "fresh";
import type { SessionUser, State } from "../utils.ts";
import { db } from "../db/client.ts";
import { house, post, user } from "../db/schema.ts";
import { createPost } from "../db/posts.ts";
import { registerInhabitant } from "../db/users.ts";
import { cleanupTestStreet, createTestStreet } from "../db/test_helpers.ts";
import { handler } from "./modifier.ts";

function makeContext(
  options: { user?: SessionUser | null; form?: FormData } = {},
): Context<State> {
  return {
    url: new URL("http://localhost/modifier"),
    state: { user: options.user ?? null },
    redirect: (location: string) =>
      new Response(null, { status: 302, headers: { location } }),
    req: { formData: () => Promise.resolve(options.form ?? new FormData()) },
  } as unknown as Context<State>;
}

async function setupPost(
  label: string,
  type: "cherche" | "recommandation" = "cherche",
) {
  const testStreet = await createTestStreet(label);
  const { user: author } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `modifier-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const createdPost = await createPost({
    userId: author.id,
    type,
    content: "Je cherche une perceuse",
  });
  const { user: other } = await registerInhabitant({
    login: `login-o-${crypto.randomUUID()}`,
    email: `modifier-o-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const street = {
    id: testStreet.testStreet.id,
    name: testStreet.testStreet.name,
    city: { id: testStreet.testCity.id, name: testStreet.testCity.name },
  };
  const authorSession: SessionUser = {
    id: author.id,
    login: author.login,
    email: author.email,
    isAmbassador: author.isAmbassador,
    street,
  };
  const otherSession: SessionUser = {
    id: other.id,
    login: other.login,
    email: other.email,
    isAmbassador: other.isAmbassador,
    street,
  };
  return {
    testStreet,
    author,
    authorSession,
    other,
    otherSession,
    post: createdPost,
  };
}

async function teardown(setup: Awaited<ReturnType<typeof setupPost>>) {
  await db.delete(post).where(eq(post.id, setup.post.id));
  await db.delete(user).where(eq(user.id, setup.author.id));
  await db.delete(user).where(eq(user.id, setup.other.id));
  await db.delete(house).where(eq(house.id, setup.author.houseId));
  await db.delete(house).where(eq(house.id, setup.other.houseId));
  await cleanupTestStreet(setup.testStreet);
}

Deno.test("POST /modifier : non connecté → redirigé vers /connexion", async () => {
  const response = await handler.POST!(makeContext()) as Response;
  assertEquals(response.status, 302);
  assertEquals(response.headers.get("location"), "/connexion");
});

Deno.test("POST /modifier : propriétaire → contenu corrigé, back respecté", async () => {
  const setup = await setupPost("modifier-1");

  try {
    const form = new FormData();
    form.set("postId", String(setup.post.id));
    form.set("content", "Je cherche une perceuse à percussion");
    form.set("back", "/fil?type=cherche&page=2");

    const response = await handler.POST!(
      makeContext({ user: setup.authorSession, form }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(
      response.headers.get("location"),
      "/fil?type=cherche&page=2",
    );

    const [reloaded] = await db.select().from(post).where(
      eq(post.id, setup.post.id),
    );
    assertEquals(reloaded.content, "Je cherche une perceuse à percussion");
  } finally {
    await teardown(setup);
  }
});

Deno.test("POST /modifier : demande d'un autre utilisateur → ignoré, rien modifié", async () => {
  const setup = await setupPost("modifier-2");

  try {
    const form = new FormData();
    form.set("postId", String(setup.post.id));
    form.set("content", "Contenu piraté");

    const response = await handler.POST!(
      makeContext({ user: setup.otherSession, form }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/fil");

    const [reloaded] = await db.select().from(post).where(
      eq(post.id, setup.post.id),
    );
    assertEquals(reloaded.content, "Je cherche une perceuse");
  } finally {
    await teardown(setup);
  }
});

Deno.test("POST /modifier : recommandation → fallback /recommandations si back absent/invalide", async () => {
  const setup = await setupPost("modifier-3", "recommandation");

  try {
    const form = new FormData();
    form.set("postId", String(setup.post.id));
    form.set("content", "Un plombier fiable, corrigé");
    form.set("back", "https://evil.example/phishing");

    const response = await handler.POST!(
      makeContext({ user: setup.authorSession, form }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/recommandations");
  } finally {
    await teardown(setup);
  }
});

Deno.test("POST /modifier : contenu vide ou message agressif → ignoré, rien modifié", async () => {
  const setup = await setupPost("modifier-4");

  try {
    const emptyForm = new FormData();
    emptyForm.set("postId", String(setup.post.id));
    emptyForm.set("content", "");
    await handler.POST!(
      makeContext({ user: setup.authorSession, form: emptyForm }),
    );

    const blockedForm = new FormData();
    blockedForm.set("postId", String(setup.post.id));
    blockedForm.set("content", "Bande de connard, dégagez de ma rue");
    await handler.POST!(
      makeContext({ user: setup.authorSession, form: blockedForm }),
    );

    const [reloaded] = await db.select().from(post).where(
      eq(post.id, setup.post.id),
    );
    assertEquals(reloaded.content, "Je cherche une perceuse");
  } finally {
    await teardown(setup);
  }
});
