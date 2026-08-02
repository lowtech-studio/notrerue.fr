import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const databaseUrl = Deno.env.get("DATABASE_URL");
if (!databaseUrl) {
  throw new Error("DATABASE_URL n'est pas défini");
}

const migrationClient = postgres(databaseUrl, { max: 1 });

await migrate(drizzle(migrationClient), {
  migrationsFolder: new URL("./migrations", import.meta.url).pathname,
});

await migrationClient.end();

console.log("Migrations appliquées.");
