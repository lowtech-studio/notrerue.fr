import { assert, assertEquals, assertFalse } from "@std/assert";
import { eq } from "drizzle-orm";
import { db } from "./client.ts";
import { city, comment, house, post, street, user } from "./schema.ts";
import {
  computeExpiresAt,
  createPost,
  isFilPostType,
  isPostDuration,
  isPostType,
  listCityRecommendations,
  listStreetPosts,
  MAX_POST_DURATION_MONTHS,
  MIN_POST_DURATION_MONTHS,
  postListPath,
  POSTS_PER_PAGE,
  softDeletePost,
  updatePostContent,
} from "./posts.ts";
import { createComment } from "./comments.ts";
import { registerInhabitant } from "./users.ts";
import {
  cleanupTestStreet,
  createTestCity,
  createTestStreet,
} from "./test_helpers.ts";

Deno.test("isPostType : accepte les quatre valeurs de l'enum, rejette le reste", () => {
  assert(isPostType("cherche"));
  assert(isPostType("propose"));
  assert(isPostType("informe"));
  assert(isPostType("recommandation"));
  assertFalse(isPostType("autre chose"));
  assertFalse(isPostType(""));
});

Deno.test("isFilPostType : accepte les trois types de /fil, rejette 'recommandation' et le reste", () => {
  assert(isFilPostType("cherche"));
  assert(isFilPostType("propose"));
  assert(isFilPostType("informe"));
  assertFalse(isFilPostType("recommandation"));
  assertFalse(isFilPostType("autre chose"));
  assertFalse(isFilPostType(""));
});

Deno.test("isPostDuration : accepte les trois durées, rejette le reste", () => {
  assert(isPostDuration("today"));
  assert(isPostDuration("week"));
  assert(isPostDuration("months"));
  assertFalse(isPostDuration("year"));
  assertFalse(isPostDuration(""));
});

Deno.test("computeExpiresAt : durées fixes (today/week) depuis l'instant donné", () => {
  const now = new Date("2026-01-01T10:00:00Z");

  assertEquals(
    computeExpiresAt("today", 1, now).toISOString(),
    "2026-01-02T10:00:00.000Z",
  );
  assertEquals(
    computeExpiresAt("week", 1, now).toISOString(),
    "2026-01-08T10:00:00.000Z",
  );
});

Deno.test('computeExpiresAt : "months" ajoute le nombre de mois donné', () => {
  const now = new Date("2026-01-15T10:00:00Z");
  const expiresAt = computeExpiresAt("months", 3, now);

  // Comparé en champs locaux plutôt qu'en ISO/UTC : `setMonth` (heure locale
  // inchangée) traverse ici un passage à l'heure d'été, qui décale
  // l'instant UTC équivalent d'une heure — pas un bug, l'heure du jour
  // perçue par l'habitant reste la même.
  assertEquals(expiresAt.getFullYear(), 2026);
  assertEquals(expiresAt.getMonth(), 3); // avril (0-indexé)
  assertEquals(expiresAt.getDate(), now.getDate());
  assertEquals(expiresAt.getHours(), now.getHours());
});

Deno.test('computeExpiresAt : "months" plafonne un nombre hors bornes', () => {
  const now = new Date("2026-01-15T10:00:00Z");

  assertEquals(
    computeExpiresAt("months", 0, now).toISOString(),
    computeExpiresAt("months", MIN_POST_DURATION_MONTHS, now).toISOString(),
  );
  assertEquals(
    computeExpiresAt("months", 99, now).toISOString(),
    computeExpiresAt("months", MAX_POST_DURATION_MONTHS, now).toISOString(),
  );
});

