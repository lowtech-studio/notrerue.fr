# AGENTS.md

Instructions pour les agents IA et les contributeurs de ce dépôt.

## Aperçu

Application web full-stack basée sur **Fresh 2** (framework officiel de Deno) :

- **Runtime** : Deno 2 — pas de Node.js, pas de `package.json`
- **Framework** : Fresh 2 (`jsr:@fresh/core`) — rendu serveur par défaut, architecture *islands*
- **UI** : Preact 10 + `@preact/signals`
- **Build / HMR** : Vite via `@fresh/plugin-vite`
- **Styles** : CSS vanilla — un seul fichier `assets/styles.css`, variables CSS
  (`:root { --token: ... }`) pour les tokens de design (couleurs, typographies,
  espacements). Pas de framework CSS.
- **Langage** : TypeScript strict

Le projet doit etre maintenable et documeté au fil de l'eau dans le fichier markdown README.md

Nous construisons une plateforme d'entraide, de communication, d'échange  au sein d'une rue pour favoriser le partage entre voisins...
Le monde de demain c'est un monde low tech ou règne :
·	Partage
·	Entraide
·	Jardin, Potager
·	Partage compétences
·	Troc
·	Sécurité collective
But :
« Nous rapprocher les uns des autres » ou « Recréer du lien entre voisins »

Pour te donner une vision d'ensemble, la maquette de l'application se trouve dans _prototype/web.html

## Commandes

| Commande | Usage |
|---|---|
| `deno task dev` | Serveur de dev avec HMR (Vite) |
| `deno task build` | Build de production → `_fresh/` |
| `deno task start` | Servir le build de prod (nécessite `build` au préalable) |
| `deno task check` | fmt --check + lint + vérif des types — **obligatoire avant de terminer** |
| `deno fmt` | Formater le code |
| `deno lint` | Linter |
| `deno test -A` | Lancer tous les tests |
| `deno test -A <fichier_test.ts>` | Lancer un seul test |

## Dépendances

- Ajouter : `deno add jsr:@scope/pkg` ou `deno add npm:pkg`
- **Jamais** `npm install`, jamais de `package.json`, jamais d'édition manuelle de `deno.json` / `deno.lock`
- Préférer JSR (`@std/*`, `@fresh/*`) ; npm uniquement si le paquet n'existe pas sur JSR
- Après ajout d'une dépendance npm : exécuter `deno install`

## Structure du projet

l'application de trouve dans le dossier app

├── routes/ # Routing basé sur le système de fichiers
│ ├── _app.tsx # Enveloppe commune
│ ├── _middleware.ts# Middleware global (auth, logs…)
│ ├── api/ # Endpoints API (handlers GET/POST/…)
│ └── index.tsx # Page /
├── islands/ # SEULS composants hydratés côté client
├── components/ # Composants Preact 100 % serveur (aucun JS navigateur)
├── static/ # Assets publics servis tels quels (images, fonts…)
├── assets/ # CSS importé par client.ts (graphe de modules Vite)
├── utils.ts # createDefine() → helpers typés define.*
├── client.ts # Entrée client (imports CSS uniquement)
├── main.ts # Entrée serveur (instance App + fsRoutes)
├── vite.config.ts # Plugins Vite : fresh()
└── deno.json # Tasks, imports JSR/npm, compilerOptions JSX


## Règles Fresh — non négociables

1. **Interactivité = island.** Tout hook (`useState`, `useEffect`), gestionnaire
   d'événement ou API navigateur vit dans `islands/` ou `routes/(_islands)/`.
   Les routes et `components/` sont rendus côté serveur et n'envoient aucun JS.
2. **Jamais de code serveur dans un island** (`Deno.*`, fs, env, accès DB) :
   un island est bundlé et livré au navigateur.
3. **Props d'islands sérialisables uniquement** : string, number, boolean, null,
   `Date`, `URL`, `Map`/`Set`, objets/tableaux simples, JSX, signals. **Jamais
   de fonctions** en prop.
4. **Code client-only** : garder avec `import { IS_BROWSER } from "fresh/runtime"`,
   et toujours fournir un fallback SSR (`if (!IS_BROWSER) return …`).
5. **Imports avec extension explicite** : `./Button.tsx`, jamais `./Button`.
6. **Data fetching côté serveur** : dans le `handler` de la route, puis passer
   les données via `ctx.render()`. Pas de `fetch` client pour le rendu initial.
7. **Routes typées** : utiliser `define.handlers()` et `define.page()` (helpers
   de `utils.ts` via `createDefine<State>()`), pas de signatures à la main.
