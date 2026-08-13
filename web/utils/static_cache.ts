/**
 * Le middleware `staticFiles()` de Fresh (cf. main.ts) ne prend aucune
 * option (vérifié via `deno doc jsr:@fresh/core`) et pose systématiquement
 * `Cache-Control: no-cache, no-store` sur tout fichier de `static/` — un
 * choix sûr par défaut, mais qui fait retélécharger en entier des images
 * qui ne changent jamais (captures d'écran de la page d'accueil, icônes) à
 * chaque visite. Sur un Raspberry Pi, chaque octet de bande passante et de
 * lecture disque évité compte (cf. AGENTS.md « éco-conception », RWEB0074).
 *
 * `max-age` plutôt que `immutable` (contrairement aux assets hashés du
 * build Vite, cf. `_fresh/client/assets`) : ces fichiers n'ont pas de hash
 * dans leur nom, leur contenu peut changer sans changer l'URL — le
 * navigateur doit donc revalider après expiration plutôt que faire
 * confiance indéfiniment.
 */
const LONG_CACHE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // une semaine

/** Vrai pour un chemin de `static/` qui change rarement (donc cacheable). */
function isLongCacheablePath(pathname: string): boolean {
  if (pathname.startsWith("/screenshots/")) return true;
  return ["/favicon.ico", "/icon.svg", "/icon-maskable.svg"].includes(
    pathname,
  );
}

/**
 * `Cache-Control` à poser sur `pathname`, ou `null` si le comportement par
 * défaut de Fresh (pas de cache) doit rester inchangé — notamment pour
 * `sw.js`/`manifest.webmanifest`/`offline.*`, où un navigateur doit
 * continuer à vérifier les mises à jour à chaque visite.
 */
export function buildStaticCacheControl(pathname: string): string | null {
  if (!isLongCacheablePath(pathname)) return null;
  return `public, max-age=${LONG_CACHE_MAX_AGE_SECONDS}`;
}