Deno.test("createPost : enregistre le type et le contenu pour l'auteur donné", async () => {
  const testStreet = await createTestStreet("posts-1");
  const { user: author } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `posts-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });

  try {
    const created = await createPost({
      userId: author.id,
      type: "propose",
      content: "Je prête ma tondeuse ce week-end",
    });

    assertEquals(created.userId, author.id);
    assertEquals(created.type, "propose");
    assertEquals(created.content, "Je prête ma tondeuse ce week-end");
    assertEquals(created.deletedAt, null);

    const [reloaded] = await db.select().from(post).where(
      eq(post.id, created.id),
    );
    assertEquals(reloaded.content, "Je prête ma tondeuse ce week-end");
  } finally {
    await db.delete(post).where(eq(post.userId, author.id));
    await db.delete(user).where(eq(user.id, author.id));
    await db.delete(house).where(eq(house.id, author.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("listStreetPosts : chronologique (plus récent d'abord), isolé par rue", async () => {
  const streetA = await createTestStreet("posts-2a");
  const streetB = await createTestStreet("posts-2b");
  const { user: authorA } = await registerInhabitant({
    login: `login-a-${crypto.randomUUID()}`,
    email: `posts-a-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: streetA.testStreet.id,
  });
  const { user: authorB } = await registerInhabitant({
    login: `login-b-${crypto.randomUUID()}`,
    email: `posts-b-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: streetB.testStreet.id,
  });

  try {
    const first = await createPost({
      userId: authorA.id,
      type: "cherche",
      content: "Premier message (rue A)",
    });
    const second = await createPost({
      userId: authorA.id,
      type: "informe",
      content: "Second message (rue A)",
    });
    await createPost({
      userId: authorB.id,
      type: "cherche",
      content: "Message sur l'autre rue",
    });

    const result = await listStreetPosts({
      streetId: streetA.testStreet.id,
      page: 1,
    });

    assertEquals(result.totalCount, 2);
    assertEquals(result.posts.map((p) => p.id), [second.id, first.id]);
    assertEquals(result.posts[0].authorLogin, authorA.login);
  } finally {
    await db.delete(post).where(eq(post.userId, authorA.id));
    await db.delete(post).where(eq(post.userId, authorB.id));
    await db.delete(user).where(eq(user.id, authorA.id));
    await db.delete(user).where(eq(user.id, authorB.id));
    await db.delete(house).where(eq(house.id, authorA.houseId));
    await db.delete(house).where(eq(house.id, authorB.houseId));
    await cleanupTestStreet(streetA);
    await cleanupTestStreet(streetB);
  }
});

Deno.test("listStreetPosts : filtre par type", async () => {
  const testStreet = await createTestStreet("posts-3");
  const { user: author } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `posts-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });

  try {
    await createPost({
      userId: author.id,
      type: "cherche",
      content: "Je cherche une perceuse",
    });
    const proposed = await createPost({
      userId: author.id,
      type: "propose",
      content: "Je prête ma tondeuse",
    });

    const result = await listStreetPosts({
      streetId: testStreet.testStreet.id,
      type: "propose",
      page: 1,
    });

    assertEquals(result.totalCount, 1);
    assertEquals(result.posts.map((p) => p.id), [proposed.id]);
  } finally {
    await db.delete(post).where(eq(post.userId, author.id));
    await db.delete(user).where(eq(user.id, author.id));
    await db.delete(house).where(eq(house.id, author.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("listStreetPosts : recherche sur le contenu, combinable avec le filtre de type, isolée par rue", async () => {
  const streetA = await createTestStreet("posts-3c");
  const streetB = await createTestStreet("posts-3d");
  const { user: authorA } = await registerInhabitant({
    login: `login-a-${crypto.randomUUID()}`,
    email: `posts-a-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: streetA.testStreet.id,
  });
  const { user: authorB } = await registerInhabitant({
    login: `login-b-${crypto.randomUUID()}`,
    email: `posts-b-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: streetB.testStreet.id,
  });

  try {
    const matching = await createPost({
      userId: authorA.id,
      type: "cherche",
      content: "Je cherche une perceuse",
    });
    await createPost({
      userId: authorA.id,
      type: "propose",
      content: "Je prête ma tondeuse",
    });
    // Même mot, autre rue : ne doit pas remonter.
    await createPost({
      userId: authorB.id,
      type: "cherche",
      content: "Je cherche une perceuse aussi",
    });

    const result = await listStreetPosts({
      streetId: streetA.testStreet.id,
      search: "perceuse",
      page: 1,
    });
    assertEquals(result.posts.map((p) => p.id), [matching.id]);

    // Combiné avec le filtre de type : la demande "propose" ne contient pas
    // "perceuse", donc rien ne remonte.
    const combined = await listStreetPosts({
      streetId: streetA.testStreet.id,
      type: "propose",
      search: "perceuse",
      page: 1,
    });
    assertEquals(combined.posts, []);
  } finally {
    await db.delete(post).where(eq(post.userId, authorA.id));
    await db.delete(post).where(eq(post.userId, authorB.id));
    await db.delete(user).where(eq(user.id, authorA.id));
    await db.delete(user).where(eq(user.id, authorB.id));
    await db.delete(house).where(eq(house.id, authorA.houseId));
    await db.delete(house).where(eq(house.id, authorB.houseId));
    await cleanupTestStreet(streetA);
    await cleanupTestStreet(streetB);
  }
});

Deno.test("listStreetPosts : exclut toujours les demandes de recommandation, même sans filtre de type", async () => {
  const testStreet = await createTestStreet("posts-3b");
  const { user: author } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `posts-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });

  try {
    const sought = await createPost({
      userId: author.id,
      type: "cherche",
      content: "Je cherche une perceuse",
    });
    // Une recommandation appartient à /recommandations (ville), jamais à
    // /fil (rue), même si son auteur habite bien cette rue.
    await createPost({
      userId: author.id,
      type: "recommandation",
      content: "Un dentiste qui prend des patients ?",
    });

    const result = await listStreetPosts({
      streetId: testStreet.testStreet.id,
      page: 1,
    });

    assertEquals(result.totalCount, 1);
    assertEquals(result.posts.map((p) => p.id), [sought.id]);
  } finally {
    await db.delete(post).where(eq(post.userId, author.id));
    await db.delete(user).where(eq(user.id, author.id));
    await db.delete(house).where(eq(house.id, author.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("listStreetPosts : exclut les demandes expirées, garde celles sans expiresAt", async () => {
  const testStreet = await createTestStreet("posts-5");
  const { user: author } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `posts-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const now = new Date();
  const past = new Date(now.getTime() - 60_000);
  const future = new Date(now.getTime() + 60_000);

  try {
    const expired = await createPost({
      userId: author.id,
      type: "cherche",
      content: "Demande expirée",
      expiresAt: past,
    });
    const stillValid = await createPost({
      userId: author.id,
      type: "cherche",
      content: "Demande encore valide",
      expiresAt: future,
    });
    // `expiresAt` nul (demande publiée avant cette fonctionnalité) : reste
    // visible indéfiniment plutôt que de disparaître rétroactivement.
    const [legacy] = await db.insert(post).values({
      userId: author.id,
      type: "informe",
      content: "Demande sans date d'expiration",
      expiresAt: null,
    }).returning();

    const result = await listStreetPosts({
      streetId: testStreet.testStreet.id,
      page: 1,
      now,
    });

    const ids = result.posts.map((p) => p.id);
    assertEquals(ids.includes(expired.id), false);
    assertEquals(ids.includes(stillValid.id), true);
    assertEquals(ids.includes(legacy.id), true);
  } finally {
    await db.delete(post).where(eq(post.userId, author.id));
    await db.delete(user).where(eq(user.id, author.id));
    await db.delete(house).where(eq(house.id, author.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("listStreetPosts : pagine et ramène une page hors bornes dans les limites", async () => {
  const testStreet = await createTestStreet("posts-4");
  const { user: author } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `posts-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });

  try {
    const count = POSTS_PER_PAGE + 3;
    await db.insert(post).values(
      Array.from({ length: count }, (_, i) => ({
        userId: author.id,
        type: "informe" as const,
        content: `Message ${i}`,
      })),
    );

    const firstPage = await listStreetPosts({
      streetId: testStreet.testStreet.id,
      page: 1,
    });
    assertEquals(firstPage.totalCount, count);
    assertEquals(firstPage.totalPages, 2);
    assertEquals(firstPage.posts.length, POSTS_PER_PAGE);

    const secondPage = await listStreetPosts({
      streetId: testStreet.testStreet.id,
      page: 2,
    });
    assertEquals(secondPage.posts.length, 3);

    // Page demandée au-delà du nombre de pages → ramenée à la dernière.
    const outOfRange = await listStreetPosts({
      streetId: testStreet.testStreet.id,
      page: 99,
    });
    assertEquals(outOfRange.page, 2);
  } finally {
    await db.delete(post).where(eq(post.userId, author.id));
    await db.delete(user).where(eq(user.id, author.id));
    await db.delete(house).where(eq(house.id, author.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("listCityRecommendations : chronologique, toute la ville (plusieurs rues), isolé par ville, seulement le type recommandation", async () => {
  const cityA = await createTestCity("posts-reco-1a");
  const [streetX] = await db.insert(street).values({
    name: `Rue X ${crypto.randomUUID()}`,
    cityId: cityA.id,
  }).returning();
  const [streetY] = await db.insert(street).values({
    name: `Rue Y ${crypto.randomUUID()}`,
    cityId: cityA.id,
  }).returning();
  // Même nom de rue qu'une autre ville, pour vérifier que l'isolement se
  // fait bien par ville et non par nom de rue.
  const otherCityStreet = await createTestStreet("posts-reco-1b");

  const { user: authorX } = await registerInhabitant({
    login: `login-x-${crypto.randomUUID()}`,
    email: `posts-reco-x-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: streetX.id,
  });
  const { user: authorY } = await registerInhabitant({
    login: `login-y-${crypto.randomUUID()}`,
    email: `posts-reco-y-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: streetY.id,
  });
  const { user: authorOtherCity } = await registerInhabitant({
    login: `login-z-${crypto.randomUUID()}`,
    email: `posts-reco-z-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: otherCityStreet.testStreet.id,
  });

  try {
    const first = await createPost({
      userId: authorX.id,
      type: "recommandation",
      content: "Un plombier fiable, rue X",
    });
    const second = await createPost({
      userId: authorY.id,
      type: "recommandation",
      content: "Un dentiste qui prend des patients, rue Y",
    });
    // Ni "cherche" (autre type, réservé à /fil) ni une recommandation d'une
    // autre ville ne doivent apparaître.
    await createPost({
      userId: authorX.id,
      type: "cherche",
      content: "Je cherche une perceuse",
    });
    await createPost({
      userId: authorOtherCity.id,
      type: "recommandation",
      content: "Recommandation d'une autre ville",
    });

    const result = await listCityRecommendations({ cityId: cityA.id, page: 1 });

    assertEquals(result.totalCount, 2);
    assertEquals(result.posts.map((p) => p.id), [second.id, first.id]);
    assertEquals(result.posts[0].authorStreetName, streetY.name);
    assertEquals(result.posts[1].authorStreetName, streetX.name);
  } finally {
    await db.delete(post).where(eq(post.userId, authorX.id));
    await db.delete(post).where(eq(post.userId, authorY.id));
    await db.delete(post).where(eq(post.userId, authorOtherCity.id));
    await db.delete(user).where(eq(user.id, authorX.id));
    await db.delete(user).where(eq(user.id, authorY.id));
    await db.delete(user).where(eq(user.id, authorOtherCity.id));
    await db.delete(house).where(eq(house.id, authorX.houseId));
    await db.delete(house).where(eq(house.id, authorY.houseId));
    await db.delete(house).where(eq(house.id, authorOtherCity.houseId));
    await db.delete(street).where(eq(street.id, streetX.id));
    await db.delete(street).where(eq(street.id, streetY.id));
    await db.delete(city).where(eq(city.id, cityA.id));
    await cleanupTestStreet(otherCityStreet);
  }
});

Deno.test("listCityRecommendations : exclut les demandes expirées, garde celles sans expiresAt", async () => {
  const testStreet = await createTestStreet("posts-reco-2");
  const { user: author } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `posts-reco-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const now = new Date();

  try {
    const expired = await createPost({
      userId: author.id,
      type: "recommandation",
      content: "Recommandation expirée",
      expiresAt: new Date(now.getTime() - 60_000),
    });
    const stillValid = await createPost({
      userId: author.id,
      type: "recommandation",
      content: "Recommandation encore valide",
      expiresAt: new Date(now.getTime() + 60_000),
    });

    const result = await listCityRecommendations({
      cityId: testStreet.testCity.id,
      page: 1,
      now,
    });

    const ids = result.posts.map((p) => p.id);
    assertEquals(ids.includes(expired.id), false);
    assertEquals(ids.includes(stillValid.id), true);
  } finally {
    await db.delete(post).where(eq(post.userId, author.id));
    await db.delete(user).where(eq(user.id, author.id));
    await db.delete(house).where(eq(house.id, author.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("listCityRecommendations : recherche sur la demande ET sur les réponses déjà données", async () => {
  const testStreet = await createTestStreet("posts-reco-3");
  const { user: author } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `posts-reco-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const { user: responder } = await registerInhabitant({
    login: `login-r-${crypto.randomUUID()}`,
    email: `posts-reco-r-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });

  try {
    // Le mot cherché figure dans la demande elle-même.
    const matchByContent = await createPost({
      userId: author.id,
      type: "recommandation",
      content: "Un plombier fiable pour une fuite ?",
    });
    // Le mot cherché ne figure que dans la réponse (le vrai cas d'usage :
    // retrouver un nom d'artisan déjà recommandé).
    const matchByReply = await createPost({
      userId: author.id,
      type: "recommandation",
      content: "Un dentiste qui prend des patients ?",
    });
    await createComment({
      userId: responder.id,
      postId: matchByReply.id,
      content: "Dupont Plomberie, très réactif",
    });
    // Ni la demande ni ses réponses ne contiennent le mot cherché.
    await createPost({
      userId: author.id,
      type: "recommandation",
      content: "Une nounou disponible le mercredi ?",
    });

    const result = await listCityRecommendations({
      cityId: testStreet.testCity.id,
      page: 1,
      search: "plomb",
    });

    assertEquals(
      new Set(result.posts.map((p) => p.id)),
      new Set([matchByContent.id, matchByReply.id]),
    );
  } finally {
    await db.delete(comment).where(eq(comment.userId, responder.id));
    await db.delete(post).where(eq(post.userId, author.id));
    await db.delete(user).where(eq(user.id, author.id));
    await db.delete(user).where(eq(user.id, responder.id));
    await db.delete(house).where(eq(house.id, author.houseId));
    await db.delete(house).where(eq(house.id, responder.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("listCityRecommendations : recherche sans résultat → liste vide, pas une erreur", async () => {
  const testStreet = await createTestStreet("posts-reco-4");
  const { user: author } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `posts-reco-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });

  try {
    await createPost({
      userId: author.id,
      type: "recommandation",
      content: "Un plombier fiable pour une fuite ?",
    });

    const result = await listCityRecommendations({
      cityId: testStreet.testCity.id,
      page: 1,
      search: "vétérinaire",
    });

    assertEquals(result.posts, []);
    assertEquals(result.totalCount, 0);
  } finally {
    await db.delete(post).where(eq(post.userId, author.id));
    await db.delete(user).where(eq(user.id, author.id));
    await db.delete(house).where(eq(house.id, author.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("postListPath : /recommandations pour une recommandation, /fil pour le reste", () => {
  assertEquals(postListPath("recommandation"), "/recommandations");
  assertEquals(postListPath("cherche"), "/fil");
  assertEquals(postListPath("propose"), "/fil");
  assertEquals(postListPath("informe"), "/fil");
});

Deno.test("updatePostContent : corrige le contenu du propriétaire, ignore un autre utilisateur ou une demande supprimée", async () => {
  const testStreet = await createTestStreet("posts-edit-1");
  const { user: author } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `posts-edit-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const { user: other } = await registerInhabitant({
    login: `login-o-${crypto.randomUUID()}`,
    email: `posts-edit-o-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });

  try {
    const created = await createPost({
      userId: author.id,
      type: "cherche",
      content: "Je cherche une perceuse",
    });

    // Un autre utilisateur ne peut rien corriger.
    const byOther = await updatePostContent(created.id, other.id, "Piraté");
    assertEquals(byOther, null);

    const updated = await updatePostContent(
      created.id,
      author.id,
      "Je cherche une perceuse à percussion",
    );
    assertEquals(updated?.content, "Je cherche une perceuse à percussion");

    const [reloaded] = await db.select().from(post).where(
      eq(post.id, created.id),
    );
    assertEquals(reloaded.content, "Je cherche une perceuse à percussion");

    // Une fois supprimée, plus rien à corriger.
    await db.update(post).set({ deletedAt: new Date() }).where(
      eq(post.id, created.id),
    );
    const afterDelete = await updatePostContent(
      created.id,
      author.id,
      "Trop tard",
    );
    assertEquals(afterDelete, null);
  } finally {
    await db.delete(post).where(eq(post.userId, author.id));
    await db.delete(user).where(eq(user.id, author.id));
    await db.delete(user).where(eq(user.id, other.id));
    await db.delete(house).where(eq(house.id, author.houseId));
    await db.delete(house).where(eq(house.id, other.houseId));
    await cleanupTestStreet(testStreet);
  }
});

Deno.test("softDeletePost : supprime la demande du propriétaire, ignore un autre utilisateur, idempotent", async () => {
  const testStreet = await createTestStreet("posts-delete-1");
  const { user: author } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `posts-delete-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const { user: other } = await registerInhabitant({
    login: `login-o-${crypto.randomUUID()}`,
    email: `posts-delete-o-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });

  try {
    const created = await createPost({
      userId: author.id,
      type: "cherche",
      content: "Je cherche une perceuse",
    });

    // Un autre utilisateur ne peut rien supprimer.
    assertEquals(await softDeletePost(created.id, other.id), false);

    assertEquals(await softDeletePost(created.id, author.id), true);
    const [reloaded] = await db.select().from(post).where(
      eq(post.id, created.id),
    );
    assertEquals(reloaded.deletedAt !== null, true);

    // Déjà supprimée : un second appel ne fait rien (pas d'erreur).
    assertEquals(await softDeletePost(created.id, author.id), false);

    // Invisible du fil de sa rue une fois supprimée.
    const result = await listStreetPosts({
      streetId: testStreet.testStreet.id,
      page: 1,
    });
    assertEquals(result.posts.map((p) => p.id).includes(created.id), false);
  } finally {
    await db.delete(post).where(eq(post.userId, author.id));
    await db.delete(user).where(eq(user.id, author.id));
    await db.delete(user).where(eq(user.id, other.id));
    await db.delete(house).where(eq(house.id, author.houseId));
    await db.delete(house).where(eq(house.id, other.houseId));
    await cleanupTestStreet(testStreet);
  }
});
