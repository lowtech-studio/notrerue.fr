#!/usr/bin/env bash
# Construit et déploie NotreRue.fr sur le serveur de production.
#
# Le build tourne ICI (poste du développeur, ou une CI) — jamais sur le
# VPS lui-même : sur une machine à 1 Go de RAM, le bundling Vite peut
# créer des pics mémoire que la prod n'a aucune raison de subir (cf.
# deploy/README.md « Où builder »).
#
# Usage :
#   VPS_HOST=203.0.113.10 VPS_USER=admin ./deploy/deploy.sh
#
# Prérequis sur le serveur (cf. deploy/provision.sh, exécuté une fois) :
#   - /srv/notrerue/app existe, appartient à l'utilisateur système "notrerue" ;
#   - /srv/notrerue/shared/notrerue.env contient les variables d'environnement
#     (cf. web/.env.example) ;
#   - VPS_USER a un accès SSH par clé et du sudo côté serveur (pour publier
#     dans /srv/notrerue/app avec les bons droits et redémarrer le service).

set -euo pipefail

VPS_HOST="${VPS_HOST:?Définir VPS_HOST (ex: VPS_HOST=203.0.113.10)}"
VPS_USER="${VPS_USER:-admin}"
APP_DIR="/srv/notrerue/app"
BACKUP_DIR="/srv/notrerue/backups"
STAGING="/home/$VPS_USER/notrerue-deploy-staging"

cd "$(dirname "$0")/../web"

echo "==> Build de production (local)"
deno task build

echo "==> Envoi des fichiers vers une zone intermédiaire (pas encore de sudo requis)"
ssh "$VPS_USER@$VPS_HOST" "mkdir -p '$STAGING'"
rsync -az --delete \
  _fresh db static deno.json deno.lock node_modules \
  "$VPS_USER@$VPS_HOST:$STAGING/"

echo "==> Sauvegarde de la version actuellement déployée (rollback manuel possible)"
ssh "$VPS_USER@$VPS_HOST" "sudo mkdir -p '$BACKUP_DIR' && \
  sudo tar -czf '$BACKUP_DIR/pre-deploy-$(date +%Y%m%d-%H%M%S).tar.gz' -C '$APP_DIR' . 2>/dev/null; \
  cd '$BACKUP_DIR' && ls -t pre-deploy-*.tar.gz 2>/dev/null | tail -n +4 | xargs -r sudo rm --"

echo "==> Publication (droits + emplacement final)"
ssh "$VPS_USER@$VPS_HOST" \
  "sudo rsync -a --delete '$STAGING/' '$APP_DIR/' && sudo chown -R notrerue:notrerue '$APP_DIR'"

echo "==> Migrations de base de données"
ssh "$VPS_USER@$VPS_HOST" \
  "cd '$APP_DIR' && sudo -u notrerue bash -c 'set -a; source /srv/notrerue/shared/notrerue.env; set +a; deno run -A db/migrate.ts'"

echo "==> Redémarrage du service"
ssh "$VPS_USER@$VPS_HOST" "sudo systemctl restart notrerue.service && sudo systemctl --no-pager --full status notrerue.service"

echo "==> Terminé."
