import { assertEquals } from "@std/assert";
import { containsBlockedContent } from "./blocklist.ts";

Deno.test("containsBlockedContent : détecte une insulte, y compris en fin de phrase accentuée", () => {
  assertEquals(containsBlockedContent("Bande de connard"), true);
  assertEquals(containsBlockedContent("sale pédé"), true);
  assertEquals(containsBlockedContent("t'es un pédé"), true);
  assertEquals(containsBlockedContent("va te faire enculé"), true);
});

Deno.test("containsBlockedContent : détecte un terme discriminatoire", () => {
  assertEquals(containsBlockedContent("sale négro"), true);
  assertEquals(containsBlockedContent("bande de bougnoule"), true);
  assertEquals(containsBlockedContent("espèce de gouine"), true);
});

Deno.test("containsBlockedContent : détecte une variante leet speak", () => {
  assertEquals(containsBlockedContent("esp3c3 d'1mb3c1l3"), true);
  assertEquals(containsBlockedContent("3ncul3 toi-même"), true);
});

Deno.test("containsBlockedContent : détecte une menace explicite", () => {
  assertEquals(containsBlockedContent("je vais te tuer"), true);
  assertEquals(containsBlockedContent("va crever sale type"), true);
});

Deno.test("containsBlockedContent : laisse passer des messages ordinaires (pas de faux positif)", () => {
  assertEquals(
    containsBlockedContent(
      "Quelqu'un aurait une perceuse à me prêter ce week-end ? Je la rends dimanche soir.",
    ),
    false,
  );
  assertEquals(
    containsBlockedContent("Je cherche une perceuse noire à emprunter"),
    false,
  );
  assertEquals(
    containsBlockedContent("L'eau sera coupée mardi de 9h à 12h."),
    false,
  );
  assertEquals(containsBlockedContent("Assemblée générale jeudi soir"), false);
});
