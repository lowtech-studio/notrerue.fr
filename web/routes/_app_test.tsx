import { assertStringIncludes } from "@std/assert";
import { render } from "preact-render-to-string";
import type { VNode } from "preact";
import type { PageProps } from "fresh";
import App from "./_app.tsx";
import type { State } from "../utils.ts";

function DummyPage() {
  return <p>Contenu de test</p>;
}

// `App` ne lit que `Component` et `state.theme`, mais le type inféré par
// define.page() exige un Context complet ; on l'assouplit explicitement ici
// plutôt que de mocker tout `ctx` (le pattern déjà utilisé dans
// routes/index_test.ts).
const TestApp = App as unknown as (
  props: PageProps<unknown, State>,
) => VNode;

function renderApp(theme: State["theme"] = null): string {
  const props = {
    Component: DummyPage,
    state: { user: null, isStreetAwake: null, theme },
    url: new URL("https://notrerue.fr/"),
  } as unknown as PageProps<unknown, State>;
  return render(<TestApp {...props} />);
}

Deno.test("PWA", () => {
  const html = renderApp();
  assertStringIncludes(html, 'rel="manifest"');
  assertStringIncludes(html, 'href="/manifest.webmanifest"');
  assertStringIncludes(html, 'name="mobile-web-app-capable" content="yes"');
});

Deno.test("SEO : canonical, Open Graph et JSON-LD Organization/WebSite présents", () => {
  const html = renderApp();
  assertStringIncludes(
    html,
    '<link rel="canonical" href="https://notrerue.fr/"',
  );
  assertStringIncludes(html, 'property="og:title"');
  assertStringIncludes(
    html,
    'property="og:url" content="https://notrerue.fr/"',
  );
  assertStringIncludes(
    html,
    'name="twitter:card" content="summary_large_image"',
  );
  assertStringIncludes(html, 'type="application/ld+json"');
  assertStringIncludes(html, '"@type":"Organization"');
});

Deno.test("data-theme : reflète state.theme sur <html>, absent si système", () => {
  assertStringIncludes(renderApp(null), '<html lang="fr">');
  assertStringIncludes(renderApp("dark"), '<html lang="fr" data-theme="dark">');
  assertStringIncludes(
    renderApp("light"),
    '<html lang="fr" data-theme="light">',
  );
});
