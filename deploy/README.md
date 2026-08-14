# Déploiement de production — VPS 1 vCore / 1 Go RAM / 10 Go NVMe

Cible : Ubuntu 26, un seul VPS de très petite taille. Ce document explique
les choix d'architecture et sert de mode d'emploi pour les fichiers de ce
dossier.

## Vue d'ensemble

```
                      Internet
                          │
                    80/443 (ufw)
                          │
                    ┌─────▼─────┐
                    │   Caddy   │  reverse proxy + TLS auto (Let's Encrypt)
                    │           │  + compression (gzip/zstd) + en-têtes
                    └─────┬─────┘
                          │ 127.0.0.1:8000 (jamais exposé au réseau)
                    ┌─────▼─────┐
                    │   Deno    │  systemd, service "notrerue"
                    │  (Fresh)  │  utilisateur système dédié, sandboxé
                    └─────┬─────┘
                          │ 127.0.0.1:5432 (jamais exposé au réseau)
                    ┌─────▼─────┐
                    │ PostgreSQL│  paquet Ubuntu, tuning conf.d
                    └───────────┘
```

Aucun conteneur en production (cf. « Pourquoi pas Docker » ci-dessous) :
trois services natifs gérés par systemd, un pare-feu qui ne laisse rien
d'autre passer, zram en filet de sécurité mémoire plutôt qu'un swap sur
disque.

## Pourquoi pas Docker

Le dépôt utilise Docker Compose en développement (`compose.yaml`, à la
racine) — c'est pratique pour itérer, mais sur un serveur à **1 Go de RAM
au total**, `dockerd` + `containerd` ajoutent facilement 100-200 Mo de frais
fixes avant même de démarrer un conteneur. Sur un budget aussi serré, c'est
une fraction du total qui manquera ailleurs.

Mesuré en conditions réelles sur ce projet (conteneurs de dev, donc plutôt
pessimiste pour la partie appli qui tourne ici avec le rechargement à
chaud actif) :

| Composant | Mesuré | Contexte |
|---|---|---|
| Deno (serveur de dev, HMR actif) | 218 Mo | `docker stats`, conteneur de dev |
| Deno (`deno serve` sur le build de prod) | **75 Mo** | mesuré directement, après quelques requêtes |
| PostgreSQL (config par défaut, base quasi vide) | 43 Mo | `docker stats`, conteneur de dev |

Le chiffre qui compte pour la prod est celui du milieu (75 Mo) : le serveur
de développement (Vite, HMR, rechargement à chaud) ne tourne jamais en
production — `deploy/deploy.sh` construit le bundle ailleurs et ne livre
que le résultat (cf. « Où builder »).

Sans Docker, l'isolation entre services est assurée par systemd
(`ProtectSystem=strict`, `NoNewPrivileges`, capacités réduites à zéro,
appels système filtrés — cf. `notrerue.service`) plutôt que par des
espaces de noms de conteneur : une isolation réelle, correctement testée
par le projet systemd lui-même, pour un coût mémoire proche de zéro.

## Budget mémoire (1 Go total)

| Poste | Budget | Remarque |
|---|---|---|
| Noyau + systemd + services de base | ~150-200 Mo | Ubuntu minimal |
| PostgreSQL | ~200-250 Mo max | tuning dans `postgresql/99-notrerue-tuning.conf` |
| Deno (application) | ~220-280 Mo max | plafonné par `MemoryMax` dans `notrerue.service` |
| Caddy | ~20-40 Mo | reverse proxy |
| fail2ban | ~10-15 Mo | |
| **Marge libre / cache disque** | **~250-350 Mo** | zram en filet de sécurité au-delà |

Les plafonds (`MemoryMax` du service Deno, `shared_buffers`/`work_mem` de
Postgres) sont volontairement fermes : mieux vaut qu'un service dérivant en
mémoire soit tué et redémarré par systemd (`Restart=on-failure`) que de
laisser l'OOM killer du noyau choisir une victime au hasard sur la machine
entière.

## Où builder

`deno task build` (Vite + esbuild) peut créer des pics mémoire significatifs
pendant le bundling — inutile de les infliger à un serveur qui doit rester
disponible pendant l'opération. `deploy/deploy.sh` construit **en local
(ou en CI)**, puis n'envoie que :

- `_fresh/` — le build de production (~quelques Mo, autonome : testé sans
  `node_modules` ni les sources, fonctionne seul) ;
- `db/` — les sources nécessaires à `deno run -A db/migrate.ts`, exécuté
  séparément du serveur (pas via le bundle Vite) ;
- `static/`, `deno.json`, `deno.lock`, `node_modules/` (~120 Mo, largement
  dans le budget des 10 Go de disque — pas d'optimisation agressive
  nécessaire ici, contrairement à la RAM).

## Sécurité

- **Réseau** : `ufw` n'ouvre que 22 (SSH), 80 et 443. PostgreSQL
  (`listen_addresses = 'localhost'`) et l'application (`--host 127.0.0.1`)
  ne sont jamais joignables depuis l'extérieur, même en cas d'erreur de
  configuration du pare-feu (défense en profondeur : deux couches
  indépendantes).
- **Permissions Deno réduites** (testées en conditions réelles, cf.
  `notrerue.service`) : `--allow-net` limité à Postgres (loopback) et
  l'API Brevo (`api.brevo.com:443`, envoi des e-mails), `--allow-read`
  limité au répertoire de l'application. Pas de `-A`/`--allow-all` en
  production.
