import {
  assert,
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "@std/assert";

const STATIC_DIR = import.meta.dirname!;

function readStatic(name: string): Promise<string> {
  return Deno.readTextFile(`${STATIC_DIR}/${name}`);
}

Deno.test("PWA - Le manifest PWA est un JSON valide avec les champs requis", async () => {
  const manifest = JSON.parse(await readStatic("manifest.webmanifest"));

  assertEquals(manifest.display, "standalone");
  assertEquals(manifest.start_url, "/");
  assert(
    Array.isArray(manifest.icons) && manifest.icons.length > 0,
    "le manifest doit déclarer au moins une icône",
  );

  for (const icon of manifest.icons) {
    assertExists(icon.src, "chaque icône doit avoir un src");
    const path = String(icon.src).replace(/^\//, "");
    // Jette une erreur si le fichier référencé par le manifest n'existe pas.
    await Deno.stat(`${STATIC_DIR}/${path}`);
  }
});

Deno.test("PWA - Les icônes déclarées sont bien du SVG", async () => {
  for (const name of ["icon.svg", "icon-maskable.svg"]) {
    const content = await readStatic(name);
    assert(
      content.trim().startsWith("<svg"),
      `${name} devrait commencer par <svg`,
    );
  }
});

Deno.test("PWA - Le service worker gère install/activate/fetch et connaît la page hors-ligne", async () => {
  const sw = await readStatic("sw.js");

  assertStringIncludes(sw, 'addEventListener("install"');
  assertStringIncludes(sw, 'addEventListener("activate"');
  assertStringIncludes(sw, 'addEventListener("fetch"');
  assertStringIncludes(sw, "/offline.html");
});

Deno.test("PWA - La page hors-ligne existe et référence son script externe", async () => {
  const html = await readStatic("offline.html");
  assertStringIncludes(html, "/offline.js");
  // Jette une erreur si offline.js n'existe pas réellement.
  await Deno.stat(`${STATIC_DIR}/offline.js`);
});
