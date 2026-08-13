# notrerue.fr

Une plateforme d'entraide, communication, échange au sein d'une rue et favoriser
le partage entre voisins... But : « Nous rapprocher les uns des autres » ou «
Recréer du lien entre voisins »

## Stack

Fresh 2 (Deno) + Preact + Postgres. Détails et conventions de contribution
dans [AGENTS.md](AGENTS.md).

## Démarrer en développement

```sh
docker compose up
```

Sert l'application avec rechargement à chaud sur http://localhost:5173 et une
base Postgres locale (identifiants dans `compose.yaml`, dev uniquement).

Sans Docker : `cd web && deno task dev` (nécessite un Postgres accessible via
`DATABASE_URL`, cf. ci-dessous).

## Variables d'environnement

Copier `web/.env.example` en `web/.env` et compléter — voir ce fichier pour
la liste et le rôle de chaque variable (`DATABASE_URL`, `SESSION_SECRET`,
`BREVO_API_KEY`, `EMAIL_FROM`, `DATABASE_POOL_MAX`).

## Déploiement (cible : Raspberry Pi)

```sh
cd web
deno task build   # build de production → _fresh/
deno task start   # sert le build via deno serve
```

Réglages pensés pour un matériel modeste (RAM/E-S disque limitées) :

- Pool de connexions Postgres borné à `DATABASE_POOL_MAX` (5 par défaut, cf.
  `web/db/client.ts`) plutôt que la valeur par défaut du driver.
- Index dédiés sur les colonnes de clé étrangère réellement filtrées/jointes
  par les requêtes de l'app (cf. `web/db/schema.ts`), pour éviter les scans
  complets à mesure que les tables grossissent.
- `Cache-Control` explicite sur les assets statiques rarement modifiés
  (captures d'écran, icônes — cf. `web/utils/static_cache.ts`) en plus du
  cache immuable déjà posé par Fresh sur les fichiers buildés par Vite (noms
  hashés).

Aucun reverse proxy n'est fourni ici : en placer un (Caddy, par exemple)
devant `deno task start` reste recommandé en production pour la compression
et le TLS.
