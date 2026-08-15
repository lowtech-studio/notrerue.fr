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
 *
 * `fresh-island:` dans `script-src`, en dev uniquement : `@fresh/plugin-vite`
 * y charge le JS de chaque island via des spécificateurs
 * `fresh-island::NomDuComposant.tsx`, que le navigateur traite comme une URL
 * de schéma `fresh-island:` — jamais couvert par `'self'` (l'origine ne
 * correspond pas) ni par `'unsafe-inline'` (qui ne concerne que le code
 * inline, pas le chargement d'un script externe). Sans cette entrée,
 * *toutes* les islands restent muettes en dev, sans la moindre erreur
 * visible côté UI (juste une ligne dans la console) — régression trouvée en
 * conditions réelles sur islands/ImageDropzone.tsx (glisser-déposer une
 * image sans effet). Absent en production : les islands y sont servies sous
 * des chemins `/self`-relatifs classiques (cf. utils/csp_test.ts).
 */
export function buildCspOptions(isDev: boolean): CSPOptions {
  return {
    useNonce: !isDev,
    csp: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${
        isDev ? " 'unsafe-eval' fresh-island:" : ""
      }`,
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
