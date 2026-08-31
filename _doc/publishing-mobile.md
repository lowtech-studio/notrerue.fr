# Publication de l'app mobile (EAS Build, TestFlight, Play Console, OTA)

Cf. backlog mobile « Mettre en place la chaîne de build et de publication ».
Objectif : livrer et corriger l'app sans dépendre d'une revue store à
chaque changement — EAS Build pour compiler iOS/Android sans Mac local,
TestFlight/Play Console (piste interne) pour la distribution aux
testeurs, et `expo-updates` pour pousser des correctifs JS instantanément.

**Ce que ce document couvre par avance (déjà fait dans le dépôt)** vs **ce
qui exige vos propres comptes** (personne d'autre ne peut le faire à votre
place — identifiants, moyens de paiement, 2FA) : voir la checklist en fin
de document.

## Prérequis — comptes à créer vous-même

Rien de ce qui suit ne peut être automatisé par un agent : ce sont vos
comptes, vos identifiants, votre carte bancaire.

| Compte | Coût | Pourquoi | Lien |
|---|---|---|---|
| Compte Expo (EAS) | Gratuit (plan Free suffit au départ) | Héberge les builds et les mises à jour OTA | https://expo.dev/signup |
| Apple Developer Program | 99 $/an | Obligatoire pour compiler pour iOS, distribuer via TestFlight, et publier sur l'App Store | https://developer.apple.com/programs/ |
| Google Play Console | 25 $ (paiement unique) | Obligatoire pour publier sur Android (piste interne comprise) | https://play.google.com/console/signup |

**Node.js ≥ 22.13** est déjà un prérequis du dépôt (cf. `mobile/AGENTS.md`)
— `eas-cli` (utilisé ici via `npx eas-cli`, pas besoin d'installation
globale) l'exige aussi.

## Ce qui est déjà prêt dans le dépôt

- `mobile/eas.json` : trois profils de build —
  - `development` : client de développement, distribution interne, pointe
    sur `http://localhost:8000` (pas de canal OTA : un client de dev se
    connecte directement à Metro, pas à `expo-updates`).
  - `preview` : distribution interne (TestFlight interne / piste interne
    Play), pointe sur `https://notrerue.fr`, canal OTA `preview`.
  - `production` : `autoIncrement` (numéro de build auto-incrémenté à
    chaque soumission), pointe sur `https://notrerue.fr`, canal OTA
    `production`.
- `mobile/app.json` : plugin `expo-updates` déclaré,
  `runtimeVersion.policy: "fingerprint"` — la compatibilité d'une mise à
  jour OTA avec un build donné est calculée automatiquement à partir de
  l'empreinte réelle du code natif (dépendances natives, config), plutôt
  que de compter sur un numéro de version incrémenté à la main
  (`policy: "appVersion"` serait plus simple à comprendre mais plus
  fragile : un oubli de bump après l'ajout d'une dépendance native
  enverrait un bundle JS incompatible à un vieux build).
- `expo-updates` installé (`npx expo install`, cf. `package.json`).
- Identifiants d'app déjà choisis et cohérents entre les deux plateformes :
  `fr.notrerue.app` (`ios.bundleIdentifier` / `android.package`).

**Volontairement pas encore dans `app.json`** : `extra.eas.projectId` et
`updates.url`. Ces deux valeurs sont propres à *votre* projet EAS — les
écrire à la main avec une valeur inventée casserait la configuration au
lieu de l'anticiper. `eas init` (étape 2 ci-dessous) les génère et les
écrit lui-même.

## Mise en place (une fois, dans `mobile/`)

```sh
cd mobile
npx eas-cli login                 # 1. connexion à votre compte Expo
npx eas-cli init                  # 2. lie ce dossier à un projet EAS,
                                   #    écrit extra.eas.projectId dans app.json
npx eas-cli update:configure      # 3. écrit updates.url dans app.json
```

### Identifiants de signature (iOS/Android)