8. **Nommage des islands** : PascalCase (`Counter.tsx`).
9. **CSS** : importé dans `client.ts` (`import "./assets/styles.css"`). CSS
   vanilla uniquement — **jamais de framework CSS** (Tailwind, Bootstrap…) ni
   de préprocesseur. Tokens de design en variables CSS (`:root`). Ne jamais
   remettre le CSS à bundler dans `static/` ni ajouter de `<link>` manuel dans
   `_app.tsx`.
10. **Dossiers privés** : préfixer `_` (ex. `routes/(_components)/`) pour tout
    dossier sous `routes/` qui ne doit pas être routé.
11. JAMAIS de secrets dans le code! Les identifiants, mots de passes, clés apis ... doivent etre stockés en tant que variables d'environnement et ne doivent pas etre commités dans git !
12. Suivre une démarche d'**Éco-conception** — voir la section dédiée ci-dessous.
13. Suivre les bonnes pratiques de **cyber sécurité** — voir la section dédiée ci-dessous.

## Éco-conception

**Fonctionnalités et parcours**
- Supprimer le code mort et les fonctionnalités inutilisées plutôt que les
  laisser en place (RWEB0003).
- Préférer la pagination au défilement infini pour les listes (annonces,
  messages, membres) (RWEB0013).

**Rendu et architecture (déjà largement couvert par les règles Fresh ci-dessus)**
- SSR par défaut, JS minimal limité aux islands : c'est le principe même de
  Fresh, à ne jamais contourner (RWEB0018, RWEB0046, RWEB0047).
- Mobile first dans les composants et le CSS (RWEB0004).
- Éviter animations CSS/JS et carrousels non indispensables à l'UX (RWEB0009,
  RWEB0010).
- Limiter le nombre d'appels aux API HTTP/externes ; regrouper les appels
  plutôt que les multiplier (RWEB0021, RWEB0025).

**CSS**
- Ne garder qu'un seul fichier CSS buildé (déjà le cas via `assets/styles.css`
  → Vite) ; ne pas ajouter de feuilles de style supplémentaires (RWEB0035,
  RWEB0078).
- Préférer les classes CSS réutilisables et les dégradés/formes en CSS pur aux
  images décoratives (RWEB0037, RWEB0050).
- Ne pas réinventer un design system : garder un design simple, sobre, adapté
  au web (RWEB0012).

**Polices et médias**
- Préférer les polices système/standards ; si une police custom est
  nécessaire, la limiter à 1-2 graisses en `woff2`, auto-hébergée (jamais de
  Google Fonts chargé à distance) (RWEB0032).
- Utiliser des SVG plutôt que des PNG/JPG pour icônes et pictogrammes
  (RWEB0050, RWEB0100).
- Toute image importée (photos de profil, annonces, jardin partagé…) doit être
  redimensionnée côté serveur à la taille d'affichage réelle et compressée
  avant stockage — jamais l'image brute uploadée telle quelle (RWEB0048,
  RWEB0049, RWEB0098).
- Charger les images hors zone visible en `loading="lazy"` (RWEB0051).
- Pas de GIF animé, pas de vidéo en autoplay/preload automatique (RWEB0099,
  RWEB0106).

**Backend / Postgres**
- Ne stocker que les données strictement nécessaires (pas de champs
  spéculatifs, pas de duplication) (RWEB0023, RWEB0063).
- Regrouper les requêtes SQL liées (éviter les N+1) et les optimiser avec des
  index adaptés (RWEB0065, RWEB0066).
- Réutiliser le pool de connexions Postgres plutôt que d'ouvrir une connexion
  par requête (RWEB0024).

**Cache et livraison HTTP**
- Poser des en-têtes `Cache-Control`/`Expires` explicites sur les assets
  statiques (`static/`, build Vite hashé) (RWEB0074, RWEB0075).
- Le build de prod (`deno task build`) minifie et regroupe CSS/JS via Vite :
  ne jamais servir de source non buildée en production (RWEB0076, RWEB0077,
  RWEB0078).
- Garder les logs serveur au strict nécessaire au debug/observabilité, pas de
  logging verbeux permanent (RWEB0087).

**Analytics et données**
- Pas d'outil d'analytics tiers par défaut ; si besoin, limiter au strict
  nécessaire et éviter la collecte de données personnelles superflue
  (RWEB0111) — cohérent avec l'esprit low-tech et respectueux du voisinage du
  projet.

## Cyber sécurité

