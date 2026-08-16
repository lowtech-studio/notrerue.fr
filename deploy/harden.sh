#!/usr/bin/env bash
# Durcissement système complémentaire, basé sur ANSSI-BP-028
# (« Recommandations de configuration d'un système GNU/Linux », v2.0 —
# https://cyber.gouv.fr/, cf. lien fourni par l'utilisateur pour ce script :
# fr_np_linux_configuration-v2.0.pdf).
#
# `deploy/provision.sh` pose déjà la base (ufw, fail2ban, sysctl réseau,
# unattended-upgrades, sandboxing systemd du service applicatif — cf.
# deploy/README.md « Sécurité »). Ce script couvre ce qu'ANSSI-BP-028
# recommande en plus, au niveau système (SSH, comptes/mots de passe, sudo,
# noyau, journalisation) : à exécuter APRÈS provision.sh, une fois, en root.
#
#   sudo bash deploy/harden.sh
#
# Idempotent : chaque section peut être rejouée sans effet de bord. Les
# réglages qui présentent un vrai risque de casse ou de perte d'accès sont
# DÉSACTIVÉS PAR DÉFAUT et s'activent explicitement par variable
# d'environnement (cf. section correspondante et le résumé affiché à la fin) :
#
#   ADMIN_USER=admin ./deploy/harden.sh   # compte à vérifier avant de couper
#                                          # l'authentification par mot de passe SSH
#                                          # (par défaut : "admin", cf. VPS_USER
#                                          # dans deploy/deploy.sh)
#   ENABLE_AUDITD=yes ./deploy/harden.sh  # auditd — coût mémoire/disque non
#                                          # nul, cf. section dédiée
#   HARDEN_TMP_NOEXEC=yes ./deploy/harden.sh  # noexec,nosuid,nodev sur
#                                          # /tmp, /var/tmp, /dev/shm — peut
#                                          # casser un outil qui exécute
#                                          # depuis /tmp (rare, mais existe)
#   SSH_ALLOW_USERS="admin deploy" ./deploy/harden.sh  # restreint SSH
#                                          # (AllowUsers) à ces comptes —
#                                          # vide par défaut (pas de
#                                          # restriction)
#
# Ce script NE remplace PAS une relecture humaine : c'est un point de départ
# raisonnable, pas un audit de conformité. À exécuter dans un terminal que
# vous pouvez vous permettre de perdre (gardez une session SSH ouverte en
# parallèle tant que vous n'avez pas vérifié la reconnexion — cf. section SSH).

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Ce script doit être exécuté en root (sudo bash deploy/harden.sh)." >&2
  exit 1
fi

ADMIN_USER="${ADMIN_USER:-admin}"
ENABLE_AUDITD="${ENABLE_AUDITD:-no}"
HARDEN_TMP_NOEXEC="${HARDEN_TMP_NOEXEC:-no}"
SSH_ALLOW_USERS="${SSH_ALLOW_USERS:-}"

BACKUP_DIR="/root/harden-backups"
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"

# Sauvegarde un fichier existant une seule fois par exécution, avant de le
# modifier — permet un retour arrière manuel (cf. résumé final).
backup_once() {
  local f="$1"
  [ -f "$f" ] || return 0
  cp -a "$f" "$BACKUP_DIR/$(basename "$f").$STAMP.bak"
}

SUMMARY_APPLIED=()
SUMMARY_SKIPPED=()
SUMMARY_MANUAL=()

# ---------------------------------------------------------------------------
echo "==> SSH (ANSSI-BP-028 R7/R35 — accès distant)"
# ---------------------------------------------------------------------------
# Drop-in dédié plutôt que d'éditer sshd_config en place : idempotent (on
# réécrit tout le fichier à chaque exécution), et sans risque de dupliquer
# ou de mal ré-écraser une directive existante. Ubuntu inclut déjà
# `Include /etc/ssh/sshd_config.d/*.conf` en tête de sshd_config — on
# vérifie plutôt que de le supposer, pour les images qui ne l'ont pas.
SSHD_CONFIG=/etc/ssh/sshd_config
SSHD_DROPIN_DIR=/etc/ssh/sshd_config.d
# Préfixe "00-" et non "98-" : sshd_config.d/ est lu par ordre lexicographique
# et sshd retient la PREMIÈRE valeur rencontrée pour la plupart des
# directives (sshd_config(5) : « the first obtained value will be used »).
# Sur les images cloud Ubuntu, un 50-cloud-init.conf avec
# `PasswordAuthentication yes` est courant : avec un préfixe "98-" il
# primerait silencieusement sur ce drop-in.
SSHD_DROPIN="$SSHD_DROPIN_DIR/00-anssi-hardening.conf"
mkdir -p "$SSHD_DROPIN_DIR"

