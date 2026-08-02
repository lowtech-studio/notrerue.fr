import { relations } from "drizzle-orm";
import {
  type AnyPgColumn,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const postType = pgEnum("post_type", ["cherche", "propose", "informe"]);

export const city = pgTable("city", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
    .defaultNow(),
});

export const street = pgTable("street", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
    .defaultNow(),
  cityId: integer("city_id").notNull().references(() => city.id),
});

export const house = pgTable("house", {
  id: serial("id").primaryKey(),
  number: text("number").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
    .defaultNow(),
  streetId: integer("street_id").notNull().references(() => street.id),
});

export const user = pgTable("user", {
  id: serial("id").primaryKey(),
  login: text("login").notNull().unique(),
  email: text("email").notNull().unique(),
  token: text("token"),
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
});

export const post = pgTable("post", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
    .defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  userId: integer("user_id").notNull().references(() => user.id),
  // Tap à l'origine du post, le cas échéant.
  tapId: integer("tap_id").references((): AnyPgColumn => tap.id),
  type: postType("type").notNull(),
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
