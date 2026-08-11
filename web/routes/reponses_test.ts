import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import type { Context } from "fresh";
import type { SessionUser, State } from "../utils.ts";
import { db } from "../db/client.ts";
import { comment, house, post, street, user } from "../db/schema.ts";
import { listCommentsByPost } from "../db/comments.ts";
import { createPost } from "../db/posts.ts";
import { registerInhabitant } from "../db/users.ts";
import { cleanupTestStreet, createTestStreet } from "../db/test_helpers.ts";
import { handler } from "./reponses.ts";

function makeContext(
  options: { user?: SessionUser | null; form?: FormData } = {},
): Context<State> {
  return {
    url: new URL("http://localhost/reponses"),
    state: { user: options.user ?? null },
    redirect: (location: string) =>
      new Response(null, { status: 302, headers: { location } }),
    req: { formData: () => Promise.resolve(options.form ?? new FormData()) },
  } as unknown as Context<State>;
}

/** Demande de recommandation + son auteur, sur une rue/ville de test. */
async function setupRecommendation(label: string) {
  const testStreet = await createTestStreet(label);
  const { user: author } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `reponses-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const createdPost = await createPost({
    userId: author.id,
    type: "recommandation",
    content: "Un plombier fiable ?",
  });
  const authorSession: SessionUser = {
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
  return { testStreet, author, authorSession, post: createdPost };
}

async function teardown(
  setup: Awaited<ReturnType<typeof setupRecommendation>>,
) {
  await db.delete(comment).where(eq(comment.postId, setup.post.id));
  await db.delete(post).where(eq(post.id, setup.post.id));
  await db.delete(user).where(eq(user.id, setup.author.id));
  await db.delete(house).where(eq(house.id, setup.author.houseId));
  await cleanupTestStreet(setup.testStreet);
}

Deno.test("POST /reponses : non connecté → redirigé vers /connexion", async () => {
  const response = await handler.POST!(makeContext()) as Response;
  assertEquals(response.status, 302);
  assertEquals(response.headers.get("location"), "/connexion");
});

Deno.test("POST /reponses : réponse valide d'un voisin d'une autre rue de la même ville → enregistrée, page préservée", async () => {
  const setup = await setupRecommendation("reponses-1");
  const [otherStreetSameCity] = await db.insert(street).values({
    name: `Autre rue ${crypto.randomUUID()}`,
    cityId: setup.testStreet.testCity.id,
  }).returning();
  const { user: responder } = await registerInhabitant({
    login: `login-r-${crypto.randomUUID()}`,
    email: `reponses-r-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: otherStreetSameCity.id,
  });
  const responderSession: SessionUser = {
    id: responder.id,
    login: responder.login,
    email: responder.email,
    isAmbassador: responder.isAmbassador,
    street: {
      id: otherStreetSameCity.id,
      name: otherStreetSameCity.name,
      city: setup.authorSession.street.city,
    },
  };

  try {
    const form = new FormData();
    form.set("postId", String(setup.post.id));
    form.set("content", "Dupont Plomberie, très bien");
    form.set("page", "2");

    const response = await handler.POST!(
      makeContext({ user: responderSession, form }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(
      response.headers.get("location"),
      "/recommandations?page=2",
    );

    const commentsByPost = await listCommentsByPost([setup.post.id]);
    assertEquals(
      commentsByPost.get(setup.post.id)?.map((c) => c.content),
      ["Dupont Plomberie, très bien"],
    );
  } finally {
    // Ordre imposé par les FK : le commentaire du répondeur avant son
    // compte (`comment_user_id_user_id_fk`), sa rue avant `teardown(setup)`
    // qui supprime la ville partagée par les deux rues
    // (`street_city_id_city_id_fk`).
    await db.delete(comment).where(eq(comment.postId, setup.post.id));
    await db.delete(user).where(eq(user.id, responder.id));
    await db.delete(house).where(eq(house.id, responder.houseId));
    await db.delete(street).where(eq(street.id, otherStreetSameCity.id));
    await teardown(setup);
  }
});

Deno.test("POST /reponses : demande d'une autre ville → ignoré, rien enregistré", async () => {
  const setup = await setupRecommendation("reponses-2");
  const otherCity = await createTestStreet("reponses-2b");
  const { user: otherCityUser } = await registerInhabitant({
    login: `login-other-${crypto.randomUUID()}`,
    email: `reponses-other-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: otherCity.testStreet.id,
  });
  const otherCitySession: SessionUser = {
    id: otherCityUser.id,
    login: otherCityUser.login,
    email: otherCityUser.email,
    isAmbassador: otherCityUser.isAmbassador,
    street: {
      id: otherCity.testStreet.id,
      name: otherCity.testStreet.name,
      city: { id: otherCity.testCity.id, name: otherCity.testCity.name },
    },
  };

  try {
    const form = new FormData();
    form.set("postId", String(setup.post.id));
    form.set("content", "Une réponse qui ne devrait pas passer");

    const response = await handler.POST!(
      makeContext({ user: otherCitySession, form }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/recommandations");

    const commentsByPost = await listCommentsByPost([setup.post.id]);
    assertEquals(commentsByPost.get(setup.post.id), undefined);
  } finally {
    await db.delete(user).where(eq(user.id, otherCityUser.id));
    await db.delete(house).where(eq(house.id, otherCityUser.houseId));
    await cleanupTestStreet(otherCity);
    await teardown(setup);
  }
});

Deno.test("POST /reponses : demande d'un type autre que recommandation → ignoré, rien enregistré", async () => {
  const testStreet = await createTestStreet("reponses-3");
  const { user: author } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `reponses-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const filPost = await createPost({
    userId: author.id,
    type: "cherche",
    content: "Je cherche une perceuse",
  });
  const authorSession: SessionUser = {
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

  try {
    const form = new FormData();
    form.set("postId", String(filPost.id));
    form.set("content", "Une réponse qui ne devrait pas passer");

    const response = await handler.POST!(
      makeContext({ user: authorSession, form }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/recommandations");

    const commentsByPost = await listCommentsByPost([filPost.id]);
    assertEquals(commentsByPost.get(filPost.id), undefined);
  } finally {
    await db.delete(post).where(eq(post.id, filPost.id));
    await db.delete(user).where(eq(user.id, author.id));
    await db.delete(house).where(eq(house.id, author.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("POST /reponses : contenu vide ou postId invalide → ignoré sans planter", async () => {
  const setup = await setupRecommendation("reponses-4");

  try {
    const form = new FormData();
    form.set("postId", "pas-un-nombre");
    form.set("content", "Peu importe");

    const response = await handler.POST!(
      makeContext({ user: setup.authorSession, form }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("location"), "/recommandations");

    const commentsByPost = await listCommentsByPost([setup.post.id]);
    assertEquals(commentsByPost.get(setup.post.id), undefined);
  } finally {
    await teardown(setup);
  }
});

Deno.test("POST /reponses : recherche active (?q=) préservée dans la redirection", async () => {
  const setup = await setupRecommendation("reponses-5");

  try {
    const form = new FormData();
    form.set("postId", String(setup.post.id));
    form.set("content", "Dupont Plomberie");
    form.set("q", "plombier");

    const response = await handler.POST!(
      makeContext({ user: setup.authorSession, form }),
    ) as Response;
    assertEquals(response.status, 302);
    assertEquals(
      response.headers.get("location"),
      "/recommandations?q=plombier",
    );
  } finally {
    await teardown(setup);
  }
});
