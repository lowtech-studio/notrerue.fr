# Architecture app mobile (iOS/Android) — proposition

Contexte : après un MVP web fonctionnel (Fresh/Deno), passage à une
application mobile native (dossier `mobile/`, cf. backlog « Backlog
Mobile », qui reprend volontairement les user stories web avec la mention
« en réutilisant ce qui a été fait côté Web »). Contrainte serveur
inchangée : **1 vCore / 1 Go RAM** (cf. `deploy/README.md`), déjà occupé à
~75 % par le web + Postgres + Caddy. Objectifs : réutiliser la base et les
fonctionnalités existantes, minimiser la maintenance, obtenir un rendu
fidèle à une app native (pas un simple wrapper de site).

## Vue d'ensemble

```
┌─────────────────┐        ┌──────────────────┐
│  App iOS/Android │        │   Web (Fresh)     │
│  Expo/React      │        │   Preact SSR       │
│  Native          │        │   + islands        │
└────────┬─────────┘        └─────────┬─────────┘
         │ HTTPS, JSON               │ HTML (SSR) + JSON (islands)
         │ Authorization: Bearer     │ Cookie de session
         ▼                           ▼
┌───────────────────────────────────────────────┐
│         Même processus Deno (Fresh)             │
│  routes/api/v1/*  ──┐                          │
│  routes/*.tsx (web) ─┼─► db/*.ts (drizzle) ─► Postgres
│  moderation/, utils/─┘                          │
└───────────────────────────────────────────────┘
```

Un seul backend, un seul processus, une seule base — l'app mobile est un
**deuxième client** du même serveur, pas un deuxième système.

## 1. Backend : étendre Fresh, ne pas dupliquer un serveur

**Décision : pas de second backend (NestJS/Express/GraphQL...).** Ajouter
une API JSON versionnée `routes/api/v1/` au sein de l'app Fresh existante,
sur le modèle déjà en place avec `routes/api/villes.ts`/`routes/api/rues.ts`.

Pourquoi c'est la seule option compatible avec le budget de 1 Go :

- Le process Deno de prod mesure **75 Mo** au repos (`deploy/README.md`),
  plafonné à 280 Mo par systemd. Ajouter des routes JSON au même process
  ne coûte quasiment rien (pas de nouveau runtime, pas de nouveau pool de
  connexions Postgres).
- Un second serveur (même léger, type Express) ajoute un process Node
  distinct : nouveau runtime en mémoire, nouveau pool de connexions DB, un
  service systemd de plus à sandboxer/monitorer — sur une machine où la
  marge libre totale est déjà chiffrée à 250-350 Mo, c'est un risque direct
  d'OOM plutôt qu'une optimisation.
- Toute la logique métier est déjà découplée du rendu HTML : les handlers
  Fresh (`define.handlers`) retournent des données, que la route transforme
  ensuite soit en JSX (`ctx.render`), soit en JSON (`Response.json`). Les
  modules `db/*.ts`, `moderation/blocklist.ts`, `utils/validation.ts`,
  `utils/rate_limit.ts` sont déjà indépendants de Fresh/Preact — l'API
  mobile les appelle telles quelles, aucune duplication de règles métier.

**Structure proposée** (miroir du backlog mobile MVP) :

```
web/routes/api/v1/
├── auth/
│   ├── code.ts          # POST — demande un code à 6 chiffres (réutilise utils/otp.ts)
│   └── verify.ts        # POST — vérifie le code → émet un session token
├── streets/
│   └── status.ts        # GET  — statut rue endormie/allumée (réutilise db/streets.ts)
├── join.ts               # POST — inscription (réutilise db/users.ts#registerInhabitant)
├── posts/
│   ├── index.ts          # GET fil filtré / POST publier, y compris upload d'image
│   └── [id]/reponses.ts
├── messages/
│   └── ...                # réutilise db/messages.ts
├── unread-count.ts        # GET — pastille messages non lus (cf. § coût du middleware)
└── push/
    └── register.ts        # POST — enregistre un token Expo push
```

### Coût du middleware global — à corriger dès la fondation

