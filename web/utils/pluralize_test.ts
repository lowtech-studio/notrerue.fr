import { assertEquals } from "@std/assert";
import { pluralizeCount } from "./pluralize.ts";

Deno.test("pluralizeCount : singulier pour 0 et 1, pluriel au-delà (cf. revue : « 1 foyers inscrits »)", () => {
  assertEquals(
    pluralizeCount(0, "foyer inscrit", "foyers inscrits"),
    "0 foyer inscrit",
  );
  assertEquals(
    pluralizeCount(1, "foyer inscrit", "foyers inscrits"),
    "1 foyer inscrit",
  );
  assertEquals(
    pluralizeCount(2, "foyer inscrit", "foyers inscrits"),
    "2 foyers inscrits",
  );
  assertEquals(
    pluralizeCount(4, "foyer inscrit", "foyers inscrits"),
    "4 foyers inscrits",
  );
});

Deno.test("pluralizeCount : pluriel par défaut dérivé du singulier (+s) si non fourni", () => {
  assertEquals(pluralizeCount(1, "message"), "1 message");
  assertEquals(pluralizeCount(3, "message"), "3 messages");
});
