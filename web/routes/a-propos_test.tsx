import { assertStringIncludes } from "@std/assert";
import { render } from "preact-render-to-string";
import type { VNode } from "preact";
import type { PageProps } from "fresh";
import AProposPage from "./a-propos.tsx";
import type { State } from "../utils.ts";

// Page sans `handler` (contenu 100% statique) : même situation que
// routes/_app.tsx, on rend le composant directement plutôt que de mocker un
// `Context` complet (cf. _app_test.tsx, pattern déjà utilisé).
const TestPage = AProposPage as unknown as (
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

Deno.test("/a-propos : titre, meta description et JSON-LD AboutPage présents", () => {
  const html = renderPage();
  assertStringIncludes(html, "<title>À propos — NotreRue.fr</title>");
  assertStringIncludes(html, 'name="description"');
  assertStringIncludes(html, 'type="application/ld+json"');
  assertStringIncludes(html, '"@type":"AboutPage"');
  assertStringIncludes(html, "LowTech.studio");
});

Deno.test("/a-propos : lien vers le dépôt GitHub, ouvert dans un nouvel onglet", () => {
  const html = renderPage();
  assertStringIncludes(
    html,
    'href="https://github.com/lowtech-studio/notrerue.fr"',
  );
  assertStringIncludes(html, 'rel="noopener noreferrer"');
});
