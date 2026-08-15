import { assert, assertEquals, assertExists } from "@std/assert";
import {
  BLOG_POSTS,
  findBlogPostBySlug,
  formatBlogDate,
  listBlogPostsSortedByDate,
} from "./blog_posts.ts";

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

Deno.test("BLOG_POSTS : slugs uniques, au format URL, tous les champs renseignés", () => {
  assert(BLOG_POSTS.length > 0, "au moins un article");

  const seen = new Set<string>();
  for (const post of BLOG_POSTS) {
    assert(
      SLUG_RE.test(post.slug),
      `slug "${post.slug}" doit être en minuscules/chiffres/tirets`,
    );
    assert(!seen.has(post.slug), `slug "${post.slug}" en double`);
    seen.add(post.slug);

    assert(post.title.trim().length > 0, `titre vide pour ${post.slug}`);
    assert(
      post.description.trim().length > 0,
      `description vide pour ${post.slug}`,
    );
    assert(post.intro.trim().length > 0, `intro vide pour ${post.slug}`);
    assert(
      post.body.length > 0 && post.body.every((p) => p.trim().length > 0),
      `corps vide ou paragraphe vide pour ${post.slug}`,
    );
    assert(
      /^\d{4}-\d{2}-\d{2}$/.test(post.publishedAt),
      `publishedAt "${post.publishedAt}" doit être au format AAAA-MM-JJ`,
    );
  }
});

Deno.test("findBlogPostBySlug : trouve un article existant, null sinon", () => {
  const first = BLOG_POSTS[0];
  assertEquals(findBlogPostBySlug(first.slug), first);
  assertEquals(findBlogPostBySlug("ne-existe-pas"), null);
});

Deno.test("listBlogPostsSortedByDate : du plus récent au plus ancien", () => {
  const sorted = listBlogPostsSortedByDate();
  assertEquals(sorted.length, BLOG_POSTS.length);
  for (let i = 1; i < sorted.length; i++) {
    assert(
      sorted[i - 1].publishedAt >= sorted[i].publishedAt,
      "tri décroissant attendu",
    );
  }
  // Ne mute pas le tableau d'origine.
  assertExists(BLOG_POSTS[0]);
});

Deno.test("formatBlogDate : date absolue en français", () => {
  assertEquals(formatBlogDate("2026-08-15"), "15 août 2026");
});
