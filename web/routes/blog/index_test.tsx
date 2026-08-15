import { assertStringIncludes } from "@std/assert";
import { render } from "preact-render-to-string";
import type { VNode } from "preact";
import type { PageProps } from "fresh";
import BlogIndexPage from "./index.tsx";
import type { State } from "../../utils.ts";
import { BLOG_POSTS } from "../../content/blog_posts.ts";

// Même pattern que routes/a-propos_test.tsx : page sans `handler`, rendue
// directement.
const TestPage = BlogIndexPage as unknown as (
  props: PageProps<unknown, State>,
) => VNode;

function renderPage(): string {
  const props = {
    state: {
      user: null,
      isStreetAwake: null,
      hasUnreadMessages: false,
      theme: null,
    },
  } as unknown as PageProps<unknown, State>;
  return render(<TestPage {...props} />);
}

Deno.test("/blog : liste tous les articles, avec leur lien et JSON-LD Blog", () => {
  const html = renderPage();
  assertStringIncludes(html, "<title>Blog — NotreRue.fr</title>");
  assertStringIncludes(html, '"@type":"Blog"');
  for (const post of BLOG_POSTS) {
    assertStringIncludes(html, `href="/blog/${post.slug}"`);
    assertStringIncludes(html, post.title);
  }
});
