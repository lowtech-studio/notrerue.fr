#!/usr/bin/env bash
# Charge le référentiel des communes françaises (web/db/seed/communes.csv,
# ~35 000 lignes) dans la base de production — à lancer UNE SEULE FOIS,
# après le tout premier déploiement (cf. deploy/README.md « Premier
# déploiement »). Sans ce script, la table `city` reste vide et
# l'autocomplétion ville/rue (routes/api/villes.ts) ne renvoie jamais
# aucun résultat, sans erreur visible côté application.
#
# Idempotent (`onConflictDoNothing` sur `inseeCode`, cf. db/seed-cities.ts) :
# sans danger de le relancer, par exemple après une mise à jour du CSV.
#
# Usage :
#   VPS_HOST=203.0.113.10 VPS_USER=admin ./deploy/seed-cities.sh

set -euo pipefail

VPS_HOST="${VPS_HOST:?Définir VPS_HOST (ex: VPS_HOST=203.0.113.10)}"
VPS_USER="${VPS_USER:-admin}"
APP_DIR="/srv/notrerue/app"

echo "==> Seed des communes (db/seed/communes.csv → table city)"
ssh "$VPS_USER@$VPS_HOST" \
  "cd '$APP_DIR' && sudo -u notrerue bash -c 'set -a; source /srv/notrerue/shared/notrerue.env; set +a; deno task db:seed-cities'"

echo "==> Terminé."