if ! grep -qE '^\s*Include\s+/etc/ssh/sshd_config\.d/\*\.conf' "$SSHD_CONFIG" 2>/dev/null; then
  backup_once "$SSHD_CONFIG"
  sed -i '1i Include /etc/ssh/sshd_config.d/*.conf' "$SSHD_CONFIG"
fi

# On ne coupe l'authentification par mot de passe que si une clé publique
# est déjà en place pour ADMIN_USER — sinon on se retrouverait hors du
# serveur à la prochaine déconnexion. Vérifiez ADMIN_USER (variable
# d'environnement, "admin" par défaut) avant de lancer ce script si votre
# compte d'administration porte un autre nom.
if id "$ADMIN_USER" >/dev/null 2>&1 && \
   [ -s "/home/$ADMIN_USER/.ssh/authorized_keys" ]; then
  PW_AUTH_DIRECTIVE="PasswordAuthentication no"
  SUMMARY_APPLIED+=("SSH : authentification par mot de passe désactivée (clé trouvée pour $ADMIN_USER)")
else
  PW_AUTH_DIRECTIVE="# PasswordAuthentication no  # désactivé : pas de clé pour \$ADMIN_USER=$ADMIN_USER dans /home/$ADMIN_USER/.ssh/authorized_keys"
  SUMMARY_SKIPPED+=("SSH : authentification par mot de passe LAISSÉE ACTIVE — aucune clé trouvée pour ADMIN_USER=$ADMIN_USER. Ajoutez une clé puis relancez.")
fi

cat > "$SSHD_DROPIN" <<EOF
# Généré par deploy/harden.sh (ANSSI-BP-028) — ne pas éditer à la main,
# les changements seront écrasés au prochain passage du script.

PermitRootLogin no
PermitEmptyPasswords no
$PW_AUTH_DIRECTIVE
X11Forwarding no
AllowTcpForwarding no
AllowAgentForwarding no
PermitTunnel no
MaxAuthTries 4
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
LogLevel VERBOSE
Banner /etc/issue.net
EOF

if [ -n "$SSH_ALLOW_USERS" ]; then
  echo "AllowUsers $SSH_ALLOW_USERS" >> "$SSHD_DROPIN"
  SUMMARY_APPLIED+=("SSH : accès restreint à AllowUsers=$SSH_ALLOW_USERS")
fi

if sshd -t 2>/tmp/sshd-config-test.log; then
  if systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null; then
    SUMMARY_APPLIED+=("SSH : durcissement appliqué (root login désactivé, forwarding désactivé, timeouts, cf. $SSHD_DROPIN)")
    # `sshd -t` ne valide que la syntaxe : on vérifie ici la valeur EFFECTIVE
    # après reload, au cas où un autre fichier de $SSHD_DROPIN_DIR primerait
    # sur le nôtre (cf. commentaire sur SSHD_DROPIN ci-dessus).
    EFFECTIVE_PW_AUTH="$(sshd -T 2>/dev/null | awk 'tolower($1)=="passwordauthentication"{print tolower($2)}')"
    EFFECTIVE_ROOT_LOGIN="$(sshd -T 2>/dev/null | awk 'tolower($1)=="permitrootlogin"{print tolower($2)}')"
    if [ "$PW_AUTH_DIRECTIVE" = "PasswordAuthentication no" ] && [ "$EFFECTIVE_PW_AUTH" != "no" ]; then
      SUMMARY_MANUAL+=("SSH : ATTENTION — PasswordAuthentication effectif = '$EFFECTIVE_PW_AUTH' malgré la directive 'no' posée dans $SSHD_DROPIN. Un autre fichier de $SSHD_DROPIN_DIR (lu avant, par ordre lexicographique) prime probablement — vérifiez avec 'sshd -T | grep -i passwordauthentication'.")
    fi
    if [ "$EFFECTIVE_ROOT_LOGIN" != "no" ]; then
      SUMMARY_MANUAL+=("SSH : ATTENTION — PermitRootLogin effectif = '$EFFECTIVE_ROOT_LOGIN' malgré la directive 'no' posée dans $SSHD_DROPIN. Vérifiez avec 'sshd -T | grep -i permitrootlogin' et les fichiers de $SSHD_DROPIN_DIR.")
    fi
  else
    SUMMARY_SKIPPED+=("SSH : configuration écrite ($SSHD_DROPIN) mais le reload du service (ssh/sshd) a ÉCHOUÉ — non active tant que le service n'est pas rechargé/redémarré manuellement.")
  fi