- **Sandboxing systemd** : `ProtectSystem=strict`, `ProtectHome`,
  `NoNewPrivileges`, capacités Linux réduites à zéro, appels système
  filtrés (`SystemCallFilter=@system-service`) — cf. tous les détails et
  leur justification dans `notrerue.service`.
- **TLS** : automatique et auto-renouvelé par Caddy (Let's Encrypt), HSTS
  posé (`Strict-Transport-Security`). Les en-têtes applicatifs (CSP,
  `X-Frame-Options`, `Referrer-Policy`) restent posés par l'application
  elle-même (`web/main.ts`, `web/routes/_middleware.ts`) — le proxy ne les
  duplique pas, une seule source de vérité.
- **Comptes** : l'application tourne sous un utilisateur système dédié
  (`notrerue`, sans shell de connexion), jamais root. PostgreSQL sous son
  utilisateur `postgres` habituel.
- **SSH** : accès par clé uniquement — désactiver l'authentification par
  mot de passe et la connexion root dans `/etc/ssh/sshd_config`
  (`PasswordAuthentication no`, `PermitRootLogin no`) puis
  `systemctl reload ssh`. **Vérifier qu'une connexion par clé fonctionne
  avant de couper les mots de passe**, sous peine de se retrouver hors du
  serveur. `fail2ban` protège la porte SSH contre le brute-force en
  attendant.
- **Mises à jour** : `unattended-upgrades` applique automatiquement les
  correctifs de sécurité (jamais de redémarrage automatique — à surveiller
  manuellement, ou à activer si les coupures de quelques secondes sont
  acceptables).
- **Sauvegardes chiffrées hors site** (cf. `backup.sh`) : `pg_dump` →
  chiffrement `age` à clé publique → envoi hors du serveur (rclone/rsync,
  à configurer). La clé privée ne vit jamais sur ce serveur : même
  totalement compromis, il ne peut pas déchiffrer ses propres sauvegardes.
  Disque de 10 Go oblige, seules les 2 dernières sauvegardes chiffrées
  restent en local, le reste doit vivre ailleurs.

## Étapes

### 1. Provisionnement (une seule fois)

```sh
git clone <votre dépôt> notrerue.fr && cd notrerue.fr
sudo bash deploy/provision.sh
```

Installe et configure Postgres, Deno, Caddy, ufw, fail2ban,
unattended-upgrades, zram, le durcissement sysctl, et prépare (sans les
démarrer) les services `notrerue`/`notrerue-backup`. Affiche à la fin les
étapes manuelles restantes (DNS, clés Brevo, clé de sauvegarde).

### 2. Premier déploiement

Une fois le DNS de `notrerue.fr` pointé vers le serveur et
`/srv/notrerue/shared/notrerue.env` complété (`BREVO_API_KEY`,
`EMAIL_FROM`) :

```sh
VPS_HOST=203.0.113.10 VPS_USER=admin ./deploy/deploy.sh
```

Build en local → envoi → migrations → redémarrage du service. Caddy
obtient son certificat TLS automatiquement au premier accès HTTPS.

### 3. Déploiements suivants

Même commande. `deploy.sh` garde une archive de la version précédente dans
`/srv/notrerue/backups/pre-deploy-*.tar.gz` (les 3 dernières) pour un
retour en arrière manuel si besoin :

```sh
ssh admin@203.0.113.10
sudo tar -xzf /srv/notrerue/backups/pre-deploy-<date>.tar.gz -C /srv/notrerue/app
sudo systemctl restart notrerue.service
```

### 4. Logs et supervision

```sh
sudo journalctl -u notrerue.service -f       # logs applicatifs
sudo journalctl -u caddy.service -f          # accès/erreurs du reverse proxy
sudo systemctl status notrerue.service postgresql caddy
```

Rien de plus lourd n'est recommandé ici : un Prometheus/Grafana local
consommerait une part significative des 1 Go disponibles pour surveiller
une machine qui n'en a pas les moyens. Pour un contrôle de disponibilité
externe, un service de "uptime monitoring" gratuit (ping HTTP périodique
depuis l'extérieur) suffit largement à ce stade, sans rien installer ici.

### 5. Restaurer une sauvegarde (à tester au moins une fois, hors urgence)

```sh
age --decrypt --identity votre-cle-privee.txt notrerue-<date>.sql.gz.age | gunzip > restore.sql
# Sur le serveur, base vidée ou de test :
sudo -u postgres psql notrerue < restore.sql
```

## Limites connues

Ce budget est volontairement serré. S'il faut composer avec plus de
trafic (plusieurs rues actives simultanément, pièces jointes/photos une
fois cette fonctionnalité construite...), les premiers signes à surveiller
sont : `journalctl -u notrerue.service` montrant des redémarrages
`Restart=on-failure` répétés (le plafond `MemoryMax` est atteint), ou
`sudo -u postgres psql -c "SELECT * FROM pg_stat_activity"` montrant des
connexions qui attendent (le pool de 5, `DATABASE_POOL_MAX`, sature). Le
premier réflexe reste alors de monter le VPS d'un cran plutôt que de
complexifier l'architecture (pas de cache applicatif, pas de réplique de
lecture, etc. tant que ce n'est pas nécessaire).
