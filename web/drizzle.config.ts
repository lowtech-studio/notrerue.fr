import { defineConfig } from "drizzle-kit";

const databaseUrl = Deno.env.get("DATABASE_URL") ??
  "postgres://postgres:example@localhost:5432/notre_rue";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