else
  echo "ERREUR : configuration SSH invalide, non appliquée :" >&2
  cat /tmp/sshd-config-test.log >&2
  rm -f "$SSHD_DROPIN"
  SUMMARY_SKIPPED+=("SSH : durcissement NON appliqué (sshd -t a échoué, cf. message ci-dessus)")
fi
SUMMARY_MANUAL+=("SSH : ouvrez une NOUVELLE session avant de fermer celle-ci, pour vérifier que la connexion par clé fonctionne toujours.")

# ---------------------------------------------------------------------------
echo "==> Bannière légale (ANSSI-BP-028 R6)"
# ---------------------------------------------------------------------------
for f in /etc/issue /etc/issue.net; do
  cat > "$f" <<'EOF'
Accès réservé aux personnes autorisées.
Toute tentative de connexion non autorisée est susceptible de poursuites.
EOF
done
SUMMARY_APPLIED+=("Bannière légale posée (/etc/issue, /etc/issue.net)")

# ---------------------------------------------------------------------------
echo "==> Sysctl noyau/réseau complémentaire (ANSSI-BP-028 R14/R48)"
# ---------------------------------------------------------------------------
# Complète deploy/sysctl/99-notrerue-hardening.conf (déjà posé par
# provision.sh) sans le dupliquer.
mkdir -p /etc/sysctl.d
cat > /etc/sysctl.d/98-anssi-hardening.conf <<'EOF'
# Durcissement noyau complémentaire — ANSSI-BP-028. Généré par
# deploy/harden.sh (cf. deploy/sysctl/99-notrerue-hardening.conf pour le
# volet réseau déjà posé par provision.sh).

# ASLR complet (déjà la valeur par défaut sur la plupart des noyaux
# récents, posé explicitement pour ne pas en dépendre).
kernel.randomize_va_space = 2

# Masque les adresses mémoire noyau exposées via /proc — limite la
# fuite d'informations utile à l'exploitation de vulnérabilités noyau.
kernel.kptr_restrict = 2

# Restreint dmesg aux utilisateurs privilégiés (CAP_SYSLOG).
kernel.dmesg_restrict = 1

# Limite ptrace() aux processus qui ont un lien de parenté direct —
# réduit la surface d'une élévation de privilèges via un autre process.
kernel.yama.ptrace_scope = 1

# Désactive la combinaison de touches magique SysRq (accès console
# local uniquement, sans usage ici — un VPS n'a pas de clavier physique).
kernel.sysrq = 0

# Journalise les paquets "martiens" (source invalide) déjà filtrés par
# rp_filter — utile pour l'investigation, pas seulement le blocage.
net.ipv4.conf.all.log_martians = 1
net.ipv4.conf.default.log_martians = 1

# Protection contre l'attaque "time-wait assassination" (RFC 1337).
net.ipv4.tcp_rfc1337 = 1

# Durcissement des liens symboliques/hardlinks/FIFO dans les répertoires
# world-writable (/tmp...) — protège contre des classes de TOCTOU
# classiques, sans coût fonctionnel pour cette application.
fs.protected_hardlinks = 1
fs.protected_symlinks = 1
fs.protected_fifos = 2
fs.protected_regular = 2
EOF
sysctl --system >/dev/null
SUMMARY_APPLIED+=("Sysctl : durcissement noyau complémentaire appliqué (/etc/sysctl.d/98-anssi-hardening.conf)")

# ---------------------------------------------------------------------------
echo "==> Modules noyau inutiles sur ce serveur (ANSSI-BP-028 R21)"
# ---------------------------------------------------------------------------
# Systèmes de fichiers obsolètes/rarement utilisés et stockage USB — aucun
# usage légitime sur ce serveur applicatif sans accès physique. `install
# ... /bin/true` bloque le chargement du module sans faire échouer
# bruyamment un `modprobe` qui le demanderait par erreur.
cat > /etc/modprobe.d/98-anssi-hardening.conf <<'EOF'
# Modules désactivés — ANSSI-BP-028. Généré par deploy/harden.sh.
install cramfs /bin/true
install freevxfs /bin/true
install jffs2 /bin/true
install hfs /bin/true
install hfsplus /bin/true
install udf /bin/true
install usb-storage /bin/true
EOF
SUMMARY_APPLIED+=("Modules noyau : systèmes de fichiers obsolètes et usb-storage bloqués (/etc/modprobe.d/98-anssi-hardening.conf)")
SUMMARY_MANUAL+=("Modules noyau : effet complet après reboot si l'un d'eux était déjà chargé (peu probable sur ce type de VPS) — vérifier avec 'lsmod'.")

