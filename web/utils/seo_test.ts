import { assertEquals, assertStringIncludes } from "@std/assert";
import { canonicalUrl, jsonLd, SITE_URL } from "./seo.ts";

Deno.test("canonicalUrl : préfixe le domaine, ignore toute requête déjà retirée en amont", () => {
  assertEquals(canonicalUrl("/"), `${SITE_URL}/`);
  assertEquals(canonicalUrl("/rejoindre"), `${SITE_URL}/rejoindre`);
});

Deno.test("jsonLd : échappe '<' pour ne jamais fermer prématurément le <script>", () => {
  const out = jsonLd({ name: "</script><script>alert(1)</script>" });
  assertEquals(out.includes("</script>"), false);
  assertStringIncludes(out, "\\u003c/script>");
});

Deno.test("jsonLd : sérialise normalement en l'absence de caractère à risque", () => {
  const out = jsonLd({ "@type": "Organization", name: "NotreRue.fr" });
  assertEquals(out, '{"@type":"Organization","name":"NotreRue.fr"}');
});