**Constat (revue) :** `routes/_middleware.ts:41-47` fait, sur toute requête
authentifiée, `findSessionUserById` **+** `getStreetHousesStatus` **+**
`hasUnreadMessages` (2 des 3 en parallèle) — 3 requêtes DB pour remplir
`ctx.state` à destination du `<Header>` web. Une page HTML = un rendu, donc
gratuit côté web. Mais Fresh 2 ne permet pas à une route enfant de
« sortir » d'un middleware parent : `routes/api/v1/*` hérite du même
middleware. Un écran mobile qui déclenche 3-5 appels JSON répète donc ces 2
requêtes en plus à chaque fois, pour un résultat jamais lu (aucune route
`/api/*` ne rend de `<Header>`).

**Correctif à faire dans le même commit que la fondation `auth/*` :**

```ts
// routes/_middleware.ts
if (ctx.state.user) {
  if (!ctx.url.pathname.startsWith("/api/")) {
    const [status, unread] = await Promise.all([
      getStreetHousesStatus(ctx.state.user.street.id),
      hasUnreadMessages(ctx.state.user.id),
    ]);
    ctx.state.isStreetAwake = status.isAwake;
    ctx.state.hasUnreadMessages = unread;
  }
}
```

`findSessionUserById` reste appelé pour toute requête authentifiée (web et
API) : c'est la vérification d'identité elle-même, pas une donnée
d'affichage. Le mobile qui a besoin du statut de rue ou du compteur de
messages non lus appelle `streets/status.ts` / `unread-count.ts`
explicitement, seulement quand l'écran concerné en a besoin — pas sur
chaque requête.

### Rate limiting — à prévoir dès la fondation, pas en après-coup

**Constat (revue) :** `utils/rate_limit.ts#createCooldown` existe et est
déjà utilisé côté web (ex. `inviteCooldown` dans `routes/inviter.tsx`),
mais la proposition initiale ne le mentionnait pas pour l'API. Les
endpoints mutants (`POST /api/v1/posts`, `/api/v1/messages`, ...) seront
authentifiés par Bearer seul — un jeton volé ou un client mobile buggé peut
spammer sans qu'aucune limite n'existe pour ces opérations (contrairement
au code OTP, throttlé en base via `loginCodeSentAt`, cf. `db/users.ts`).

Chaque endpoint `/api/v1/*` mutant doit poser son propre `createCooldown`
dès son écriture, sur le même modèle que `inviteCooldown` — pas comme
amélioration ultérieure. Limite connue et acceptée du mécanisme (déjà
documentée dans `rate_limit.ts`) : cooldown en mémoire process, perdu au
redémarrage, non partagé entre instances — sans conséquence ici puisque le
déploiement reste mono-instance (cf. `deploy/README.md`).

### Upload d'image — même endpoint, même contrat que le web

**Constat (revue) :** `routes/fil.tsx` (upload d'image d'une demande) lit
un `multipart/form-data` via `ctx.req.formData()`, extrait un `File`,
vérifie `MAX_IMAGE_UPLOAD_BYTES` (5 Mo) puis appelle
`resizeAndEncodeImage` (`utils/image.ts`). La proposition initiale ne
précisait pas comment le mobile envoie une image.

**Décision : même endpoint (`POST /api/v1/posts`), même
`multipart/form-data`, pas de variante base64.** `fetch` de React Native
sait construire ce type de requête nativement :

```ts
const form = new FormData();
form.append("image", { uri: photo.uri, name: "photo.jpg", type: "image/jpeg" } as unknown as Blob);
```

Le serveur ne voit aucune différence entre web et mobile : `ctx.req
.formData()` reçoit un `File`/`Blob` dans les deux cas, `resizeAndEncodeImage`
et la limite de 5 Mo s'appliquent sans code spécifique à la plateforme. Le
base64 est écarté volontairement : +33 % de poids sur la requête, contraire
à la logique d'éco-conception déjà appliquée à cette fonctionnalité côté
web (redimensionnement serveur, compression avant stockage).

## 2. Authentification mobile : réutiliser `utils/session.ts` tel quel

Le mécanisme actuel (`web/utils/session.ts`) n'est **pas** un cookie
intrinsèquement : c'est un jeton signé opaque
(`<userId>.<expiration>.<HMAC>`), vérifié statelessly puis l'utilisateur
rechargé en base (pas de rôles embarqués, révocation immédiate en cas de
suppression de compte — déjà le comportement voulu). C'est exactement la
forme d'un jeton porteur (« Bearer token ») mobile classique.