# ---------------------------------------------------------------------------
echo "==> Core dumps désactivés globalement (ANSSI-BP-028 R25)"
# ---------------------------------------------------------------------------
cat > /etc/security/limits.d/98-anssi-hardening.conf <<'EOF'
# Aucun processus de ce serveur n'a besoin de core dumps en usage normal
# (déjà posé pour les binaires setuid via fs.suid_dumpable=0, cf.
# deploy/sysctl/99-notrerue-hardening.conf — ceci couvre le cas général).
* hard core 0
EOF
mkdir -p /etc/systemd/coredump.conf.d
cat > /etc/systemd/coredump.conf.d/98-anssi-hardening.conf <<'EOF'
[Coredump]
Storage=none
ProcessSizeMax=0
EOF
SUMMARY_APPLIED+=("Core dumps désactivés globalement (limits.d + systemd-coredump)")

# ---------------------------------------------------------------------------
echo "==> Politique de mots de passe (ANSSI-BP-028 R9/R10)"
# ---------------------------------------------------------------------------
apt-get install -y --no-install-recommends libpam-pwquality >/dev/null

PWQUALITY_CONF=/etc/security/pwquality.conf
backup_once "$PWQUALITY_CONF"
touch "$PWQUALITY_CONF"
for kv in "minlen = 12" "dcredit = -1" "ucredit = -1" "lcredit = -1" "ocredit = -1" "retry = 3"; do
  key="${kv%% =*}"
  if grep -qE "^\s*${key}\s*=" "$PWQUALITY_CONF"; then
    sed -i -E "s|^\s*${key}\s*=.*|${kv}|" "$PWQUALITY_CONF"
  else
    echo "$kv" >> "$PWQUALITY_CONF"
  fi
done

LOGIN_DEFS=/etc/login.defs
backup_once "$LOGIN_DEFS"
for kv in "PASS_MAX_DAYS 90" "PASS_MIN_DAYS 1" "PASS_WARN_AGE 14" "UMASK 027"; do
  key="$(echo "$kv" | awk '{print $1}')"
  if grep -qE "^\s*${key}\s+" "$LOGIN_DEFS"; then
    sed -i -E "s|^\s*${key}\s+.*|${kv}|" "$LOGIN_DEFS"
  else
    echo "$kv" >> "$LOGIN_DEFS"
  fi
done
SUMMARY_APPLIED+=("Mots de passe : complexité (pwquality) + expiration (login.defs) + umask 027 par défaut")
SUMMARY_MANUAL+=("Mots de passe : la politique ne s'applique qu'aux futurs changements de mot de passe, pas rétroactivement.")

# ---------------------------------------------------------------------------
echo "==> sudo (ANSSI-BP-028 R11)"
# ---------------------------------------------------------------------------
SUDOERS_DROPIN=/etc/sudoers.d/98-anssi-hardening
SUDOERS_TMP="$(mktemp)"
cat > "$SUDOERS_TMP" <<'EOF'
# Généré par deploy/harden.sh (ANSSI-BP-028).
Defaults logfile="/var/log/sudo.log"
Defaults use_pty
Defaults passwd_tries=3
Defaults timestamp_timeout=5
EOF
if visudo -cf "$SUDOERS_TMP" >/dev/null; then
  install -m 0440 "$SUDOERS_TMP" "$SUDOERS_DROPIN"
  SUMMARY_APPLIED+=("sudo : journalisation (/var/log/sudo.log), pty forcé, timeout de session réduit à 5 min")
else
  echo "ERREUR : syntaxe sudoers invalide, non appliqué." >&2
  SUMMARY_SKIPPED+=("sudo : durcissement NON appliqué (syntaxe invalide)")
fi
rm -f "$SUDOERS_TMP"

