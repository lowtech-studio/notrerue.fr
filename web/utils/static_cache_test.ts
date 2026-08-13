import { assertEquals } from "@std/assert";
import { buildStaticCacheControl } from "./static_cache.ts";

Deno.test("buildStaticCacheControl : capture d'écran → cache d'une semaine", () => {
  assertEquals(
    buildStaticCacheControl("/screenshots/fil.jpg"),
    "public, max-age=604800",
  );
});

Deno.test("buildStaticCacheControl : favicon/icônes → cache d'une semaine", () => {
  assertEquals(
    buildStaticCacheControl("/favicon.ico"),
    "public, max-age=604800",
  );
  assertEquals(buildStaticCacheControl("/icon.svg"), "public, max-age=604800");
  assertEquals(
    buildStaticCacheControl("/icon-maskable.svg"),
    "public, max-age=604800",
  );
});

Deno.test("buildStaticCacheControl : service worker/manifest/offline → comportement par défaut de Fresh inchangé (null)", () => {
  assertEquals(buildStaticCacheControl("/sw.js"), null);
  assertEquals(buildStaticCacheControl("/manifest.webmanifest"), null);
  assertEquals(buildStaticCacheControl("/offline.html"), null);
  assertEquals(buildStaticCacheControl("/offline.js"), null);
});

Deno.test("buildStaticCacheControl : route applicative (pas un fichier statique) → null", () => {
  assertEquals(buildStaticCacheControl("/fil"), null);
  assertEquals(buildStaticCacheControl("/"), null);
});
