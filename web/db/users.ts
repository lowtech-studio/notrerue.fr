import { and, count, eq, isNull, sql } from "drizzle-orm";
import { db } from "./client.ts";
import { house, street, user } from "./schema.ts";
import { STREET_AWAKENING_THRESHOLD } from "./streets.ts";
import {
  generateLoginCode,
  hashLoginCode,
  loginCodeExpiryDate,
  loginCodeMatches,
} from "../utils/otp.ts";
import type { SessionUser } from "../utils.ts";

export type User = typeof user.$inferSelect;

/** Tentatives de code erronées tolérées avant invalidation du code. */
export const MAX_LOGIN_CODE_ATTEMPTS = 5;
/** Délai minimal entre deux envois de code (anti-spam d'e-mails). */
export const LOGIN_CODE_RESEND_MIN_SECONDS = 60;

export interface RegisterInhabitantInput {
  login: string;
  email: string;
  houseNumber: string | null;
  streetId: number;
}

export interface RegisterInhabitantResult {
  user: User;
  code: string;
  /**
   * Vrai si cette inscription vient de faire passer la rue au seuil
   * d'éveil (elle en était en-dessous juste avant). Sert à notifier
   * l'ambassadeur qu'il peut publier sa première demande (cf. backlog).
   */
  streetJustAwakened: boolean;
}

/**
 * Crée le foyer et le compte d'un habitant inscrit sur une rue. `isAmbassador`
 * est déterminé par le nombre de foyers déjà rattachés à la rue au moment de
 * l'inscription (0 ⇒ premier habitant).
 *
 * Transactionnel (foyer + utilisateur) : si l'insert `user` échoue (ex. login
 * ou e-mail déjà pris), le foyer créé juste avant est annulé avec le reste —
 * sinon il restait orphelin et comptait dans `existingHouses`, empêchant à
 * tort le prochain inscrit de devenir ambassadeur.
 *
 * La ligne `street` est verrouillée (`SELECT ... FOR UPDATE`) pour la durée
 * de la transaction : sans ce verrou, deux inscriptions simultanées sur une
 * rue encore vide liraient toutes les deux `existingHouses = 0` et
 * deviendraient chacune ambassadeur.
 */
export async function registerInhabitant(
  input: RegisterInhabitantInput,
): Promise<RegisterInhabitantResult> {
  return await db.transaction(async (tx) => {
    await tx.select({ id: street.id }).from(street)
      .where(eq(street.id, input.streetId))
      .for("update");

    const [{ value: existingHouses }] = await tx.select({ value: count() })
      .from(house).where(and(
        eq(house.streetId, input.streetId),
        isNull(house.deletedAt),
      ));
    const isAmbassador = existingHouses === 0;

    const [createdHouse] = await tx.insert(house).values({
      number: input.houseNumber,
      streetId: input.streetId,
    }).returning();

    const code = generateLoginCode();
    const loginCode = await hashLoginCode(code);
    const loginCodeExpiresAt = loginCodeExpiryDate();

    const [createdUser] = await tx.insert(user).values({
      login: input.login,
      email: input.email,
      houseId: createdHouse.id,
      isAmbassador,
      // Cf. backlog « prouver que les voisins habitent bien dans la même
      // rue » (db/vouches.ts) : l'ambassadeur amorce la chaîne de confiance
      // de sa rue, vérifié dès l'inscription — les suivants doivent être
      // vouchés par un voisin déjà vérifié.
      verifiedAt: isAmbassador ? new Date() : null,
      loginCode,
      loginCodeExpiresAt,
      loginCodeSentAt: new Date(),
    }).returning();

    return {
      user: createdUser,
      code,
      streetJustAwakened: existingHouses + 1 === STREET_AWAKENING_THRESHOLD,
    };
  });
}

/**
 * Habitants actifs (comptes non supprimés) d'une rue. Utilisé pour prévenir
 * tous les inscrits par e-mail quand leur rue atteint le seuil d'éveil.
 */
export async function findStreetUsers(streetId: number): Promise<User[]> {
  const rows = await db.select({ user }).from(user)
    .innerJoin(house, eq(user.houseId, house.id))
    .where(and(
      eq(house.streetId, streetId),
      isNull(user.deletedAt),
    ));
  return rows.map((row) => row.user);
}

/** Compte actif (non soft-supprimé) associé à cet e-mail, s'il existe. */
export async function findUserByEmail(email: string): Promise<User | null> {
  const [found] = await db.select().from(user).where(
    and(eq(user.email, email), isNull(user.deletedAt)),
  );
  return found ?? null;
}

export type StartLoginOutcome =
  | { status: "sent"; user: User; code: string }
  | { status: "throttled" }
  | { status: "not_found" };

/**
 * Génère un nouveau code de connexion pour un compte existant (écran
 * `/connexion`, e-mail seul, ou renvoi). `"throttled"` si un code a déjà été
 * envoyé il y a moins de `LOGIN_CODE_RESEND_MIN_SECONDS` (anti-spam) ;
 * `"not_found"` si l'e-mail n'est pas inscrit. Ces deux cas sont à traiter de
 * façon indistinguable côté route pour ne pas laisser deviner quels e-mails
 * sont inscrits (énumération de comptes).
 */
