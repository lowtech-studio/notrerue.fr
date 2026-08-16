import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildCspOptions } from "./csp.ts";

function scriptSrc(csp: string[]): string {
  return csp.find((d) => d.startsWith("script-src"))!;
}
function styleSrc(csp: string[]): string {
  return csp.find((d) => d.startsWith("style-src"))!;
}

Deno.test("buildCspOptions(prod) : nonce activé, ni unsafe-eval ni data:/blob: ni fresh-island:", () => {
  const options = buildCspOptions(false);
  assertEquals(options.useNonce, true);

  const csp = options.csp!;
  assertStringIncludes(csp.join("; "), "default-src 'self'");
  assertEquals(scriptSrc(csp).includes("unsafe-eval"), false);
  // `fresh-island:` (cf. test dev ci-dessous) n'a de raison d'être autorisé
  // qu'en dev : le build de production sert les islands sous des chemins
  // `/self`-relatifs classiques (vérifié en conditions réelles), inutile
  // d'élargir la CSP de prod pour un mécanisme qu'elle n'utilise pas.
  assertEquals(scriptSrc(csp).includes("fresh-island:"), false);
  // `useNonce` remplace `'unsafe-inline'` par le nonce réel au moment du
  // rendu (cf. Fresh, testé en amont) : ici on vérifie seulement que rien
  // n'échappe à ce mécanisme (pas de `data:`/`blob:` qui resteraient tels
  // quels, contrairement à `'unsafe-inline'`).
  for (const directive of csp) {
    assertEquals(directive.includes("data:"), false);
    assertEquals(directive.includes("blob:"), false);
  }
  assertStringIncludes(csp.join("; "), "frame-ancestors 'none'");
  assertStringIncludes(csp.join("; "), "object-src 'none'");
});

Deno.test("buildCspOptions(dev) : nonce désactivé, unsafe-inline/unsafe-eval statiques (rechargement à chaud Vite)", () => {
  const options = buildCspOptions(true);
  assertEquals(options.useNonce, false);

  const csp = options.csp!;
  assertStringIncludes(scriptSrc(csp), "'unsafe-eval'");
  assertStringIncludes(scriptSrc(csp), "'unsafe-inline'");
  assertStringIncludes(styleSrc(csp), "'unsafe-inline'");
});

Deno.test("buildCspOptions(dev) : autorise le schéma fresh-island: (chargement des islands par @fresh/plugin-vite en dev)", () => {
  const options = buildCspOptions(true);
  const csp = options.csp!;
  // Sans ça, le navigateur bloque le chargement de CHAQUE island en dev
  // (`deno task dev`) : `@fresh/plugin-vite` charge leur JS via des
  // spécificateurs `fresh-island::NomDuComposant.tsx`, que le navigateur
  // interprète comme une URL avec pour schéma `fresh-island:` — jamais
  // couvert par `'self'` (ni par `'unsafe-inline'`, qui ne concerne que le
  // code inline, pas le chargement d'un script externe). Régression trouvée
  // en conditions réelles : glisser-déposer une image dans /fil (cf.
  // islands/PostComposerField.tsx) ne faisait rien, sans erreur visible côté
  // UI — uniquement `Loading the script 'fresh-island::...' violates...`
  // dans la console. Le build de production n'est pas concerné (cf. test
  // prod ci-dessus) : les islands y sont servies sous des chemins normaux.
  assertStringIncludes(scriptSrc(csp), "fresh-island:");
});
