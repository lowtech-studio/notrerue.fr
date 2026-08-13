import type { CSPOptions } from "fresh";

/**
 * Options du middleware `csp()` de Fresh (cf. main.ts) — extraites dans leur
 * propre fonction pure pour rester testables sans construire une `App`
 * complète (le nonce lui-même n'est généré qu'au rendu d'une page réelle,
 * hors de portée d'un test unitaire ; ici on vérifie seulement la
 * configuration qu'on lui passe).
 *
 * `isDev` relâche `script-src`/`style-src` uniquement en développement
 * (`deno task dev`) : le rechargement à chaud de Vite injecte son propre
 * `<style>` côté client (jamais passé par le rendu Fresh, donc jamais nonce)
 * et `@prefresh` évalue du JS généré dynamiquement. `useNonce: false` en dev
 * garde ces autorisations statiques plutôt que de les voir remplacées par un
 * nonce — jamais le cas en production (seul chemin qui sert de vrais
 * utilisateurs).
 */
export function buildCspOptions(isDev: boolean): CSPOptions {
  return {
    useNonce: !isDev,
    csp: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      // Pas de `data:`/`blob:` (défauts Fresh) : aucune image encodée en
      // base64, aucun média, aucun worker construit dynamiquement ici.
      "img-src 'self'",
      "font-src 'self'",
      "connect-src 'self'",
      "media-src 'self'",
      "worker-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ],
  };
}
