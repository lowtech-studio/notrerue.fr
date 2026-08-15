#!/usr/bin/env bash
# Provisionne un VPS Ubuntu tout neuf (visé : 1 vCore / 1 Go RAM / 10 Go
# NVMe) pour héberger NotreRue.fr : Postgres + Deno (systemd, sans Docker —
# cf. deploy/README.md pour le raisonnement) + Caddy en reverse proxy.
#
# À exécuter UNE FOIS, en root, depuis une copie du dépôt sur le serveur :
#   git clone <votre dépôt> && cd notrerue.fr
#   sudo bash deploy/provision.sh
#
# Pensé pour un premier passage sur un serveur neuf — idempotent dans la
# mesure du possible (les `apt install`/créations répétées ne cassent
# rien), mais à relire avant de le rejouer sur un serveur déjà en prod.
# Ne fait QUE provisionner l'hôte : le premier déploiement applicatif se
# fait ensuite avec deploy/deploy.sh (cf. deploy/README.md).

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Ce script doit être exécuté en root (sudo bash deploy/provision.sh)." >&2
  exit 1
fi

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_USER="notrerue"
# `BASE_DIR` ici, `APP_DIR` dans deploy.sh/notrerue.service : ce script
# provisionne toute l'arborescence /srv/notrerue (app/ + shared/ + .../),
# les autres ne connaissent que /srv/notrerue/app — même préfixe, portée
# différente, d'où le nom différent (évite de confondre les deux en
# relisant les scripts côte à côte).
BASE_DIR="/srv/notrerue"
APP_DIR="$BASE_DIR/app"
DB_NAME="notrerue"
DB_USER="notrerue"

echo "==> Mise à jour du système"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade

echo "==> Paquets de base"
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg rsync jq \
  ufw fail2ban unattended-upgrades apt-listchanges \
  postgresql postgresql-contrib \
  systemd-zram-generator age

echo "==> Utilisateur système dédié à l'application (jamais root)"
id -u "$APP_USER" >/dev/null 2>&1 || \
  useradd --system --home-dir "$BASE_DIR" --shell /usr/sbin/nologin --create-home "$APP_USER"
mkdir -p "$BASE_DIR"/{app,shared,backups,bin}
chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$BASE_DIR/shared"
chmod 750 "$BASE_DIR"

echo "==> Installation de Deno (binaire unique dans /opt/deno)"
if [ ! -x /opt/deno/bin/deno ]; then
  export DENO_INSTALL=/opt/deno
  curl -fsSL https://deno.land/install.sh | sh -s -- --no-modify-path
fi
ln -sf /opt/deno/bin/deno /usr/local/bin/deno
deno --version

echo "==> Installation de Caddy (dépôt officiel — cf. https://caddyserver.com/docs/install si cette étape échoue, l'URL du dépôt évolue parfois)"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y --no-install-recommends debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

echo "==> Base de données"
DB_PASSWORD="$(openssl rand -base64 24)"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASSWORD';"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

echo "==> Réglages Postgres (cf. deploy/postgresql/99-notrerue-tuning.conf)"
PG_VERSION="$(ls /etc/postgresql | head -n1)"
PG_CONFDIR="/etc/postgresql/$PG_VERSION/main/conf.d"
mkdir -p "$PG_CONFDIR"
cp "$DEPLOY_DIR/postgresql/99-notrerue-tuning.conf" "$PG_CONFDIR/"
systemctl restart postgresql

echo "==> Pare-feu (ufw) : SSH + HTTP/HTTPS uniquement — 5432 et 8000 ne sortent jamais du loopback"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "==> fail2ban (jail sshd par défaut suffisante ici)"
systemctl enable --now fail2ban

echo "==> Mises à jour de sécurité automatiques"
cat >/etc/apt/apt.conf.d/51notrerue-unattended-upgrades <<'EOF'
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
EOF
systemctl enable --now unattended-upgrades

echo "==> zram (swap compressé en RAM plutôt qu'un fichier sur le NVMe)"
cp "$DEPLOY_DIR/zram-generator.conf" /etc/systemd/zram-generator.conf
systemctl daemon-reload
systemctl restart systemd-zram-setup@zram0.service || true

