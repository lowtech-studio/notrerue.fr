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
  utilisateur `postgres` habituel. `/srv/notrerue` (et `bin/` en dessous,
  où vivent les scripts exécutés en root — voir le point suivant)
  appartiennent à **root**, pas à `notrerue` : `useradd --create-home` en
  fait par défaut le foyer de `notrerue`, ce qui laisserait ce compte
  renommer/recréer ces répertoires et y glisser un script piégé, exécuté
  en root au déploiement suivant ou par un timer.
- **Sudo scoped pour `deploy.sh`** : ce script tourne via `ssh host "sudo
  ..."` **sans terminal** — sudo ne peut alors pas demander de mot de passe
  interactif, même si un sudo manuel en SSH fonctionne très bien pour ce
  compte (cf. « Erreurs fréquentes » ci-dessous, régression rencontrée en
  pratique après `harden.sh`). `provision.sh` pose donc un
  `/etc/sudoers.d/90-notrerue-deploy` en `NOPASSWD`, mais **restreint aux
  commandes exactes utilisées par `deploy.sh`** (sauvegarde, publication,
  migrations via le script fixe `migrate.sh`, redémarrage du service) —
  jamais un `NOPASSWD:ALL`.
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
- **Durcissement système complémentaire** (cf. `harden.sh`) : ce que
  `provision.sh` ne couvre pas déjà, d'après ANSSI-BP-028
  (« Recommandations de configuration d'un système GNU/Linux ») — SSH
  (désactivation du login root, timeouts, pas de forwarding), politique de
  mots de passe (complexité, expiration), journalisation `sudo`, sysctl
  noyau complémentaire (ASLR, `kptr_restrict`, `ptrace_scope`...), modules
  noyau obsolètes bloqués (systèmes de fichiers legacy, `usb-storage`),
  core dumps désactivés, `journald` persistant et borné, `cron`/`at`
  restreints à root, bannière légale. Détails et options (`ENABLE_AUDITD`,
  `HARDEN_TMP_NOEXEC`, `SSH_ALLOW_USERS`) en tête du script. À exécuter
  après `provision.sh` (cf. étapes ci-dessous) — idempotent, peut être
  rejoué sans risque.

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

### 1bis. Durcissement système complémentaire (recommandé)

Une fois qu'une connexion SSH par clé fonctionne pour votre compte
d'administration (`ADMIN_USER`, `admin` par défaut) :

```sh
sudo ADMIN_USER=admin bash deploy/harden.sh
```

Voir « Sécurité » ci-dessus pour le détail, et l'en-tête de `harden.sh`
pour les options. **Gardez une session SSH ouverte en parallèle** le temps
de vérifier, dans une nouvelle connexion, que l'accès par clé fonctionne
toujours après le passage du script (il désactive le login root et, si une
clé est trouvée pour `ADMIN_USER`, l'authentification par mot de passe).

### 2. Premier déploiement

Une fois le DNS de `notrerue.fr` pointé vers le serveur et
`/srv/notrerue/shared/notrerue.env` complété (`BREVO_API_KEY`,
`EMAIL_FROM`) :

```sh
VPS_HOST=203.0.113.10 VPS_USER=admin ./deploy/deploy.sh
```

Build en local → envoi → migrations → redémarrage du service. Caddy
obtient son certificat TLS automatiquement au premier accès HTTPS.

Juste après ce tout premier déploiement, lancer **une seule fois**
(`deploy.sh` ne s'en charge pas, cf. `deploy/seed-cities.sh`) :

```sh
VPS_HOST=203.0.113.10 VPS_USER=admin ./deploy/seed-cities.sh
```

Sans ça, la table `city` reste vide et l'autocomplétion ville/rue
(`routes/api/villes.ts`) ne renvoie jamais aucun résultat, sans erreur
visible côté application.

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

Rien de plus lourd n'est recommandé ici : un Prometheus/Grafana/Datadog/
New Relic/netdata local consommerait une part significative (souvent
100-300 Mo) des ~300 Mo de marge libre de ce serveur (cf. « Budget
mémoire » plus haut), pour un besoin que deux mécanismes bien plus légers
couvrent entièrement.

**Panne totale (le serveur ne répond plus)** — un agent local ne peut par
définition pas signaler sa propre panne. Un moniteur externe gratuit
(UptimeRobot, Better Stack...) qui ping `https://notrerue.fr` toutes les
quelques minutes et alerte par e-mail/push suffit largement, sans rien
installer sur ce serveur :

1. Créer un compte sur [uptimerobot.com](https://uptimerobot.com) (gratuit
   jusqu'à 50 moniteurs).
2. Ajouter un moniteur HTTP(S) sur `https://notrerue.fr`, intervalle 5 min.
3. Configurer l'alerte (e-mail suffit pour commencer).

**CPU/RAM/disque qui approchent de leur limite** — `deploy/monitor.sh`,
déclenché toutes les 5 min par `notrerue-monitor.timer` (installé par
`provision.sh`). Contrairement à un agent de supervision classique, il ne
reste jamais en mémoire : il tourne quelques secondes, vérifie les seuils
via `df`/`free`/`/proc/loadavg`, et se termine — coût mémoire ~nul entre
deux exécutions. Alerte par e-mail (Brevo, déjà configuré) uniquement au
franchissement d'un seuil, avec un e-mail de rétablissement quand la
métrique repasse en dessous (pas de spam toutes les 5 min).

Seuils par défaut (adaptés à 1 Go de RAM / 10 Go de disque / 1 vCore),
surchargeables dans `notrerue.env` sans toucher au script :

| Métrique | Seuil par défaut | Variable |
|---|---|---|
| Disque utilisé | 80 % | `MONITOR_DISK_THRESHOLD_PCT` |
| RAM disponible | < 100 Mo | `MONITOR_RAM_AVAILABLE_MIN_MB` |
| Charge CPU (moyenne 5 min) | > 1.5 | `MONITOR_LOAD_THRESHOLD` |

Prérequis : `MONITOR_ALERT_EMAIL` complété dans
`/srv/notrerue/shared/notrerue.env` (cf. message de fin de
`provision.sh`). Test manuel : `sudo /srv/notrerue/bin/monitor.sh`.

### 5. Restaurer une sauvegarde (à tester au moins une fois, hors urgence)

```sh
age --decrypt --identity votre-cle-privee.txt notrerue-<date>.sql.gz.age | gunzip > restore.sql
# Sur le serveur, base vidée ou de test :
sudo -u postgres psql notrerue < restore.sql
```

## Erreurs fréquentes

**`deploy.sh` se termine sans erreur, mais le site ne change pas.** Symptôme
observé en pratique : `systemctl show notrerue.service -p
ActiveEnterTimestamp` montre un redémarrage d'avant le dernier déploiement.
Cause : `deploy.sh` lance `sudo` via `ssh host "sudo ..."`, une session
**sans terminal** — sudo ne peut alors pas afficher de prompt de mot de
passe, même si ce compte a bien du sudo (un `sudo` manuel en SSH interactif
fonctionne très bien, ce qui rend le diagnostic trompeur). Vérifier :

```sh
ssh <user>@<host> "sudo -n systemctl restart notrerue.service; echo EXIT=\$?"
```

`EXIT=1` avec « sudo: interactive authentication is required » confirme le
diagnostic. Le correctif est le `NOPASSWD` scoped posé par `provision.sh`
(cf. « Sécurité » plus haut). Sur un serveur déjà provisionné avant son
ajout : ne PAS rejouer tout `provision.sh` (il refait un `apt-get upgrade`
complet et redémarre Postgres/Caddy — trop lourd juste pour ça). Depuis une
copie à jour du dépôt sur le serveur, en root (remplacer `<user>` par le
compte utilisé pour `deploy.sh`, c'est-à-dire `VPS_USER`) :

```sh
# /srv/notrerue lui-même : root reste propriétaire, jamais notrerue (cf.
# revue, bloquant) — `useradd --create-home` en avait fait le foyer de
# notrerue, propriétaire par défaut. Avec notrerue propriétaire du parent,
# durcir seulement bin/ ne servait à rien : notrerue pouvait renommer/
# recréer bin/ en entier (ça ne dépend que des droits sur le parent) et y
# glisser un script piégé, exécuté en root au déploiement suivant ou par
# le timer monitor.sh (5 min). Le groupe notrerue garde la traversée
# (r-x) pour continuer à lire app/ et shared/ dessous.
chown root:notrerue /srv/notrerue
chmod 750 /srv/notrerue

# bin/ : même raisonnement, un cran plus bas — root reste propriétaire
# (personne ne peut remplacer les scripts exécutés en root), groupe
# notrerue pour que migrate.sh (exécuté sous cette identité, cf. règle
# sudoers plus bas) puisse au moins traverser le répertoire — root:root
# seul l'en empêcherait. Sur un serveur où ce répertoire traînait en 777
# (constaté en pratique), ce chown/chmod referme aussi cette brèche-là.
chown root:notrerue /srv/notrerue/bin
chmod 750 /srv/notrerue/bin

# Cache Deno de migrate.sh (cf. revue) : `sudo -u notrerue` pose
# HOME=/srv/notrerue — sans ce dossier inscriptible, `deno run` échouerait
# à créer son cache par défaut maintenant que /srv/notrerue ne l'est plus
# pour notrerue (chown ci-dessus). Sous shared/ plutôt que app/ : ce
# dernier est resynchronisé avec `--delete` à chaque déploiement, qui
# effacerait le cache à chaque fois.
mkdir -p /srv/notrerue/shared/deno-cache
chown -R notrerue:notrerue /srv/notrerue/shared/deno-cache

# migrate.sh : groupe notrerue (pas propriétaire) — lisible/exécutable par
# ce compte sans qu'il puisse le réécrire lui-même.
install -m 750 -o root -g notrerue deploy/migrate.sh /srv/notrerue/bin/migrate.sh
install -m 750 -o root -g root deploy/backup-pre-deploy.sh /srv/notrerue/bin/backup-pre-deploy.sh

# Fichier temporaire + `visudo -cf` AVANT d'écrire dans /etc/sudoers.d/ —
# jamais directement dedans (cf. revue, bloquant) : une syntaxe invalide
# (ex. `<user>` oublié ci-dessous) laisserait sinon un fichier cassé en
# place, qui casse `sudo` pour tout le serveur (erreur de parsing globale)
# — avec `PermitRootLogin no` posé par harden.sh, un quasi-lockout sans
# console. `install` ne s'exécute que si la validation passe.
SUDOERS_TMP="$(mktemp)"
cat > "$SUDOERS_TMP" <<EOF
<user> ALL=(root) NOPASSWD: /srv/notrerue/bin/backup-pre-deploy.sh
<user> ALL=(root) NOPASSWD: $(command -v rsync) -a --delete /home/<user>/notrerue-deploy-staging/ /srv/notrerue/app/
<user> ALL=(root) NOPASSWD: $(command -v chown) -R notrerue\:notrerue /srv/notrerue/app
<user> ALL=(root) NOPASSWD: $(command -v systemctl) restart notrerue.service
<user> ALL=(root) NOPASSWD: $(command -v systemctl) --no-pager --full status notrerue.service
<user> ALL=(notrerue) NOPASSWD: /srv/notrerue/bin/migrate.sh
EOF
visudo -cf "$SUDOERS_TMP" && install -m 0440 "$SUDOERS_TMP" /etc/sudoers.d/90-notrerue-deploy
rm -f "$SUDOERS_TMP"
```

Pas de wildcard (`*`) dans ces règles — la sauvegarde (noms de fichiers
horodatés) est déléguée à un script fixe (`backup-pre-deploy.sh`, qui fait
son propre glob dans un shell normal) plutôt qu'un `tar`/`rm` inline dans
la règle sudoers : au moins un `sudo` (paquet Ubuntu récent) refuse
catégoriquement tout wildcard dans les arguments d'une commande sudoers
(« wildcards are not allowed in command arguments », durcissement à la
compilation) — une règle qui en contient ne charge simplement jamais,
silencieusement, sans bloquer le reste de la policy pour autant (cf. `sudo
-l` pour voir ce qui est réellement chargé en cas de doute).

C'est exactement ce que produit la section « Sudo scoped pour deploy.sh »
de `provision.sh` — le rejouer en entier plus tard (à un moment calme, pas
en urgence) écrasera ce fichier avec le même contenu, sans effet de bord.

Ne pas « corriger » ce symptôme en augmentant `Defaults timestamp_timeout`
dans `harden.sh` (ou en le supprimant) : ça ne ferait que déplacer le
problème (marche tant qu'un sudo interactif récent a laissé un ticket en
cache, recasse dès qu'il expire) au lieu de le résoudre — le `NOPASSWD`
scoped est la seule solution qui ne dépend pas du timing.

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