- **Android** : à la première exécution de `eas build --platform android`,
  EAS propose de générer et stocker un keystore de production pour vous
  (recommandé — pas de fichier à gérer localement, cf. `eas credentials`
  pour le retrouver plus tard).
- **iOS** : `eas build --platform ios` demande votre Apple ID à la
  première exécution et peut gérer certificat + profil de provisionnement
  automatiquement (recommandé), à condition que le compte ait accès au
  compte développeur Apple concerné. Alternative : générer soi-même via
  `eas credentials --platform ios` si vous préférez garder la main.

### Créer les fiches d'application (à faire une fois, manuellement)

EAS compile et soumet, mais ne crée pas la fiche d'app à votre place :

- **App Store Connect** (https://appstoreconnect.apple.com) : créer l'app
  avec le bundle ID `fr.notrerue.app` avant le premier `eas submit
  --platform ios`.
- **Google Play Console** : créer l'app, remplir la fiche minimale
  (description, icône, catégorie, politique de confidentialité — cf.
  exigences Play). **Point d'attention connu** : Play Console exige un
  premier envoi manuel d'un `.aab` avant d'accepter des envois automatisés
  — le tout premier build de production s'uploade donc à la main dans la
  console, les suivants peuvent passer par `eas submit`.
- **Service account Google (pour `eas submit --platform android`)** :
  créer un compte de service dans Google Cloud Console avec l'API "Google
  Play Android Developer" activée, lui donner accès à l'app dans Play
  Console, télécharger sa clé JSON. **Ne jamais committer ce fichier** —
  le placer hors du dépôt (ex. `~/.config/notrerue/play-service-account.json`)
  et référencer son chemin dans `mobile/eas.json` sous
  `submit.production.android.serviceAccountKeyPath`, ou laisser `eas
  submit` le demander interactivement à chaque fois.

## Usage courant

### Compiler

```sh
# Build de test à distribuer en interne (TestFlight interne / piste interne Play)
npx eas-cli build --profile preview --platform all

# Build de production (à soumettre aux stores)
npx eas-cli build --profile production --platform all
```

### Soumettre aux stores

```sh
npx eas-cli submit --platform ios --profile production      # → TestFlight
npx eas-cli submit --platform android --profile production  # → piste interne Play
```

TestFlight (test interne) et la piste interne Play sont immédiats, sans
revue — c'est là que les testeurs internes (jusqu'à 100 par plateforme)
récupèrent les builds. Promouvoir vers la revue publique (App Store /
production Play) reste une action manuelle et volontaire, plus tard,
séparée de ce flux.

### Corriger sans repasser par un store (mise à jour OTA)

Pour un changement JS/TS pur (pas de nouvelle dépendance native, pas de
changement de `app.json` natif) :

```sh
npx eas-cli update --branch production --message "Corrige le formulaire d'inscription"
```

Tous les appareils sur le canal `production` (cf. `eas.json`) téléchargent
la mise à jour au prochain lancement de l'app, **sans repasser par une
revue store**. C'est précisément l'objectif de cet item de backlog.

**Limite à connaître** : si le changement touche au code natif (nouvelle
dépendance ajoutée via `npx expo install`, modification de `app.json` côté
natif...), l'empreinte (`fingerprint`) change — `eas update` ne suffit
plus, il faut un nouveau `eas build` + soumission.

## Checklist

- [*] Compte Expo créé, `npx eas-cli login` fait
- [ ] Compte Apple Developer Program actif (99 $/an)
- [*] Compte Google Play Console actif (25 $, une fois)
- [*] `npx eas-cli init` exécuté (`extra.eas.projectId` apparaît dans `app.json`)
- [*] `npx eas-cli update:configure` exécuté (`updates.url` apparaît dans `app.json`)
- [ ] Fiche App Store Connect créée (`fr.notrerue.app`)
- [ ] Fiche Google Play Console créée, premier `.aab` envoyé à la main
- [ ] Service account Google créé, clé JSON récupérée (hors dépôt)
- [ ] Premier `eas build --profile preview --platform all` réussi
- [ ] Premiers testeurs internes ajoutés (TestFlight + Play Console)
