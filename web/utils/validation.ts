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
