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
});

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
});

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
});

export const comment = pgTable("comment", {
  id: serial("id").primaryKey(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  userId: integer("user_id").notNull().references(() => user.id),
  postId: integer("post_id").notNull().references(() => post.id),
});

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
});

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
