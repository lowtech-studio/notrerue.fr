import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import type { Context } from "fresh";
import type { SessionUser, State } from "../../../../utils.ts";
import { db } from "../../../../db/client.ts";
import { house, post, user } from "../../../../db/schema.ts";
import { createPost } from "../../../../db/posts.ts";
import { registerInhabitant } from "../../../../db/users.ts";
import {
  cleanupTestStreet,
  createTestStreet,
} from "../../../../db/test_helpers.ts";
import { handler } from "./[id].ts";

function makeContext(
  postId: number,
  options: { user?: SessionUser | null; content?: string } = {},
): Context<State> {
  return {
    params: { id: String(postId) },
    state: { user: options.user ?? null },
    req: {
      json: () =>
        options.content === undefined
          ? Promise.reject(new SyntaxError("corps invalide"))
          : Promise.resolve({ content: options.content }),
    },
  } as unknown as Context<State>;
}

async function setup(label: string) {
  const testStreet = await createTestStreet(label);
  const { user: author } = await registerInhabitant({
    login: `login-${crypto.randomUUID()}`,
    email: `api-post-id-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const { user: other } = await registerInhabitant({
    login: `login-other-${crypto.randomUUID()}`,
    email: `api-post-id-other-${crypto.randomUUID()}@example.invalid`,
    houseNumber: null,
    streetId: testStreet.testStreet.id,
  });
  const createdPost = await createPost({
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
  const otherSession: SessionUser = {
    ...authorSession,
    id: other.id,
    login: other.login,
    email: other.email,
  };
  return {
    testStreet,
    author,
    other,
    post: createdPost,
    authorSession,
    otherSession,
  };
}

async function teardown(ctx: Awaited<ReturnType<typeof setup>>) {
  await db.delete(post).where(eq(post.id, ctx.post.id));
  await db.delete(user).where(eq(user.id, ctx.author.id));
  await db.delete(user).where(eq(user.id, ctx.other.id));
  await db.delete(house).where(eq(house.id, ctx.author.houseId));
  await db.delete(house).where(eq(house.id, ctx.other.houseId));
  await cleanupTestStreet(ctx.testStreet);
}

Deno.test("PATCH /api/v1/posts/:id : non connecté → 401", async () => {
  const res = await handler.PATCH!(makeContext(1)) as Response;
  assertEquals(res.status, 401);
});

Deno.test("PATCH /api/v1/posts/:id : propriétaire → contenu corrigé", async () => {
  const ctx = await setup("api-post-id-1");
  try {
    const res = await handler.PATCH!(
      makeContext(ctx.post.id, {
        user: ctx.authorSession,
        content: "Je cherche une perceuse à percussion",
      }),
    ) as Response;
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.content, "Je cherche une perceuse à percussion");

    const [updated] = await db.select().from(post).where(
      eq(post.id, ctx.post.id),
    );
    assertEquals(updated.content, "Je cherche une perceuse à percussion");
  } finally {
    await teardown(ctx);
  }
});

Deno.test("PATCH /api/v1/posts/:id : un autre utilisateur → 404, rien modifié", async () => {
  const ctx = await setup("api-post-id-2");
  try {
    const res = await handler.PATCH!(
      makeContext(ctx.post.id, {
        user: ctx.otherSession,
        content: "Contenu usurpé",
      }),
    ) as Response;
    assertEquals(res.status, 404);

    const [unchanged] = await db.select().from(post).where(
      eq(post.id, ctx.post.id),
    );
    assertEquals(unchanged.content, "Je cherche une perceuse");
  } finally {
    await teardown(ctx);
  }
});

Deno.test("PATCH /api/v1/posts/:id : contenu vide → 400, rien modifié", async () => {
  const ctx = await setup("api-post-id-3");
  try {
    const res = await handler.PATCH!(
      makeContext(ctx.post.id, { user: ctx.authorSession, content: "  " }),
    ) as Response;
    assertEquals(res.status, 400);
  } finally {
    await teardown(ctx);
  }
});

Deno.test("PATCH /api/v1/posts/:id : message agressif → 422, rien modifié", async () => {
  const ctx = await setup("api-post-id-4");
  try {
    const res = await handler.PATCH!(
      makeContext(ctx.post.id, { user: ctx.authorSession, content: "connard" }),
    ) as Response;
    assertEquals(res.status, 422);
    const [unchanged] = await db.select().from(post).where(
      eq(post.id, ctx.post.id),
    );
    assertEquals(unchanged.content, "Je cherche une perceuse");
  } finally {
    await teardown(ctx);
  }
});

Deno.test("DELETE /api/v1/posts/:id : non connecté → 401", async () => {
  const res = await handler.DELETE!(makeContext(1)) as Response;
  assertEquals(res.status, 401);
});

Deno.test("DELETE /api/v1/posts/:id : propriétaire → supprimée (soft delete)", async () => {
  const ctx = await setup("api-post-id-5");
  try {
    const res = await handler.DELETE!(
      makeContext(ctx.post.id, { user: ctx.authorSession }),
    ) as Response;
    assertEquals(res.status, 200);

    const [deleted] = await db.select().from(post).where(
      eq(post.id, ctx.post.id),
    );
    assertEquals(deleted.deletedAt !== null, true);
  } finally {
    await teardown(ctx);
  }
});

Deno.test("DELETE /api/v1/posts/:id : un autre utilisateur → 404, rien supprimé", async () => {
  const ctx = await setup("api-post-id-6");
  try {
    const res = await handler.DELETE!(
      makeContext(ctx.post.id, { user: ctx.otherSession }),
    ) as Response;
    assertEquals(res.status, 404);

    const [unchanged] = await db.select().from(post).where(
      eq(post.id, ctx.post.id),
    );
    assertEquals(unchanged.deletedAt, null);
  } finally {
    await teardown(ctx);
  }
});
