# NotreRue.fr — app mobile (Expo)

Client mobile (iOS/Android) de [NotreRue.fr](../web), même backend et même
base que le web — cf. [`_doc/architecture-mobile.md`](../_doc/architecture-mobile.md)
pour les décisions d'architecture et [`_doc/backlog.md`](../_doc/backlog.md)
(section « Backlog Mobile ») pour l'avancement.

## Prérequis

- Node.js **≥ 22.13** (le toolchain Metro d'Expo SDK 57 l'exige — plus
  récent que la version utilisée par `web/`, qui reste sur Deno).
- L'app `Expo Go` sur un téléphone, ou un simulateur iOS/émulateur Android,
  pour tester sans build natif complet. La cible web (`w` dans le CLI Expo,
  ou `npm run web`) reste utilisable pour prévisualiser un écran vite fait,
  mais n'est **pas** une cible distribuée : `lib/auth.ts` y retombe sur
  `localStorage` (`expo-secure-store` ne supporte pas le web) — aucune
  garantie de sécurité réelle sur cette plateforme, contrairement à
  iOS/Android (Keychain/Keystore).

## Démarrer

```sh
cd mobile
npm install
cp .env.example .env   # puis renseigner EXPO_PUBLIC_API_URL (cf. .env.example)
npm start
```

`EXPO_PUBLIC_API_URL` doit pointer vers un serveur `web/` accessible depuis
l'appareil de test — jamais `localhost` pour un téléphone physique ou un
émulateur (résout la boucle locale de l'appareil, pas celle de la machine
qui fait tourner `deno task dev`) : utiliser l'IP locale de cette machine
sur le réseau Wi-Fi, ou `https://notrerue.fr` pour tester contre la prod.

## Problèmes connus au démarrage (`npx expo start`)

- **`An unknown error occurred while installing React Native DevTools`**
  (erreur `chrome-sandbox`, ou plus loin un `execvp`/`zygote_host` qui
  échoue) : outil de debug JS auxiliaire, pas requis pour faire tourner
  l'app — déclenché en pressant `j` dans le CLI Expo. Ignorer l'erreur ;
  Metro continue de servir l'app derrière. Pas de correctif fiable connu
  côté projet (bug d'environnement Linux dans l'outillage `dotslash`
  d'Expo, en dehors de ce dépôt).
- **`Error: spawn .../platform-tools/adb ENOENT`** (en pressant `a` /
  « Opening on Android ») : le SDK Android (`platform-tools`) n'est pas
  installé ou `$ANDROID_HOME` n'est pas configuré sur cette machine. Pas
  besoin d'émulateur Android pour tester : scanner le QR code avec **Expo
  Go** sur un téléphone, ou presser `w` pour la preview web (cf. ci-dessus
  pour ses limites).

## Structure

- `app/` — écrans (Expo Router, routing par fichiers, même logique que
  `web/routes/`) : `(auth)/` (inscription, connexion, code à 6 chiffres),
  `(app)/` (une fois connecté : accueil, **fil** — publier, filtrer,
  rechercher, tapper, répondre, corriger/supprimer ses demandes, cf.
  `routes/api/v1/posts/*` — et **inviter** — feuille de partage native
  (SMS/WhatsApp/e-mail...), cf. `routes/api/v1/streets/status.ts` —,
  messages/profil encore en placeholder, cf. ci-dessous).
- `components/AppHeader.tsx` — en-tête commune aux écrans connectés (menu
  burger, mêmes entrées que `web/components/Header.tsx`) ;
  `components/PlaceholderScreen.tsx` — contenu de repli partagé par les
  écrans pas encore implémentés ; `components/fil/` — composants du fil
  (`PostComposer`, `PostCard`, `PostImage`).
- `lib/api.ts` — client HTTP vers `web/routes/api/v1/*` et
  `web/routes/api/villes.ts`.
- `lib/auth.ts` — jeton de session en Keychain (iOS) / Keystore (Android)
  via `expo-secure-store`, jamais en clair.
- `lib/theme.ts` — tokens visuels repris de `web/assets/common.css` (même
  identité que le web, sans dépendance à un kit UI).
- `lib/relativeDate.ts` — date relative en français, dupliquée de
  `web/utils/relative_date.ts` (import runtime impossible à travers la
  frontière Deno/Metro, cf. `_doc/architecture-mobile.md`).

## Ce qui n'est pas encore là

Le menu burger (cf. `components/AppHeader.tsx`) donne accès à la même
navigation que le web. Le fil est maintenant complet (publier avec photo,
filtrer, rechercher, tapper, répondre publiquement, corriger/supprimer).
Inviter aussi (feuille de partage native). La messagerie et le profil
restent des écrans placeholder : ils dépendent d'endpoints backend pas
encore écrits (`/api/v1/messages`...) — items de backlog distincts (cf.
`_doc/backlog.md`, Backlog Mobile).

## Vérifier

```sh
npm run typecheck
```

Aucun simulateur/device n'a servi à tester visuellement ces écrans lors de
leur écriture (environnement sans runtime iOS/Android) — à vérifier sur un
appareil réel ou Expo Go avant de considérer cette story terminée.
