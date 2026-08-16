#!/usr/bin/env bash
# Lance les migrations de base de données avec les variables d'environnement
# de production — installé par provision.sh dans /srv/notrerue/bin/migrate.sh,
# exécuté par deploy.sh via `sudo -u notrerue`.
#
# Une commande fixe plutôt qu'un `bash -c '...'` inline (comme avant) : la
# politique sudoers NOPASSWD posée par provision.sh (cf. « Sudo scoped pour
# deploy.sh ») ne peut accorder l'exécution sans mot de passe qu'à une
# commande exacte, jamais à une chaîne shell arbitraire — sans quoi il
# faudrait soit un NOPASSWD bien plus large (risqué), soit taper le mot de
# passe à chaque déploiement (impossible : deploy.sh tourne via ssh sans
# terminal, cf. deploy/README.md).

set -euo pipefail

# `sudo -u notrerue` pose HOME=/srv/notrerue (foyer système de ce compte,
# cf. provision.sh) — sans DENO_DIR explicite, `deno run` chercherait à
# créer son cache par défaut sous $HOME/.cache/deno, or /srv/notrerue n'est
# plus inscriptible par notrerue (cf. revue, chown root:notrerue du
# répertoire lui-même) et cet échec ferait échouer toute migration.
# shared/deno-cache (pré-créé et chowné à notrerue par provision.sh) plutôt
# que sous app/ : ce dernier est resynchronisé avec `--delete` à chaque
# déploiement (cf. deploy.sh), qui effacerait le cache à chaque fois.
export DENO_DIR=/srv/notrerue/shared/deno-cache

cd /srv/notrerue/app
set -a
source /srv/notrerue/shared/notrerue.env
set +a
exec deno run -A db/migrate.ts