# ---------------------------------------------------------------------------
echo "==> cron/at restreints à root (ANSSI-BP-028 R23 — aucun autre compte n'en a l'usage ici)"
# ---------------------------------------------------------------------------
echo root > /etc/cron.allow
chmod 600 /etc/cron.allow
echo root > /etc/at.allow
chmod 600 /etc/at.allow
SUMMARY_APPLIED+=("cron/at : restreints au compte root (l'application utilise des timers systemd, cf. deploy/notrerue-backup.timer)")

# ---------------------------------------------------------------------------
echo "==> journald : logs persistants mais bornés (ANSSI-BP-028 R42)"
# ---------------------------------------------------------------------------
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/98-anssi-hardening.conf <<'EOF'
[Journal]
Storage=persistent
Compress=yes
# Borné pour rester dans le budget disque de 10 Go (cf. deploy/README.md).
SystemMaxUse=150M
EOF
systemctl restart systemd-journald
SUMMARY_APPLIED+=("journald : logs persistants entre reboots, bornés à 150 Mo")

# ---------------------------------------------------------------------------
echo "==> AppArmor (ANSSI-BP-028 R22) — vérification, pas de changement de profil"
# ---------------------------------------------------------------------------
# Ubuntu active AppArmor par défaut : on s'assure juste que le service
# tourne. On NE force PAS le mode "enforce" sur tous les profils
# automatiquement — un profil mal calibré pour Caddy/Postgres pourrait
# casser le service au lieu de le protéger ; à revoir à la main avec
# `aa-status` si des profils apparaissent en mode "complain".
if command -v aa-status >/dev/null 2>&1; then
  systemctl enable --now apparmor >/dev/null 2>&1 || true
  SUMMARY_APPLIED+=("AppArmor : service vérifié actif")
  SUMMARY_MANUAL+=("AppArmor : lancez 'sudo aa-status' et passez en 'enforce' (aa-enforce) les profils encore en 'complain' pertinents pour ce serveur.")
else
  SUMMARY_MANUAL+=("AppArmor : non installé sur ce système — envisager 'apt install apparmor apparmor-utils' si le noyau le supporte.")
fi

# ---------------------------------------------------------------------------
echo "==> Fichiers world-writable en dehors des zones attendues (rapport seul, ANSSI-BP-028 R24)"
# ---------------------------------------------------------------------------
# Recherche à titre de rapport uniquement : un chmod automatique sur des
# fichiers inconnus est plus dangereux que la situation qu'il corrige.
WW_REPORT="$BACKUP_DIR/world-writable-$STAMP.txt"
find / -xdev -type f -perm -0002 \
  -not -path '/proc/*' -not -path '/sys/*' -not -path '/tmp/*' \
  -not -path '/var/tmp/*' -not -path '/dev/shm/*' -not -path '/run/*' \
  > "$WW_REPORT" 2>/dev/null || true
if [ -s "$WW_REPORT" ]; then
  SUMMARY_MANUAL+=("Fichiers world-writable inattendus trouvés — à relire : $WW_REPORT")
else
  rm -f "$WW_REPORT"
  SUMMARY_APPLIED+=("Aucun fichier world-writable inattendu trouvé hors /tmp, /var/tmp, /dev/shm")
fi

# ---------------------------------------------------------------------------
echo "==> auditd (ANSSI-BP-028 R43) — optionnel, ENABLE_AUDITD=$ENABLE_AUDITD"
# ---------------------------------------------------------------------------
if [ "$ENABLE_AUDITD" = "yes" ]; then
  apt-get install -y --no-install-recommends auditd audispd-plugins >/dev/null
  # auditd ne lit pas de conf.d sur les versions packagées ici : on ajuste
  # le fichier principal directement pour rester compatible.
  AUDITD_CONF=/etc/audit/auditd.conf
  backup_once "$AUDITD_CONF"
  sed -i -E 's|^max_log_file\s*=.*|max_log_file = 20|' "$AUDITD_CONF" || true
  sed -i -E 's|^num_logs\s*=.*|num_logs = 3|' "$AUDITD_CONF" || true

  # La règle -w ci-dessous porte sur /var/log/sudo.log : rien ne garantit
  # qu'un `sudo` journalisé a déjà eu lieu à ce stade, on s'assure donc que
  # le fichier existe avant le chargement du ruleset.
  touch -a /var/log/sudo.log

  mkdir -p /etc/audit/rules.d
  cat > /etc/audit/rules.d/98-anssi-hardening.rules <<'EOF'
