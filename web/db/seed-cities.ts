import { parse } from "@std/csv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

const databaseUrl = Deno.env.get("DATABASE_URL");
if (!databaseUrl) {
  throw new Error("DATABASE_URL n'est pas défini");
}

const BATCH_SIZE = 1000;

interface CityCsvRow {
  insee_code: string;
  name: string;
  postal_codes: string;
  department_code: string;
  department_name: string;
}

async function main() {
  const csvPath = new URL("./seed/communes.csv", import.meta.url);
  const csvText = await Deno.readTextFile(csvPath);
  const rows = parse(csvText, {
    skipFirstRow: true,
  }) as unknown as CityCsvRow[];

  const client = postgres(databaseUrl!, { max: 1 });
  const db = drizzle(client, { schema });

  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map((row) => ({
      name: row.name,
      inseeCode: row.insee_code,
      postalCodes: row.postal_codes ? row.postal_codes.split(";") : [],
      department: row.department_name,
    }));
    const result = await db.insert(schema.city).values(batch)
      .onConflictDoNothing({ target: schema.city.inseeCode })
      .returning({ id: schema.city.id });
    inserted += result.length;
  }

  console.log(
    `${rows.length} communes lues, ${inserted} nouvelles insérées.`,
  );

  await client.end();
}

await main();
