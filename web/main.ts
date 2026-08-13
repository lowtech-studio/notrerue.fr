import { App, csp, staticFiles } from "fresh";
import { type State } from "./utils.ts";
import { buildCspOptions } from "./utils/csp.ts";
import { buildStaticCacheControl } from "./utils/static_cache.ts";

export const app = new App<State>();

// Enregistré avant `staticFiles()` : sur le chemin retour (une fois la
// réponse de `staticFiles()` obtenue via `ctx.next()`), on peut encore
// ajuster ses en-têtes — même mécanique que `applySecurityHeaders` dans
// routes/_middleware.ts. `staticFiles()` répond directement sans jamais
// appeler `ctx.next()` pour un fichier trouvé : un middleware posé après lui
// ne verrait donc jamais passer ces requêtes (cf. utils/static_cache.ts).
app.use(async (ctx) => {
  const res = await ctx.next();
  const cacheControl = buildStaticCacheControl(ctx.url.pathname);
  if (cacheControl) res.headers.set("Cache-Control", cacheControl);
  return res;
});
app.use(staticFiles());

// CSP stricte (cf. AGENTS.md « Cyber sécurité », ANSSI-PA-009 R13-R16, R20) —
// via le middleware `csp()` de Fresh plutôt qu'un en-tête posé à la main
// (cf. routes/_middleware.ts pour X-Frame-Options/Referrer-Policy) : Fresh
// pose lui-même un `nonce` sur le `<script type="module">` qui démarre
// chaque île (cf. `boot(...)` dans le HTML rendu) — une CSP statique sans ce
// nonce bloque ce script et casse silencieusement toutes les îles (aucune
// erreur serveur, juste plus aucune interactivité côté navigateur — cf.
// revue : l'autocomplétion de ville de /rejoindre ne fonctionnait plus).
// Configuration dans utils/csp.ts (testable indépendamment de l'App).
app.use(csp(buildCspOptions(import.meta.env?.DEV === true)));

// Include file-system based routes here
app.fsRoutes();