# Règles minimales — identité, élévation de privilèges, configuration
# réseau/SSH, horloge système. Volontairement restreint (pas de -a
# exit,always sur des syscalls larges type execve) pour rester dans le
# budget mémoire/disque d'un VPS 1 Go de RAM.
-w /etc/passwd -p wa -k identity
-w /etc/shadow -p wa -k identity
-w /etc/group -p wa -k identity
-w /etc/sudoers -p wa -k identity
-w /etc/sudoers.d/ -p wa -k identity
-w /etc/ssh/sshd_config -p wa -k sshd
-w /etc/ssh/sshd_config.d/ -p wa -k sshd
-w /var/log/sudo.log -p wa -k sudo_log
-w /sbin/insmod -p x -k modules
-w /sbin/rmmod -p x -k modules
-w /sbin/modprobe -p x -k modules
-a always,exit -F arch=b64 -S settimeofday,clock_settime -k time_change
EOF
  systemctl enable --now auditd
  if augenrules --load; then
    SUMMARY_APPLIED+=("auditd : installé, ruleset minimal (identité, sudo, SSH, modules, horloge), logs bornés à 60 Mo")
  else
    SUMMARY_MANUAL+=("auditd : installé, mais le chargement du ruleset ('augenrules --load') a ÉCHOUÉ — le ruleset n'est probablement pas actif, à diagnostiquer et recharger manuellement.")
  fi
else
  SUMMARY_SKIPPED+=("auditd : non installé (ENABLE_AUDITD=yes pour l'activer — coût mémoire/disque non nul sur ce budget serré, cf. deploy/README.md)")
fi

# ---------------------------------------------------------------------------
echo "==> /tmp, /var/tmp, /dev/shm en noexec,nosuid,nodev (ANSSI-BP-028 R18) — optionnel, HARDEN_TMP_NOEXEC=$HARDEN_TMP_NOEXEC"
# ---------------------------------------------------------------------------
if [ "$HARDEN_TMP_NOEXEC" = "yes" ]; then
  backup_once /etc/fstab
  for mnt in /tmp /var/tmp; do
    if ! grep -qE "^\S+\s+${mnt}\s" /etc/fstab; then
      echo "$mnt   $mnt   none   defaults,bind,nodev,nosuid,noexec   0   0" >> /etc/fstab
    fi
  done
  mount -o remount /tmp 2>/dev/null || mount --bind /tmp /tmp
  mount -o remount,nodev,nosuid,noexec /tmp 2>/dev/null || true
  mount -o remount /var/tmp 2>/dev/null || mount --bind /var/tmp /var/tmp
  mount -o remount,nodev,nosuid,noexec /var/tmp 2>/dev/null || true
  if mountpoint -q /dev/shm; then
    mount -o remount,nodev,nosuid,noexec /dev/shm 2>/dev/null || true
  fi
  SUMMARY_APPLIED+=("/tmp, /var/tmp, /dev/shm : montés en noexec,nosuid,nodev")
  SUMMARY_MANUAL+=("/tmp noexec : si une installation apt échoue ensuite avec un message lié à /tmp, c'est probablement ça — repasser HARDEN_TMP_NOEXEC=no et retirer les lignes ajoutées dans /etc/fstab.")
else
  SUMMARY_SKIPPED+=("/tmp, /var/tmp, /dev/shm : options par défaut conservées (HARDEN_TMP_NOEXEC=yes pour durcir — peut casser un outil qui exécute depuis /tmp)")
fi

# ---------------------------------------------------------------------------
echo "==> Synchronisation horaire (ANSSI-BP-028 R41)"
# ---------------------------------------------------------------------------
systemctl enable --now systemd-timesyncd >/dev/null 2>&1 || true
SUMMARY_APPLIED+=("Synchronisation horaire (systemd-timesyncd) vérifiée active")

# ---------------------------------------------------------------------------
echo ""
echo "=============================================================================="
echo "Durcissement terminé."
echo ""
echo "Appliqué :"
for l in "${SUMMARY_APPLIED[@]:-}"; do [ -n "$l" ] && echo "  - $l"; done
echo ""
if [ "${#SUMMARY_SKIPPED[@]}" -gt 0 ]; then
  echo "Non appliqué (volontairement, ou faute de prérequis) :"
  for l in "${SUMMARY_SKIPPED[@]}"; do echo "  - $l"; done
  echo ""
fi
echo "À vérifier/compléter à la main :"
for l in "${SUMMARY_MANUAL[@]:-}"; do [ -n "$l" ] && echo "  - $l"; done
echo ""
echo "Sauvegardes des fichiers modifiés : $BACKUP_DIR"
echo "=============================================================================="