export async function startLogin(email: string): Promise<StartLoginOutcome> {
  const found = await findUserByEmail(email);
  if (!found) return { status: "not_found" };

  if (
    found.loginCodeSentAt &&
    Date.now() - found.loginCodeSentAt.getTime() <
      LOGIN_CODE_RESEND_MIN_SECONDS * 1000
  ) {
    return { status: "throttled" };
  }

  const code = generateLoginCode();
  const loginCode = await hashLoginCode(code);
  const loginCodeExpiresAt = loginCodeExpiryDate();

  const [updated] = await db.update(user).set({
    loginCode,
    loginCodeExpiresAt,
    loginCodeSentAt: new Date(),
    loginCodeAttempts: 0,
  }).where(eq(user.id, found.id)).returning();

  return { status: "sent", user: updated, code };
}

/**
 * Efface l'horodatage de dernier envoi, après un échec réel de l'envoi de
 * l'e-mail de code (cf. connexion.tsx). `startLogin` pose `loginCodeSentAt`
 * avant que l'appelant ait tenté l'envoi : sans cet effacement, un échec
 * laissait la fenêtre de throttle armée, et un nouvel essai immédiat tombait
 * dans `startLogin` → `{ status: "throttled" }`, silencieusement traité comme
 * un envoi réussi côté route (même redirection `sent=1`) — l'utilisateur
 * attendait alors un code qui n'était jamais arrivé (cf. revue).
 */
export async function clearLoginCodeSentAt(email: string): Promise<void> {
  await db.update(user).set({ loginCodeSentAt: null }).where(
    eq(user.email, email),
  );
}

/**
 * Vérifie le code à 6 chiffres reçu par e-mail. Le code est à usage unique :
 * une vérification réussie l'invalide immédiatement. Après
 * `MAX_LOGIN_CODE_ATTEMPTS` essais erronés, le code est invalidé (protège
 * contre le brute-force d'un code à 6 chiffres) : l'utilisateur doit en
 * redemander un.
 */
export async function verifyLoginCode(
  email: string,
  code: string,
): Promise<User | null> {
  const found = await findUserByEmail(email);
  if (!found || !found.loginCode || !found.loginCodeExpiresAt) return null;
  if (found.loginCodeExpiresAt.getTime() < Date.now()) return null;
  if (found.loginCodeAttempts >= MAX_LOGIN_CODE_ATTEMPTS) return null;

  const matches = await loginCodeMatches(code, found.loginCode);

  if (!matches) {
    const attempts = found.loginCodeAttempts + 1;
    await db.update(user).set({
      loginCodeAttempts: sql`${user.loginCodeAttempts} + 1`,
      ...(attempts >= MAX_LOGIN_CODE_ATTEMPTS
        ? { loginCode: null, loginCodeExpiresAt: null }
        : {}),
    }).where(eq(user.id, found.id));
    return null;
  }

  // Update conditionné à la valeur de `loginCode` lue plus haut : si deux
  // vérifications concurrentes du même code valide arrivent ici, une seule
  // trouve encore la ligne dans cet état et gagne la course.
  const [updated] = await db.update(user).set({
    loginCode: null,
    loginCodeExpiresAt: null,
    loginCodeAttempts: 0,
    lastLoginAt: new Date(),
  }).where(and(eq(user.id, found.id), eq(user.loginCode, found.loginCode)))
    .returning();

  return updated ?? null;
}

/** Charge les données de session (utilisées par routes/_middleware.ts). */
export async function findSessionUserById(
  id: number,
): Promise<SessionUser | null> {
  const found = await db.query.user.findFirst({
    where: and(eq(user.id, id), isNull(user.deletedAt)),
    with: { house: { with: { street: { with: { city: true } } } } },
  });
  if (!found) return null;

  return {
    id: found.id,
    login: found.login,
    email: found.email,
    isAmbassador: found.isAmbassador,
    isVerified: found.verifiedAt !== null,
    street: {
      id: found.house.street.id,
      name: found.house.street.name,
      city: {
        id: found.house.street.city.id,
        name: found.house.street.city.name,
      },
    },
    houseNumber: found.house.number,
  };
}

/**
 * Login + rue d'un compte, actif ou supprimé — utilisé pour afficher une
 * conversation existante avec un compte depuis supprimé (cf.
 * routes/messages.tsx) sans la faire disparaître pour l'autre participant.
 * Contrairement à `findSessionUserById` (qui filtre les comptes supprimés,
 * pensé pour une session active), le login retourné ici peut être le
 * pseudonyme anonymisé posé par `deleteUserAccount` — c'est le but.
 */
export async function findUserLoginForDisplay(
  id: number,
): Promise<{ login: string; streetId: number; isDeleted: boolean } | null> {
  const found = await db.query.user.findFirst({
    where: eq(user.id, id),
    with: { house: { with: { street: true } } },
  });
  if (!found) return null;
  return {
    login: found.login,
    streetId: found.house.street.id,
    isDeleted: found.deletedAt !== null,
  };
}

export interface UpdateUserProfileInput {
  login: string;
  houseNumber: string | null;
}

/**
 * Modifie le login et le numéro de foyer d'un habitant depuis /profil — pas
 * l'e-mail (identifiant de connexion, affiché en lecture seule) ni la
 * rue/ville (rattacher un compte à une autre rue a des implications sur le
 * statut d'ambassadeur, hors scope ici). Laisse l'appelant traduire la
 * violation d'unicité du login (`user_login_unique`, cf. registerInhabitant)
 * en message pour l'utilisateur.
 */
export async function updateUserProfile(
  userId: number,
  input: UpdateUserProfileInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx.select({ houseId: user.houseId }).from(user)
      .where(eq(user.id, userId));
    if (!existing) return;

    await tx.update(user).set({ login: input.login }).where(
      eq(user.id, userId),
    );
    await tx.update(house).set({ number: input.houseNumber }).where(
      eq(house.id, existing.houseId),
    );
  });
}
