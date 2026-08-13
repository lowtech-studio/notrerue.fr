import { assertEquals } from "@std/assert";
import { nextTheme, nextThemeLabel, parseTheme } from "./theme.ts";

Deno.test("parseTheme : accepte light/dark, rejette le reste", () => {
  assertEquals(parseTheme("light"), "light");
  assertEquals(parseTheme("dark"), "dark");
  assertEquals(parseTheme(null), null);
  assertEquals(parseTheme(undefined), null);
  assertEquals(parseTheme(""), null);
  assertEquals(parseTheme("n'importe quoi"), null);
});

Deno.test("nextTheme : cycle système → sombre → clair → système", () => {
  assertEquals(nextTheme(null), "dark");
  assertEquals(nextTheme("dark"), "light");
  assertEquals(nextTheme("light"), null);
});

Deno.test("nextThemeLabel : une action (verbe), pas un état — cf. retour utilisateur sur l'ambiguïté", () => {
  assertEquals(nextThemeLabel(null), "Activer le mode sombre");
  assertEquals(nextThemeLabel("dark"), "Activer le mode clair");
  assertEquals(nextThemeLabel("light"), "Suivre le système");
});
