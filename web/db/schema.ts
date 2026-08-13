import { relations, sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Trois types de demande, tous à l'échelle de la rue de l'auteur. Il y a eu
// un quatrième type, "recommandation" (portée ville, répondu par `comment`
// public plutôt que tap + message privé) — supprimé (cf. revue « simplifier
// la navigation ») : "cherche" en tient désormais lieu, chaque demande
// pouvant recevoir des `comment` publics en plus des taps (cf. table
// `comment` plus bas, sans restriction de type).
export const postType = pgEnum(
  "post_type",
  ["cherche", "propose", "informe"],
);

export const city = pgTable("city", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // Code officiel géographique (INSEE) : identifiant stable de la commune,
  // utilisé pour rejouer le seed opendata sans dupliquer (cf. db/seed-cities.ts).
  inseeCode: text("insee_code").notNull().unique(),
  postalCodes: jsonb("postal_codes").notNull(),
  department: text("department").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
    .defaultNow(),
}, (table) => [
  index("city_name_idx").on(table.name),
]);

export const street = pgTable("street", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
    .defaultNow(),
  cityId: integer("city_id").notNull().references(() => city.id),
}, (table) => [
  // Fonctionnelle plutôt que sur `(name, cityId)` brut : la recherche est en
  // `ilike` (insensible à la casse), la contrainte doit l'être aussi, sinon
  // "Rue X" et "rue x" passent toutes les deux et créent un doublon.
  uniqueIndex("street_name_city_unique").on(
    sql`lower(${table.name})`,
    table.cityId,
  ),
]);

