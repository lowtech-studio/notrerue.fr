import { assertEquals, assertStringIncludes } from "@std/assert";
import { render } from "preact-render-to-string";
import type { Context, PageProps } from "fresh";
import type { VNode } from "preact";
import type { State } from "../../utils.ts";
import { BLOG_POSTS } from "../../content/blog_posts.ts";
import BlogPostPage, { handler } from "./[slug].tsx";

function makeContext(slug: string): Context<State> {
  return {
    params: { slug },
    state: {
      user: null,
      isStreetAwake: null,
      hasUnreadMessages: false,
      theme: null,
    },
  } as unknown as Context<State>;
}

Deno.test("GET /blog/:slug : slug connu → données de l'article", async () => {
  const post = BLOG_POSTS[0];
  const result = await handler.GET!(makeContext(post.slug));
  assertEquals(result, { data: post });
});

Deno.test("GET /blog/:slug : slug inconnu → 404 sans planter", async () => {
  const response = await handler.GET!(makeContext("nexiste-pas")) as Response;
  assertEquals(response.status, 404);
});

const TestPage = BlogPostPage as unknown as (
  props: PageProps<unknown, State>,
) => VNode;

Deno.test("/blog/:slug : titre, intro et JSON-LD BlogPosting présents", () => {
  const post = BLOG_POSTS[0];
  const props = {
    data: post,
    state: {
      user: null,
      isStreetAwake: null,
      hasUnreadMessages: false,
      theme: null,
    },
  } as unknown as PageProps<unknown, State>;
  const html = render(<TestPage {...props} />);

  assertStringIncludes(html, `<title>${post.title} — NotreRue.fr</title>`);
  assertStringIncludes(html, post.intro);
  assertStringIncludes(html, '"@type":"BlogPosting"');
  assertStringIncludes(html, `"headline":"${post.title}"`);
});

Deno.test("/blog/:slug : CTA de fin d'article → /rejoindre non connecté, /inviter connecté", () => {
  const post = BLOG_POSTS[0];
  const baseState = {
    isStreetAwake: null,
    hasUnreadMessages: false,
    theme: null,
  };

  const loggedOutHtml = render(
    <TestPage
      {...{
        data: post,
        state: { user: null, ...baseState },
      } as unknown as PageProps<
        unknown,
        State
      >}
    />,
  );
  assertStringIncludes(loggedOutHtml, 'href="/rejoindre" class="button"');
  assertStringIncludes(loggedOutHtml, "Générez votre kit");

  const loggedInHtml = render(
    <TestPage
      {...{
        data: post,
        state: { user: { id: 1, login: "camille" }, ...baseState },
      } as unknown as PageProps<unknown, State>}
    />,
  );
  assertStringIncludes(loggedInHtml, 'href="/inviter" class="button"');
});
