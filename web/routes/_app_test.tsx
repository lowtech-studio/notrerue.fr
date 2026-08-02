import { assertStringIncludes } from "@std/assert";
import { render } from "preact-render-to-string";
import type { VNode } from "preact";
import type { PageProps } from "fresh";
import App from "./_app.tsx";
import type { State } from "../utils.ts";

function DummyPage() {
  return <p>Contenu de test</p>;
}

// `App` ne lit que `Component`, mais le type inféré par define.page() exige
// un Context complet ; on l'assouplit explicitement ici plutôt que de mocker
// tout `ctx` (le pattern déjà utilisé dans routes/index_test.ts).
const TestApp = App as unknown as (
  props: PageProps<unknown, State>,
) => VNode;

function renderApp(): string {
  const props = { Component: DummyPage } as unknown as PageProps<
    unknown,
    State
  >;
  return render(<TestApp {...props} />);
}

Deno.test("PWA", () => {
  const html = renderApp();
  assertStringIncludes(html, 'rel="manifest"');
  assertStringIncludes(html, 'href="/manifest.webmanifest"');
  assertStringIncludes(html, 'name="mobile-web-app-capable" content="yes"');
});
