# AGENTS.md (mobile/)

Instructions pour les agents IA et les contributeurs sur ce dossier.
**Portée : uniquement `mobile/`** — les règles Deno/Fresh du `AGENTS.md` à
la racine ne s'appliquent pas ici (toolchain npm/Metro distinct, cf. sa
section « Portée de ce document »).

## Aperçu

Client mobile (iOS/Android) de NotreRue.fr, même backend et même base que
le web (`../web`) — jamais de logique métier dupliquée, cf.
[`../_doc/architecture-mobile.md`](../_doc/architecture-mobile.md) pour les
décisions d'architecture et [`../_doc/backlog.md`](../_doc/backlog.md)
(section « Backlog Mobile ») pour l'avancement.

- **Framework** : Expo (React Native) + Expo Router (routing par fichiers,
  même modèle mental que `web/routes/`)
- **Langage** : TypeScript strict
- **Gestionnaire de paquets** : npm (pas pnpm/yarn — moins de friction avec
  EAS, cf. décision actée avec l'utilisateur)
- **Styles** : `StyleSheet` React Native natif, tokens dans `lib/theme.ts`
  (repris de `web/assets/common.css`) — pas de kit UI, même logique que
  l'interdiction de framework CSS côté web
- **Node.js ≥ 22.13** requis par le toolchain Metro de ce SDK Expo (plus
  récent que ce qu'utilise `web/`, qui est sur Deno)

## Commandes

| Commande | Usage |
|---|---|
| `npm start` | Serveur de dev Expo (Metro) |
| `npm run typecheck` | `tsc --noEmit` — à lancer avant de terminer |
| `npx expo-doctor` | Vérifie la cohérence config/dépendances SDK |
| `npx expo install <pkg>` | Ajouter une dépendance (résout la version compatible SDK) — **jamais** `npm install <pkg>` à la main pour un module natif |
| `npx eas-cli build --profile <profil> --platform all` | Compile iOS/Android via EAS (pas de Mac local requis) — cf. `_doc/publishing-mobile.md` |
| `npx eas-cli submit --platform <ios\|android> --profile production` | Envoie vers TestFlight / la piste interne Play |
| `npx eas-cli update --branch <canal> --message "..."` | Pousse un correctif JS en OTA, sans revue store |

## Structure

```
app/            # écrans, Expo Router (routing par fichiers)
  (auth)/       # inscription, connexion, code à 6 chiffres — non connecté
  (app)/        # une fois connecté
components/
  AppHeader.tsx         # en-tête + menu burger, mêmes entrées que web/components/Header.tsx
  fil/                  # PostComposer, PostCard, PostImage — cf. routes/api/v1/posts/*
lib/
  api.ts            # client HTTP vers web/routes/api/v1/* et web/routes/api/villes.ts
  auth.ts           # jeton de session en Keychain/Keystore (expo-secure-store)
  notifications.ts  # permission + jeton de push Expo (expo-notifications)
  theme.ts          # tokens visuels repris de web/assets/common.css
  relativeDate.ts   # date relative en français, dupliquée de web/utils/relative_date.ts
```

## Règles non négociables

1. **Jeton de session** : toujours via `lib/auth.ts` (`expo-secure-store`,
   Keychain iOS / Keystore Android). **Jamais** `AsyncStorage` en clair, ni
   affiché/journalisé (même exigence que le cookie de session côté web,
   `AGENTS.md` racine « Cyber sécurité » R23/R29).
2. **API** : tout appel réseau passe par `lib/api.ts` (ou `authFetch` pour
   les endpoints authentifiés) — pas de `fetch` ad hoc dispersé dans les
   écrans, une seule source de vérité pour l'URL de base
   (`EXPO_PUBLIC_API_URL`) et la gestion d'erreur.
3. **Dépendances natives** : toujours `npx expo install <pkg>`, jamais
   `npm install <pkg>` à la main — `expo install` résout la version
   compatible avec le SDK installé (cf. `npx expo-doctor` pour détecter un
   écart).
4. **Pas de logique métier dupliquée** : validation, formats, règles
   (âge minimum, longueurs de champs...) vivent côté serveur
   (`web/routes/api/v1/*`) ; l'app affiche les erreurs renvoyées, ne
   réinvente pas les règles.
5. **Identifiants en anglais, commentaires en français** — même convention
   que `web/`.

## Tests

Pas de suite de tests automatisés pour l'instant (`npm run typecheck` +
`npx expo-doctor` sont les seuls filets). Aucun simulateur/device n'est
disponible dans un environnement d'agent sans affichage — un test réel sur
appareil (Expo Go ou build EAS) reste nécessaire avant de considérer un
écran terminé.

## Ne pas modifier

- `node_modules/`, `.expo/` — générés, gitignorés
- `package-lock.json` — modifié uniquement par les commandes `npm`
- `.env` — secrets/config locale, jamais commité (voir `.env.example`)
