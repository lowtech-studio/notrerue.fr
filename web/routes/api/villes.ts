import { asc, ilike, or, sql } from "drizzle-orm";
import { define } from "../../utils.ts";
import { db } from "../../db/client.ts";
import { city } from "../../db/schema.ts";
import { escapeLikePattern } from "../../utils/validation.ts";

const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS = 8;

export const handler = define.handlers({
  async GET(ctx) {
    const q = (ctx.url.searchParams.get("q") ?? "").trim();
    if (q.length < MIN_QUERY_LENGTH) {
      return Response.json([]);
    }
    const escapedQ = escapeLikePattern(q);

    const rows = await db.select({
      id: city.id,
      name: city.name,
      postalCodes: city.postalCodes,
      department: city.department,
    }).from(city)
      .where(
        or(
          ilike(city.name, `%${escapedQ}%`),
          sql`exists (select 1 from jsonb_array_elements_text(${city.postalCodes}) pc where pc like ${
            escapedQ + "%"
          })`,
        ),
      )
      .orderBy(asc(city.name))
      .limit(MAX_RESULTS);

    return Response.json(rows);
  },
});