Référentiel : ANSSI-PA-009 — *Recommandations pour la mise en œuvre d'un site web :
maîtriser les standards de sécurité côté navigateur*. Sélection des règles (Rxx)
applicables à notre stack (Fresh 2 SSR / Deno / Preact / cookie de session / Postgres),
à respecter comme les autres règles non négociables ci-dessus.

**Transport et en-têtes HTTP**
- Définir une `Content-Security-Policy` stricte par en-tête HTTP (middleware global,
  `routes/_middleware.ts`), avec au minimum `default-src 'self'` et sans
  `unsafe-inline`, `unsafe-eval` ni `data:` (R13-R16, R20).
- Bloquer l'inclusion du site dans une frame tierce via `frame-ancestors 'none'` dans
  la CSP, complété par `X-Frame-Options: DENY` (R17, R18).
- Définir `Referrer-Policy: strict-origin-when-cross-origin` ou plus strict (R21, R22).

**Rendu HTML et XSS**
- Ne jamais utiliser `dangerouslySetInnerHTML` avec du contenu utilisateur non
  échappé ; laisser Preact/JSX gérer l'échappement du texte (R4, R5, R7).
- Proscrire `eval()`, `new Function(...)`, et `setTimeout`/`setInterval` avec une
  chaîne de caractères en premier argument (R9, R10).
- Toute donnée externe (formulaire, paramètre d'URL, réponse d'API tierce) doit être
  validée côté serveur avant stockage ou affichage (R8).

**Cookies et session**
- Le cookie de session (`SESSION_SECRET`) doit porter les attributs `HttpOnly`,
  `Secure`, `SameSite=Lax` (ou `Strict` si aucun lien entrant légitime ne le
  nécessite), et un `Path` restreint au périmètre concerné (R26, R28, R30, R31, R33).
- Ne jamais rendre le cookie de session accessible en JavaScript client (R29).
- Ne stocker aucune donnée sensible dans `localStorage`/`sessionStorage` (R23).

**Formulaires, API et CSRF**
- Toute action état-modifiante (POST/PUT/DELETE) sur `routes/api/` doit être protégée
  par un jeton anti-CSRF ; `SameSite` seul est une défense en profondeur, pas une
  protection suffisante (R38).
- Les handlers d'API retournent du JSON (`Content-Type: application/json`), jamais un
  fragment HTML injectable côté client (R34).
- Depuis les islands, utiliser l'API `fetch` plutôt que `XMLHttpRequest`, avec
  `credentials: 'same-origin'` explicite (R36, R44).
- Ne jamais répondre `Access-Control-Allow-Origin: *` sur une route authentifiée ;
  vérifier l'en-tête `Origin` côté serveur sur les routes sensibles (R40, R41).

**Liens et fenêtres**
- Tout lien `target="_blank"` doit porter `rel="noopener noreferrer"` (R45).

**Dépendances et maintien en condition de sécurité**
- Ne jamais exposer de messages d'erreur détaillés (stack trace, requêtes SQL) en
  production ; le comportement doit différer entre `deno task dev` et le build de
  production (R59, R60).
- Logs serveur sans secrets ni données sensibles, volume limité au strict nécessaire
  au debug (cf. RWEB0087 en éco-conception).

## Style de code

- TypeScript strict : types explicites sur les exports ; `unknown` plutôt que `any`.
- Formatage = `deno fmt` (config par défaut, non négociable).
- Composants fonctionnels Preact ; hooks depuis `preact/hooks` ; état partagé
  entre islands via `@preact/signals`.
- Handlers API : retourner des `Response` avec statuts HTTP explicites.
- Identifiants en anglais, commentaires en français.

## Tests

- Framework : `Deno.test` + `@std/assert` (pas de framework externe).
- Nommage : `*_test.ts` / `*_test.tsx`, colocalisés au fichier testé.
- Tester les handlers (statuts, corps de réponse) et la logique des islands
  séparément.

## Git

- Branches depuis `main` : `feat/…`, `fix/…`, `chore/…`.
- Commits au format Conventional Commits (`feat: ajoute la route /api/users`).
- PR : CI verte obligatoire (fmt, lint, check, tests).
- Hook pre-commit versionné dans `.githooks/` (lance `make check`). À activer une
  fois par clone : `git config core.hooksPath .githooks`.

## Ne pas modifier

- `_fresh/` — sortie de build générée (git-ignorée)
- `deno.lock` — modifié uniquement par les commandes `deno`
- `.env*` — secrets, jamais commités ; lus via `Deno.env` côté serveur uniquement
- `static/` pour y déposer du CSS destiné au bundling (voir règle 9)