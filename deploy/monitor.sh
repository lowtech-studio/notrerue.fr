#!/usr/bin/env bash
# Alerte par e-mail (Brevo) si le CPU, la RAM ou le disque approchent de
# leur limite — sur un VPS à 1 Go de RAM / 10 Go de disque, mieux vaut être
# prévenu avant que systemd ne tue l'app (MemoryMax, cf. notrerue.service)
# ou que Postgres refuse d'écrire (disque plein), plutôt que de le
# découvrir dans les logs après coup.
#
# Déclenché par deploy/notrerue-monitor.timer (toutes les 5 min). Peut aussi
# être lancé à la main : sudo /srv/notrerue/bin/monitor.sh
#
# Volontairement pas un agent qui reste en mémoire (Grafana/Prometheus/
# Datadog/netdata mangeraient une bonne partie des ~300 Mo de marge libre
# de ce serveur, cf. deploy/README.md « Budget mémoire ») : ce script
# tourne quelques secondes puis se termine, coût mémoire ~nul entre deux
# exécutions.
#
# N'alerte qu'au FRANCHISSEMENT d'un seuil (pas à chaque exécution) grâce à
# un fichier d'état par métrique dans $STATE_DIR, avec un e-mail de
# rétablissement quand la métrique repasse sous le seuil.
#
# Ne couvre PAS la panne totale du serveur (s'il est down, il ne peut pas
# s'auto-signaler) : pour ça, un moniteur externe est nécessaire (cf.
# deploy/README.md « Supervision externe »).
#
# Dépendance : `jq` (construction du JSON envoyé à Brevo) — installé par
# provision.sh.

set -euo pipefail

ENV_FILE=/srv/notrerue/shared/notrerue.env
STATE_DIR=/srv/notrerue/shared/.monitor-state
DISK_PATH=/

# Seuils par défaut, adaptés à 1 Go de RAM / 10 Go de disque / 1 vCore —
# surchargeables dans notrerue.env sans toucher ce script.
: "${MONITOR_DISK_THRESHOLD_PCT:=80}"
: "${MONITOR_RAM_AVAILABLE_MIN_MB:=100}"
: "${MONITOR_LOAD_THRESHOLD:=1.5}"

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${BREVO_API_KEY:?BREVO_API_KEY manquant dans $ENV_FILE}"
: "${EMAIL_FROM:?EMAIL_FROM manquant dans $ENV_FILE}"
: "${MONITOR_ALERT_EMAIL:?MONITOR_ALERT_EMAIL manquant dans $ENV_FILE (adresse qui reçoit les alertes)}"

mkdir -p "$STATE_DIR"

HOSTNAME_LABEL="$(hostname)"

# Envoie un e-mail via l'API Brevo (même endpoint que web/email/brevo.ts) —
# un script bash n'a pas de raison d'embarquer le layout HTML de l'appli,
# un e-mail texte brut suffit pour une alerte technique. `jq -n` construit
# le JSON avec un échappement correct (sujet/texte jamais interpolés à la
# main dans une chaîne JSON) — dépendance ajoutée dans provision.sh.
send_alert() {
  local subject="$1" text="$2"
  local payload
  payload="$(jq -n \
    --arg from "$EMAIL_FROM" \
    --arg to "$MONITOR_ALERT_EMAIL" \
    --arg subject "$subject" \
    --arg text "$text" \
    '{
      sender: {email: $from, name: "NotreRue.fr — supervision"},
      to: [{email: $to}],
      subject: $subject,
      textContent: $text,
    }')"
  curl -fsS -X POST "https://api.brevo.com/v3/smtp/email" \
    -H "api-key: $BREVO_API_KEY" \
    -H "Content-Type: application/json" \
    -H "Accept: application/json" \
    -d "$payload" >/dev/null
}

# Alerte une seule fois au franchissement du seuil (fichier d'état posé),
# puis une seule fois au rétablissement (fichier d'état retiré) — évite un
# e-mail toutes les 5 min tant que le seuil reste dépassé.
check_threshold() {
  local name="$1" is_over="$2" subject_over="$3" subject_ok="$4" detail="$5"
  local state_file="$STATE_DIR/$name.alerted"

  if [ "$is_over" = "1" ]; then
    if [ ! -f "$state_file" ]; then
      send_alert "🔴 $HOSTNAME_LABEL — $subject_over" "$detail"
      touch "$state_file"
    fi
  else
    if [ -f "$state_file" ]; then
      send_alert "✅ $HOSTNAME_LABEL — $subject_ok" "$detail"
      rm -f "$state_file"
    fi
  fi
}

# --- Disque -----------------------------------------------------------
disk_used_pct="$(df --output=pcent "$DISK_PATH" | tail -1 | tr -dc '0-9')"
disk_over=0
[ "$disk_used_pct" -ge "$MONITOR_DISK_THRESHOLD_PCT" ] && disk_over=1
check_threshold "disk" "$disk_over" \
  "disque à ${disk_used_pct}% (seuil ${MONITOR_DISK_THRESHOLD_PCT}%)" \
  "disque revenu sous ${MONITOR_DISK_THRESHOLD_PCT}%" \
  "$(df -h "$DISK_PATH")"

# --- RAM disponible -----------------------------------------------------
# "available" (pas "free") : Linux utilise la RAM libre comme cache disque,
# donc "free" bas est normal — "available" reflète ce qui est réellement
# récupérable pour un nouveau process.
ram_available_mb="$(free -m | awk '/^Mem:/{print $7}')"
ram_over=0
[ "$ram_available_mb" -le "$MONITOR_RAM_AVAILABLE_MIN_MB" ] && ram_over=1
check_threshold "ram" "$ram_over" \
  "RAM disponible ${ram_available_mb} Mo (seuil ${MONITOR_RAM_AVAILABLE_MIN_MB} Mo)" \
  "RAM disponible revenue au-dessus de ${MONITOR_RAM_AVAILABLE_MIN_MB} Mo" \
  "$(free -h)"

# --- Charge CPU -----------------------------------------------------------
# Moyenne 5 min : un pic de quelques secondes sur 1 vCore n'a rien
# d'anormal, une charge soutenue > seuil si.
load_5min="$(awk '{print $2}' /proc/loadavg)"
load_over=0
awk -v l="$load_5min" -v t="$MONITOR_LOAD_THRESHOLD" 'BEGIN{exit !(l>t)}' && load_over=1
check_threshold "load" "$load_over" \
  "charge CPU (5 min) à ${load_5min} (seuil ${MONITOR_LOAD_THRESHOLD})" \
  "charge CPU revenue sous ${MONITOR_LOAD_THRESHOLD}" \
  "$(uptime)"
