/**
 * Longueur maximale d'une adresse e-mail (RFC 5321, enveloppe MAIL FROM/RCPT
 * TO : 254 caractères). Partagé entre /connexion et /rejoindre pour rester
 * cohérent.
 */
export const MAX_EMAIL_LENGTH = 254;

/** Longueur maximale du login. Partagé entre /rejoindre et /profil (même
 * champ, modifiable une fois le compte créé). */
export const MAX_LOGIN_LENGTH = 40;

/** Longueur maximale du numéro de foyer. Partagé entre /rejoindre et
 * /profil (même champ). */
export const MAX_HOUSE_NUMBER_LENGTH = 10;

/**
 * Échappe `%`, `_` et `\` pour qu'un texte saisi par l'utilisateur soit
 * traité comme littéral dans un motif SQL `LIKE`/`ILIKE` (via `ESCAPE '\'`,
 * l'échappement par défaut de Postgres) plutôt que comme un joker. Sans ça,
 * chercher « 100% » ou « rue_x » se comporterait comme un joker inattendu
 * pour l'utilisateur (pas une injection : la requête reste paramétrée).
 */
export function escapeLikePattern(raw: string): string {
  return raw.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Chemin de retour (champ caché `back`) : seul /fil affiche des demandes
 * éditables/supprimables, donc seul ce préfixe est accepté — un `back`
 * forgé pointant ailleurs (voire vers un autre domaine, `//evil.example`)
 * retombe sur `fallback` plutôt que d'être suivi tel quel (open redirect).
 * Partagé entre /modifier et /supprimer, seules routes à accepter un `back`
 * en clair (cf. revue : code de sécurité, pas de duplication assumée ici
 * contrairement au CSS).
 */
export function resolvePostBackPath(raw: string, fallback: string): string {
  return raw.startsWith("/fil") ? raw : fallback;
}

/**
 * Paramètres de requête « flash » : posés par une redirection pour faire
 * remonter un état ponctuel (bandeau de confirmation/erreur) à /fil, sans
 * session ni flash côté serveur. Un seul à la fois a du sens — cf.
 * `withQueryParam` ci-dessous.
 */
const FLASH_QUERY_PARAMS = [
  "published",
  "deleted",
  "edit_error",
  "reponse_error",
  "verif_error",
];

/**
 * Ajoute (ou remplace) un paramètre de requête « flash » sur un chemin local
 * (`/fil?type=cherche`…), en préservant les paramètres de filtre déjà
 * présents (`type`, `q`, `page`…). Retire d'abord les autres paramètres
 * flash : `back` est capturé sur la page d'origine et peut encore porter un
 * flash d'une action précédente (ex. `?published=1`) — sans ce nettoyage,
 * une suppression après une publication réafficherait le bandeau « publiée »
 * en plus (ou à la place) de « supprimée ».
 */
export function withQueryParam(
  path: string,
  key: string,
  value: string,
): string {
  // Base arbitraire : seuls `pathname` + `search` sont réutilisés, jamais
  // l'origine (le chemin passé ici est toujours local, cf. resolvePostBackPath).
  const url = new URL(path, "http://localhost");
  for (const flashParam of FLASH_QUERY_PARAMS) {
    url.searchParams.delete(flashParam);
  }
  url.searchParams.set(key, value);
  return url.pathname + url.search;
}
