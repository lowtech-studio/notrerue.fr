#!/usr/bin/env bash
# Sauvegarde chiffrée de la base de données, destinée à être envoyée hors
# du serveur — le disque ne fait que 10 Go, on ne garde donc localement que
# le strict nécessaire à un filet de sécurité (cf. deploy/README.md).
#
# Déclenché par deploy/notrerue-backup.timer (quotidien). Peut aussi être
# lancé à la main : sudo /srv/notrerue/bin/backup.sh
#
# Prérequis (une fois, cf. deploy/README.md « Sauvegardes ») :
#   - le paquet `age` installé (chiffrement moderne à clé publique) ;
#   - une paire de clés générée HORS de ce serveur (`age-keygen`) — seule la
#     clé PUBLIQUE vit ici (/srv/notrerue/shared/backup-recipient.txt) ;
#     la clé privée reste chez vous, jamais sur la machine qu'elle protège ;
#   - une destination d'envoi configurée dans le bloc "ENVOI" ci-dessous
#     (rclone, rsync vers un autre hôte...) — aucune n'est fournie par
#     défaut, un dump chiffré qui ne quitte jamais ce disque de 10 Go ne
#     protège de rien en cas de panne matérielle.

set -euo pipefail

BACKUP_DIR=/srv/notrerue/backups
RECIPIENT_FILE=/srv/notrerue/shared/backup-recipient.txt
DB_NAME=notrerue
KEEP_LOCAL=2

STAMP=$(date +%Y%m%d-%H%M%S)
DUMP="$BACKUP_DIR/notrerue-$STAMP.sql.gz"
ENCRYPTED="$DUMP.age"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$RECIPIENT_FILE" ]; then
  echo "Clé publique de sauvegarde manquante : $RECIPIENT_FILE" >&2
  echo "Générez une paire avec 'age-keygen' HORS de ce serveur, puis copiez" >&2
  echo "uniquement la clé publique (ligne 'public key: age1...') ici." >&2
  exit 1
fi

echo "==> pg_dump"
sudo -u postgres pg_dump --format=plain "$DB_NAME" | gzip -9 > "$DUMP"

echo "==> Chiffrement (clé publique : $RECIPIENT_FILE)"
age --encrypt --recipients-file "$RECIPIENT_FILE" --output "$ENCRYPTED" "$DUMP"
rm -f "$DUMP"

echo "==> Envoi hors serveur — À ADAPTER à votre destination réelle"
# Rien n'est envoyé par défaut : décommenter et adapter UNE des lignes
# ci-dessous (ou les deux) selon la destination choisie.
#
#   rclone (S3, Backblaze B2, un autre cloud...) :
#     rclone copy "$ENCRYPTED" remote:notrerue-backups/
#
#   rsync vers un second serveur/NAS déjà accessible en SSH :
#     rsync -az "$ENCRYPTED" backup-host:/backups/notrerue/

echo "==> Nettoyage local (garde les $KEEP_LOCAL plus récentes)"
find "$BACKUP_DIR" -maxdepth 1 -name 'notrerue-*.sql.gz.age' -printf '%T@ %p\n' \
  | sort -rn | tail -n +$((KEEP_LOCAL + 1)) | cut -d' ' -f2- | xargs -r rm --

echo "==> Terminé : $ENCRYPTED"