export const house = pgTable("house", {
  id: serial("id").primaryKey(),
  // Numéro de bâtiment : facultatif à l'inscription, visible aux seuls
  // foyers certifiés une fois cette fonctionnalité construite.
  number: text("number"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
    .defaultNow(),
  streetId: integer("street_id").notNull().references(() => street.id),
  // Posé quand son dernier habitant supprime son compte (cf.
  // db/account.ts#deleteUserAccount) : exclu du décompte des foyers d'une
  // rue (getStreetHousesStatus), donc un départ peut faire redescendre une
  // rue sous le seuil d'éveil — conséquence assumée d'un vrai départ, pas un
  // bug.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  // Postgres n'indexe jamais une colonne de clé étrangère automatiquement :
  // sans cet index, toute requête passant par la rue (getStreetHousesStatus,
  // listStreetPosts...) scannerait `house` en entier (cf. AGENTS.md
  // « éviter les N+1 et optimiser avec des index adaptés »).
  index("house_street_id_idx").on(table.streetId),
]);

export const user = pgTable("user", {
  id: serial("id").primaryKey(),
  login: text("login").notNull().unique(),
  email: text("email").notNull().unique(),
  token: text("token"),
  // Code de connexion à 6 chiffres envoyé par e-mail : hashé, à usage unique,
  // expire après LOGIN_CODE_TTL_MINUTES (voir utils/otp.ts).
  loginCode: text("login_code"),
  loginCodeExpiresAt: timestamp("login_code_expires_at", {
    withTimezone: true,
  }),
  // Anti brute-force : tentatives échouées depuis la génération du code
  // courant (le code est invalidé au-delà de MAX_LOGIN_CODE_ATTEMPTS) et
  // horodatage d'envoi (anti-spam : throttle sur la régénération/renvoi).
  loginCodeAttempts: integer("login_code_attempts").notNull().default(0),
  loginCodeSentAt: timestamp("login_code_sent_at", { withTimezone: true }),
  // Premier habitant inscrit sur une rue encore vide au moment de son inscription.
  isAmbassador: boolean("is_ambassador").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
    .defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  houseId: integer("house_id").notNull().references(() => house.id),
  notificationType: jsonb("notification_type"),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  // Preuve (légère) d'habiter réellement la rue déclarée (cf. backlog
  // « n'avoir que des personnes qui habitent réellement la rue ») : `null`
  // tant qu'aucun voisin déjà vérifié n'a confirmé ce compte (cf. table
  // `vouch` plus bas) — un seul vouch suffit à valider, volontairement peu
  // contraignant. L'ambassadeur (premier habitant d'une rue encore vide) est
  // vérifié dès l'inscription : personne d'autre ne peut le vouch (cf.
  // db/users.ts#registerInhabitant), il amorce la chaîne de confiance de sa
  // rue.
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
}, (table) => [
  // Foyer → habitants, joint sur quasi toutes les pages (fil, messages,
  // suppression de compte...) — même raison que `house_street_id_idx`.
  index("user_house_id_idx").on(table.houseId),
]);

// Un voisin déjà vérifié confirme qu'un habitant de sa rue y habite bien
// (cf. `user.verifiedAt`, db/vouches.ts). Table séparée plutôt qu'un simple
// compteur sur `user` : garde une trace de qui a vouché pour qui (utile en
// cas d'abus à investiguer) et empêche un même voisin de compter plusieurs
// fois via l'index unique ci-dessous.
export const vouch = pgTable("vouch", {
  id: serial("id").primaryKey(),
  voucherId: integer("voucher_id").notNull().references(() => user.id),
  voucheeId: integer("vouchee_id").notNull().references(() => user.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
    .defaultNow(),
}, (table) => [
  uniqueIndex("vouch_voucher_vouchee_unique").on(
    table.voucherId,
    table.voucheeId,
  ),
  // `listPendingNeighbors`/toute future recherche « qui a vouché pour X »
  // filtrent par vouchee, jamais par voucher seul (l'index unique ci-dessus
  // sert déjà ce second cas via son préfixe gauche).
  index("vouch_vouchee_id_idx").on(table.voucheeId),
]);

// Sollicitation légère envoyée à un voisin, pouvant donner naissance à un Post.
export const tap = pgTable("tap", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => user.id),
  postId: integer("post_id").references((): AnyPgColumn => post.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (table) => [
  // Un seul tap actif par (habitant, demande) : `toggleTap` fait un
  // select-puis-insert non atomique, cette contrainte empêche un
  // double-clic ou deux requêtes concurrentes de créer deux taps actifs
  // pour la même paire (cf. revue).
  uniqueIndex("tap_user_post_active_unique").on(table.userId, table.postId)
    .where(sql`${table.deletedAt} IS NULL`),
  // L'index unique ci-dessus est sur `(user_id, post_id)` : inutilisable par
  // une requête filtrant sur `post_id` seul (règle du préfixe gauche), or
  // c'est exactement `countTapsByPost`/`listTappers` (cf. db/taps.ts, appelé
  // à chaque affichage du fil) — d'où cet index dédié.
  index("tap_post_id_idx").on(table.postId),
]);

export const post = pgTable("post", {
  id: serial("id").primaryKey(),
  // Pas de titre séparé : une demande tient en une phrase (cf. backlog
  // « publier en moins de 30 secondes »), `content` porte tout le message.
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  userId: integer("user_id").notNull().references(() => user.id),
  // Tap à l'origine du post, le cas échéant.
  tapId: integer("tap_id").references((): AnyPgColumn => tap.id),
  type: postType("type").notNull(),
  // Durée de validité choisie à la publication (cf. backlog « le fil ne se
  // remplisse pas de demandes mortes ») : passé cette date, la demande n'est
  // plus servie par `listStreetPosts`. Nullable pour les demandes publiées
  // avant l'ajout de cette colonne — elles restent visibles indéfiniment
  // plutôt que de disparaître rétroactivement.
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, (table) => [
  // Propriétaire d'une demande : filtré à chaque modification/suppression
  // (`updatePostContent`, `softDeletePost`) et joint par `listStreetPosts`.
  index("post_user_id_idx").on(table.userId),
]);

export const comment = pgTable("comment", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  userId: integer("user_id").notNull().references(() => user.id),
  postId: integer("post_id").notNull().references(() => post.id),
}, (table) => [
  // `listCommentsByPost` (`inArray(comment.postId, ...)`) tourne à chaque
  // affichage du fil ; `softDeleteUserComments` filtre sur l'auteur.
  index("comment_post_id_idx").on(table.postId),
  index("comment_user_id_idx").on(table.userId),
]);

export const message = pgTable("message", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  userFromId: integer("user_from_id").notNull().references(() => user.id),
  userToId: integer("user_to_id").notNull().references(() => user.id),
  postId: integer("post_id").references(() => post.id),
  // Marqué à l'ouverture de la conversation par le destinataire (cf.
  // backlog « pastille sur l'enveloppe du menu ») — `null` tant que non lu.
  // N'a de sens que côté destinataire : jamais posé pour l'expéditeur, qui
  // n'a pas besoin de savoir quand son propre message a été lu (pas de
  // "vu" façon messagerie, cf. backlog V0.1 « ne pas répondre sans que mon
  // silence soit visible »).
  readAt: timestamp("read_at", { withTimezone: true }),
}, (table) => [
  index("message_user_from_id_idx").on(table.userFromId),
  index("message_user_to_id_idx").on(table.userToId),
  // Index partiel dédié à `hasUnreadMessages` (cf. db/messages.ts) : appelé
  // par `routes/_middleware.ts` sur *chaque* requête d'un habitant connecté
  // (pastille sur l'enveloppe) — le chemin le plus chaud de toute
  // l'application. Ne couvre que les messages non lus/non supprimés, donc
  // reste petit même quand `message` grossit (l'immense majorité des lignes
  // finit lue) : moins d'I/O disque à chaque requête, précieux sur un
  // Raspberry Pi.
  index("message_unread_idx").on(table.userToId)
    .where(sql`${table.readAt} IS NULL AND ${table.deletedAt} IS NULL`),
]);

export const cityRelations = relations(city, ({ many }) => ({
  streets: many(street),
}));

export const streetRelations = relations(street, ({ one, many }) => ({
  city: one(city, { fields: [street.cityId], references: [city.id] }),
  houses: many(house),
}));

export const houseRelations = relations(house, ({ one, many }) => ({
  street: one(street, { fields: [house.streetId], references: [street.id] }),
  users: many(user),
}));

export const userRelations = relations(user, ({ one, many }) => ({
  house: one(house, { fields: [user.houseId], references: [house.id] }),
  taps: many(tap),
  posts: many(post),
  comments: many(comment),
  messagesSent: many(message, { relationName: "messageFrom" }),
  messagesReceived: many(message, { relationName: "messageTo" }),
  vouchesGiven: many(vouch, { relationName: "voucher" }),
  vouchesReceived: many(vouch, { relationName: "vouchee" }),
}));

export const vouchRelations = relations(vouch, ({ one }) => ({
  voucher: one(user, {
    fields: [vouch.voucherId],
    references: [user.id],
    relationName: "voucher",
  }),
  vouchee: one(user, {
    fields: [vouch.voucheeId],
    references: [user.id],
    relationName: "vouchee",
  }),
}));

export const tapRelations = relations(tap, ({ one, many }) => ({
  user: one(user, { fields: [tap.userId], references: [user.id] }),
  post: one(post, {
    fields: [tap.postId],
    references: [post.id],
    relationName: "tapPost",
  }),
  posts: many(post, { relationName: "postTap" }),
}));

export const postRelations = relations(post, ({ one, many }) => ({
  user: one(user, { fields: [post.userId], references: [user.id] }),
  tap: one(tap, {
    fields: [post.tapId],
    references: [tap.id],
    relationName: "postTap",
  }),
  taps: many(tap, { relationName: "tapPost" }),
  comments: many(comment),
  messages: many(message),
}));

export const commentRelations = relations(comment, ({ one }) => ({
  user: one(user, { fields: [comment.userId], references: [user.id] }),
  post: one(post, { fields: [comment.postId], references: [post.id] }),
}));

export const messageRelations = relations(message, ({ one }) => ({
  userFrom: one(user, {
    fields: [message.userFromId],
    references: [user.id],
    relationName: "messageFrom",
  }),
  userTo: one(user, {
    fields: [message.userToId],
    references: [user.id],
    relationName: "messageTo",
  }),
  post: one(post, { fields: [message.postId], references: [post.id] }),
}));
