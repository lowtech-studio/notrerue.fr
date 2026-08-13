import { assertEquals, assertStringIncludes } from "@std/assert";
import { buildCspOptions } from "./csp.ts";

function scriptSrc(csp: string[]): string {
  return csp.find((d) => d.startsWith("script-src"))!;
}
function styleSrc(csp: string[]): string {
  return csp.find((d) => d.startsWith("style-src"))!;
}

Deno.test("buildCspOptions(prod) : nonce activé, ni unsafe-eval ni data:/blob:", () => {
  const options = buildCspOptions(false);
  assertEquals(options.useNonce, true);

  const csp = options.csp!;
  assertStringIncludes(csp.join("; "), "default-src 'self'");
  assertEquals(scriptSrc(csp).includes("unsafe-eval"), false);
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
