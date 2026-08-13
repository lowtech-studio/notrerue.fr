import { App, csp, staticFiles } from "fresh";
import { type State } from "./utils.ts";
import { buildCspOptions } from "./utils/csp.ts";

export const app = new App<State>();

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
