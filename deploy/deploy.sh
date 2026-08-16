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
#   - VPS_USER a un accès SSH par clé, et un sudo NOPASSWD restreint aux
#     commandes ci-dessous (cf. provision.sh « Sudo scoped pour deploy.sh »,
#     DEPLOY_USER doit correspondre à VPS_USER) — ce script tourne via ssh
#     sans terminal, donc sans possibilité de saisir un mot de passe sudo
#     interactif : un sudo « normal » (avec mot de passe) échoue ici, même
#     si un sudo manuel fonctionne très bien en SSH interactif.

set -euo pipefail

VPS_HOST="${VPS_HOST:?Définir VPS_HOST (ex: VPS_HOST=203.0.113.10)}"
VPS_USER="${VPS_USER:-admin}"
APP_DIR="/srv/notrerue/app"
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
ssh "$VPS_USER@$VPS_HOST" "sudo /srv/notrerue/bin/backup-pre-deploy.sh"

echo "==> Publication (droits + emplacement final)"
ssh "$VPS_USER@$VPS_HOST" \
  "sudo rsync -a --delete '$STAGING/' '$APP_DIR/' && sudo chown -R notrerue:notrerue '$APP_DIR'"

echo "==> Migrations de base de données"
ssh "$VPS_USER@$VPS_HOST" "sudo -u notrerue /srv/notrerue/bin/migrate.sh"

echo "==> Redémarrage du service"
ssh "$VPS_USER@$VPS_HOST" "sudo systemctl restart notrerue.service && sudo systemctl --no-pager --full status notrerue.service"

echo "==> Terminé."
