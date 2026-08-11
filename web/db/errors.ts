import postgres from "postgres";

/**
 * Vrai si `error` est une violation de contrainte unique Postgres sur
 * `constraintName` (ex. `user_login_unique`) — utilisé pour transformer une
 * erreur d'écriture en message utilisateur (cf. /rejoindre, /profil).
 *
 * drizzle-orm (≥ 0.45) enveloppe l'erreur postgres.js d'origine dans un
 * `DrizzleQueryError` : l'objet `postgres.PostgresError` utile (avec `.code`
 * et `.constraint_name`) se trouve alors dans `error.cause`, pas dans
 * `error` lui-même — un `error instanceof postgres.PostgresError` direct ne
 * matche donc plus rien depuis cette version (constaté en testant /profil,
 * cf. revue).
 */
export function isUniqueViolation(
  error: unknown,
  constraintName: string,
): boolean {
  const cause = error instanceof Error && error.cause instanceof Error
    ? error.cause
    : error;
  return cause instanceof postgres.PostgresError && cause.code === "23505" &&
    cause.constraint_name === constraintName;
}
