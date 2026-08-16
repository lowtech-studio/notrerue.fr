#!/usr/bin/env bash
# Sauvegarde la version actuellement déployée avant publication (rollback
# manuel possible, cf. deploy/README.md « Déploiements suivants ») —
# installé par provision.sh dans /srv/notrerue/bin/backup-pre-deploy.sh,
# exécuté par deploy.sh via `sudo` (root : lit /srv/notrerue/app, dont des
# fichiers appartenant à l'utilisateur système notrerue, et écrit dans
# /srv/notrerue/backups qui appartient à root).
#
# Un script fixe plutôt que les commandes tar/rm inline d'origine dans
# deploy.sh : la politique sudoers NOPASSWD (cf. provision.sh) ne peut
# cibler qu'une commande exacte — les noms de fichiers horodatés
# (pre-deploy-<date>.tar.gz) rendaient les règles précédentes dépendantes
# de wildcards dans les arguments, que le sudo de ce serveur refuse
# catégoriquement à l'exécution (« wildcards are not allowed in command
# arguments » — durcissement à la compilation, pas désactivable via une
# ligne `Defaults`). Le glob se fait ici, dans un shell normal, jamais
# dans la policy sudoers elle-même.

set -euo pipefail

BACKUP_DIR=/srv/notrerue/backups
APP_DIR=/srv/notrerue/app

mkdir -p "$BACKUP_DIR"

# Best-effort : échoue silencieusement (tar vide/absent) au tout premier
# déploiement, quand $APP_DIR n'a encore rien à archiver — le reste du
# déploiement ne doit pas en dépendre. Nom capturé dans une variable (pas
# recalculé via `$(date ...)` une seconde fois) : `tar -czf` crée son
# fichier de sortie AVANT que `-C "$APP_DIR" .` échoue, une archive
# vide/partielle resterait donc sinon sur le disque, comptant parmi les 3
# conservées ci-dessous et pouvant passer pour un rollback valide (cf.
# revue).
ARCHIVE="$BACKUP_DIR/pre-deploy-$(date +%Y%m%d-%H%M%S).tar.gz"
if ! tar -czf "$ARCHIVE" -C "$APP_DIR" . 2>/dev/null; then
  rm -f "$ARCHIVE"
  echo "Avertissement : sauvegarde pre-deploy échouée (normal si $APP_DIR est encore vide, ex. tout premier déploiement)." >&2
fi

# Ne garde que les 3 plus récentes (disque de 10 Go, cf. deploy/README.md).
# `|| true` final : si aucune archive n'existe encore (tar ci-dessus a
# échoué et aucun déploiement précédent n'en a laissé), `ls` sort en erreur
# sur le glob non résolu et `pipefail` ferait échouer tout le script — donc
# tout deploy.sh — alors que ce nettoyage est best-effort par nature (cf.
# revue).
cd "$BACKUP_DIR"
ls -t pre-deploy-*.tar.gz 2>/dev/null | tail -n +4 | xargs -r rm -- || true
