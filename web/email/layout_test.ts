import { assertEquals, assertStringIncludes } from "@std/assert";
import { emailButton, emailParagraph, renderEmailLayout } from "./layout.ts";

Deno.test("renderEmailLayout : en-tête avec la marque, contenu, pied de page", () => {
  const html = renderEmailLayout("<p>Contenu du message</p>");

  assertStringIncludes(html, "<!doctype html>");
  // Badge + nom (cf. backlog « en-tête avec le logo et le nom du site »).
  assertStringIncludes(html, "◍");
  assertStringIncludes(html, "NotreRue.fr");
  assertStringIncludes(html, "<p>Contenu du message</p>");
  assertStringIncludes(
    html,
    "l'entraide entre voisins, sans réseau social ni publicité.",
  );
});

Deno.test("renderEmailLayout : preheader inclus, masqué à l'affichage, absent si non fourni", () => {
  const withPreheader = renderEmailLayout("<p>Corps</p>", "Aperçu du mail");
  assertStringIncludes(withPreheader, "Aperçu du mail");
  assertStringIncludes(withPreheader, "display:none");

  const withoutPreheader = renderEmailLayout("<p>Corps</p>");
  assertEquals(withoutPreheader.includes("display:none"), false);
});

Deno.test("emailButton : lien avec le libellé, dans une table (rendu fiable sous Outlook)", () => {
  const html = emailButton("https://notrerue.fr/fil", "Voir le fil");

  assertStringIncludes(html, 'href="https://notrerue.fr/fil"');
  assertStringIncludes(html, "Voir le fil");
  assertStringIncludes(html, "<table");
});

Deno.test("emailParagraph : couleur muette différente du texte par défaut", () => {
  const normal = emailParagraph("Texte");
  const muted = emailParagraph("Texte", true);

  assertStringIncludes(normal, "Texte");
  assertStringIncludes(muted, "Texte");
  assertEquals(normal === muted, false);
});
