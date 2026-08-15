import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { BLOG_POSTS } from "../content/blog_posts.ts";
import { handler } from "./sitemap.xml.ts";

Deno.test("GET /sitemap.xml : XML valide, Content-Type dédié, URL absolues sur notrerue.fr", async () => {
  const response = await handler.GET!() as Response;

  assertEquals(
    response.headers.get("Content-Type"),
    "application/xml; charset=utf-8",
  );

  const xml = await response.text();
  assertStringIncludes(xml, "<urlset");

  const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
  assert(locs.length > 0, "le sitemap doit lister au moins une URL");
  for (const loc of locs) {
    assert(
      loc.startsWith("https://notrerue.fr/"),
      `${loc} doit être une URL absolue sur notrerue.fr`,
    );
  }
});

Deno.test("GET /sitemap.xml : liste toutes les pages statiques et tous les articles de blog", async () => {
  const response = await handler.GET!() as Response;
  const xml = await response.text();

  for (const path of ["/", "/rejoindre", "/connexion", "/a-propos", "/blog"]) {
    assertStringIncludes(xml, `<loc>https://notrerue.fr${path}</loc>`);
  }
  for (const post of BLOG_POSTS) {
    assertStringIncludes(
      xml,
      `<loc>https://notrerue.fr/blog/${post.slug}</loc>`,
    );
  }
});