echo "==> Durcissement noyau/réseau (sysctl)"
cp "$DEPLOY_DIR/sysctl/99-notrerue-hardening.conf" /etc/sysctl.d/
sysctl --system >/dev/null

echo "==> Reverse proxy Caddy"
cp "$DEPLOY_DIR/Caddyfile" /etc/caddy/Caddyfile
systemctl enable caddy
systemctl restart caddy

echo "==> Service applicatif (pas encore démarré : aucun code déployé pour l'instant)"
cp "$DEPLOY_DIR/notrerue.service" /etc/systemd/system/notrerue.service
cp "$DEPLOY_DIR/notrerue-backup.service" /etc/systemd/system/notrerue-backup.service
cp "$DEPLOY_DIR/notrerue-backup.timer" /etc/systemd/system/notrerue-backup.timer
cp "$DEPLOY_DIR/backup.sh" "$BASE_DIR/bin/backup.sh"
chmod 750 "$BASE_DIR/bin/backup.sh"
cp "$DEPLOY_DIR/notrerue-monitor.service" /etc/systemd/system/notrerue-monitor.service
cp "$DEPLOY_DIR/notrerue-monitor.timer" /etc/systemd/system/notrerue-monitor.timer
cp "$DEPLOY_DIR/monitor.sh" "$BASE_DIR/bin/monitor.sh"
chmod 750 "$BASE_DIR/bin/monitor.sh"
systemctl daemon-reload
systemctl enable notrerue-backup.timer
systemctl start notrerue-backup.timer
systemctl enable notrerue-monitor.timer
systemctl start notrerue-monitor.timer

if [ ! -f "$BASE_DIR/shared/notrerue.env" ]; then
  cat > "$BASE_DIR/shared/notrerue.env" <<EOF
# Complété par provision.sh — copier les valeurs manquantes depuis
# web/.env.example (BREVO_API_KEY, EMAIL_FROM) avant le premier déploiement.
DATABASE_URL=postgres://$DB_USER:$DB_PASSWORD@localhost:5432/$DB_NAME
SESSION_SECRET=$(openssl rand -base64 48)
DATABASE_POOL_MAX=5
BREVO_API_KEY=
EMAIL_FROM=

# Supervision (cf. deploy/monitor.sh) — adresse qui reçoit les alertes
# CPU/RAM/disque. Les seuils ci-dessous ont des valeurs par défaut dans
# monitor.sh (80% / 100 Mo / 1.5) : ne les redéfinir ici que pour les
# changer.
MONITOR_ALERT_EMAIL=
#MONITOR_DISK_THRESHOLD_PCT=80
#MONITOR_RAM_AVAILABLE_MIN_MB=100
#MONITOR_LOAD_THRESHOLD=1.5
EOF
  chown "$APP_USER:$APP_USER" "$BASE_DIR/shared/notrerue.env"
  chmod 640 "$BASE_DIR/shared/notrerue.env"
fi

cat <<EOF

==============================================================================
Provisionnement terminé.

Mot de passe de la base de données ($DB_USER) : $DB_PASSWORD
(déjà écrit dans $BASE_DIR/shared/notrerue.env — ce message ne s'affichera
plus, notez-le ailleurs si besoin d'y accéder sans se reconnecter au serveur)

Reste à faire avant le premier déploiement (cf. deploy/README.md) :
  1. Pointer les DNS (A/AAAA) de notrerue.fr vers ce serveur.
  2. Compléter BREVO_API_KEY, EMAIL_FROM et MONITOR_ALERT_EMAIL dans
     $BASE_DIR/shared/notrerue.env
  3. Générer une paire de clés de sauvegarde HORS de ce serveur
     ('age-keygen'), copier la clé PUBLIQUE dans
     $BASE_DIR/shared/backup-recipient.txt
  4. Créer un moniteur externe gratuit (UptimeRobot...) sur
     https://notrerue.fr — un agent local ne peut pas signaler sa propre
     panne (cf. deploy/README.md « Supervision externe »).
  5. Depuis votre poste : VPS_HOST=... VPS_USER=... ./deploy/deploy.sh
==============================================================================
EOF