Changement minimal dans `routes/_middleware.ts` : accepter la valeur de
session soit via le cookie existant (web), soit via l'en-tête
`Authorization: Bearer <token>` (mobile) — même
`verifySessionValue()`/`findSessionUserById()` des deux côtés, zéro
duplication.

- Stockage côté app : `expo-secure-store` (Keychain iOS / Keystore
  Android), jamais `AsyncStorage` en clair — même exigence que le projet
  applique déjà au web (AGENTS.md R23 : rien de sensible en
  `localStorage`).
- Flux OTP à 6 chiffres inchangé (`utils/otp.ts`, déjà indépendant de
  Fresh) : la seule différence mobile est le transport du jeton résultant.
- CSRF : sans objet pour un client Bearer-only qui n'envoie jamais de
  cookie automatiquement (le risque CSRF vient de l'authentification
  ambiante par cookie) — `routes/api/v1/*` appelé par l'app peut donc rester
  hors du jeton anti-CSRF exigé pour les routes cookie+HTML ; garder ce
  jeton pour tout endpoint encore appelé par les islands web existants.

### Durée de vie et révocation du jeton

**Constat (revue) :** `SESSION_TTL_SECONDS = 30 jours`
(`utils/session.ts:4`), sans mécanisme de révocation autre que la
suppression de compte. Un jeton mobile volé (Keychain compromis,
sauvegarde d'appareil non chiffrée) reste valide jusqu'à 30 jours. Pas
urgent pour le MVP (peu d'utilisateurs, surface d'attaque limitée), mais à
concevoir maintenant pour éviter une migration a posteriori sur une table
`user` déjà peuplée.

**Décision retenue : une révocation globale par utilisateur, pas de table
`revoked_sessions` ni de refresh token** — plus simple, et suffisante pour
le besoin réel (« j'ai perdu mon téléphone, je veux déconnecter toutes mes
sessions »), plutôt qu'une révocation par appareil que rien dans le
backlog ne demande :

- Nouvelle colonne `user.sessionsRevokedAt` (`timestamp`, nullable) — à
  ajouter dans `db/schema.ts` dès l'implémentation de l'étape 1 (fondation
  `auth/*`), en même temps que le reste plutôt qu'en migration séparée
  plus tard.
- Le format du jeton ne change pas (`<userId>.<expiresAt>.<HMAC>`) : comme
  `SESSION_TTL_SECONDS` est fixe, la date d'émission se déduit sans
  changer le payload — `issuedAt = expiresAt - SESSION_TTL_SECONDS`.
- `verifySessionValue` (ou l'appelant dans `_middleware.ts`, une fois
  l'utilisateur chargé) rejette le jeton si
  `issuedAt < user.sessionsRevokedAt`.
- Un bouton « Déconnecter tous mes appareils » dans `/profil` (web) pose
  `sessionsRevokedAt = now()` — cohérent avec le bouton de suppression de
  compte déjà existant sur cette page (« rester maître de mes données »,
  cf. backlog).

## 3. Framework mobile : Expo (React Native), TypeScript de bout en bout

| Option | Verdict |
|---|---|
| **Expo / React Native** | **Retenu.** Composants natifs réels (pas de WebView) → rendu et gestes fidèles à une app native. Un seul langage (TypeScript) sur toute la stack : Deno (backend), Preact (web), React Native (mobile) — un seul écosystème à maintenir, une seule personne peut tout comprendre. |
| Flutter | Cross-platform et rendu natif aussi, mais Dart : un 3ᵉ langage, aucun partage de types/outillage avec le backend TS existant. Pas justifié pour une petite équipe qui cherche à *réduire* la maintenance. |
| Capacitor/Ionic (wrapper du site existant) | Le plus rapide à sortir (réutilise directement le HTML/CSS web), mais reste une WebView : scroll, clavier, transitions, tab bar ne sont jamais tout à fait natifs — contredit directement l'exigence « UI/UX fidèle à une app native ». Apple a déjà rejeté des apps perçues comme de simples wrappers sans valeur ajoutée native (règle 4.2). À garder en tête comme repli si le budget de maintenance s'avère trop juste, pas comme choix de départ. |

Pourquoi Expo précisément (et pas React Native "bare") :

- **Expo Router** : routing par fichiers, le même modèle mental que
  `routes/` côté Fresh — transposition directe pour l'équipe déjà habituée
  à cette convention.
- **EAS Build** : compile iOS et Android dans le cloud, pas besoin d'un Mac
  pour les builds iOS. Cohérent avec la logique déjà appliquée côté serveur
  (`deploy/deploy.sh` build en local/CI, jamais sur la machine cible) —
  garder le build hors de l'infra critique.
- **`expo-updates`** (OTA) : la plupart des correctifs/évolutions JS partent
  en production sans repasser par la revue App Store/Play Store — c'est le
  levier le plus direct pour « réduire la maintenance » d'une app mobile,
  qui autrement impose un cycle de publication à chaque changement.
- **Notifications push** : `expo-notifications` + le service de push Expo
  (une seule API HTTPS, `https://exp.host/--/api/v2/push/send`) abstraient
  APNs et FCM — pas de certificats à gérer à la main, pas d'infra push à
  héberger. Couvre les besoins déjà backlogués (« prévenu par notification
  mobile quand le seuil est atteint »). **Dégradation gracieuse (revue) :**
  même schéma que `sendStreetAwakeningEmail` dans `email/brevo.ts`, déjà
  appelé via `Promise.allSettled` avec les rejets seulement journalisés
  (`console.error`, cf. `routes/rejoindre.tsx:224-240`), jamais remonté en
  échec de la requête principale. Si `exp.host` est indisponible, l'envoi
  du push échoue silencieusement et l'app reste pleinement fonctionnable
  (l'info reste accessible dans le fil/les messages au prochain
  rafraîchissement) — pas de file d'attente/retry à construire pour le
  MVP.

**Style/UI** : pas de kit de composants lourd. Le web s'interdit déjà tout
framework CSS (AGENTS.md : « ne pas réinventer un design system », CSS
vanilla uniquement) — même logique côté mobile : `StyleSheet` React Native
natif + un fichier `lib/theme.ts` qui reprend les tokens de
`assets/common.css` (couleurs `--color-brand` #9a3f12 etc., typo Georgia
pour les titres) pour une identité visuelle cohérente entre web et mobile,
sans dépendance supplémentaire.

**Partage de types (révisé) :** toujours pas de monorepo/outillage
(Turborepo, Nx) — coût disproportionné pour la taille du projet. Mais
« interfaces alignées à la main » entre `web/` et `mobile/` dérive presque
certainement pour une équipe d'une personne (point soulevé en revue).
Alternative plus légère et suffisante ici : un fichier
`web/routes/api/v1/types.ts`, **types uniquement, aucun import runtime**
(pas de `db/schema.ts` exécuté, seulement des `interface`/`type` — au
besoin, `import type` depuis `drizzle-orm`/`db/schema.ts` reste possible :
un `import type` est effacé à la compilation, donc sans coût), importé par
`mobile/lib/api.ts` via chemin relatif :

```ts
import type { PostDto, StreetStatusDto } from "../../web/routes/api/v1/types.ts";
```

Ça fonctionne sans configuration Metro particulière : Babel (le
transpileur d'Expo) supprime les `import type` avant le bundling — Metro ne
tente donc jamais de résoudre/bundler ce fichier, seul `tsc` (vérification
de types, hors bundle) a besoin d'y accéder, ce qu'un simple chemin relatif
permet dans un même dépôt Git. Contraintes pour que ça tienne dans la
durée : le `tsconfig.json` de `mobile/` doit activer
`allowImportingTsExtensions` (import avec l'extension `.ts` explicite,
requis côté Deno) ; `types.ts` ne doit **jamais** gagner d'import runtime
(sinon Metro tenterait de le bundler, et casserait sur les APIs Deno qu'il
ne connaît pas) — à vérifier en CI mobile par un simple `tsc --noEmit`.
Revisiter pour un outillage plus lourd seulement si l'API grossit
beaucoup.

## 4. Structure proposée pour `mobile/`

```
mobile/
├── app/                       # Expo Router — écrans
│   ├── (auth)/
│   │   ├── connexion.tsx      # saisie e-mail
│   │   └── code.tsx           # saisie du code à 6 chiffres
│   ├── (tabs)/
│   │   ├── fil.tsx
│   │   ├── messages.tsx
│   │   └── profil.tsx
│   └── _layout.tsx
├── components/                 # composants RN réutilisables
├── lib/
│   ├── api.ts                  # client fetch → /api/v1, gestion du Bearer token
│   ├── auth.ts                  # expo-secure-store, état de session
│   └── theme.ts                  # tokens repris de assets/common.css
├── app.json / app.config.ts      # nom, icône, splash, bundle id
├── eas.json                       # profils de build EAS
└── package.json
```

Remarque : `mobile/` aura nécessairement son propre `package.json`
(npm/Metro) — l'interdiction « jamais de `package.json` » d'AGENTS.md est
scopée à `web/` (app Deno/Fresh) ; React Native ne tourne pas sur Deno.
Créer un `mobile/AGENTS.md` dédié une fois le projet scaffoldé, sur le même
modèle (structure, commandes, règles non négociables), pour ne pas diluer
les règles Fresh dans un contexte où elles ne s'appliquent pas.

## 5. Impact sur le déploiement (quasi nul)

- **Caddy** proxifie déjà tout `notrerue.fr` vers `127.0.0.1:8000` : les
  nouvelles routes `/api/v1/*` sont exposées automatiquement, aucun
  changement à `deploy/Caddyfile`.
- **`notrerue.service`** : la liste blanche réseau du sandbox systemd
  (`--allow-net=127.0.0.1:5432,localhost:5432,api.brevo.com:443`) doit
  s'élargir à l'hôte du service de push Expo (`exp.host:443`) — une ligne
  à ajouter, même logique que l'ajout déjà fait pour Brevo.
- **RAM** : négligeable (cf. section 1). Pas de changement à
  `MemoryMax=280M`.
- **Aucun nouveau service** à sandboxer/monitorer/sauvegarder : les push
  sont un appel HTTPS sortant synchrone (même schéma que
  `sendStreetAwakeningEmail` dans `email/brevo.ts`), pas de file d'attente
  ni de worker à héberger à l'échelle actuelle (quelques centaines
  d'utilisateurs).

## 6. Ordre de mise en œuvre suggéré

Aligné sur le « Backlog Mobile / MVP » déjà écrit (qui référence
explicitement la réutilisation du web) :

1. `routes/api/v1/auth/*` + Bearer côté `_middleware.ts` — **dans le même
   commit** : le correctif du coût middleware (`/api/` court-circuite
   `getStreetHousesStatus`/`hasUnreadMessages`), la colonne
   `user.sessionsRevokedAt`, et `createCooldown` sur `auth/verify.ts`.
   Fondation de tout le reste, rien de ce qui suit ne doit s'écrire avant.
2. `streets/status.ts` + `unread-count.ts` + `join.ts` (rue endormie,
   compteur, inscription).
3. `posts/*` (fil filtré, publication + upload d'image multipart,
   modération réutilisée telle quelle, `createCooldown` dédié).
4. `messages/*` (messagerie privée, `createCooldown` dédié).
5. Scaffold `mobile/` (Expo + Router + `lib/api.ts`/`lib/auth.ts`) en
   parallèle dès l'étape 1 disponible, écran de connexion d'abord.
6. Push (`push/register.ts` + `expo-notifications`) une fois le reste
   stable — remplace/complète les e-mails de notification déjà en place.

## Ce qu'on évite délibérément

- Un second backend (Node/NestJS/Express) : double l'empreinte mémoire sur
  une machine où elle est déjà comptée au mégaoctet près.
- GraphQL : complexité et dépendance supplémentaires non justifiées, REST
  JSON simple colle exactement au pattern `routes/api/*.ts` déjà en place.
- Un monorepo/outillage de partage de types (Turborepo, Nx) : coût
  d'entretien disproportionné pour la taille de l'équipe et de l'API.
- Une infra push auto-hébergée (certificats APNs/FCM gérés à la main) :
  Expo Push Service fait déjà ce travail.
