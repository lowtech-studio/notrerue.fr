import { and, asc, eq, ilike } from "drizzle-orm";
import { define } from "../../utils.ts";
import { db } from "../../db/client.ts";
import { street } from "../../db/schema.ts";
import { escapeLikePattern } from "../../utils/validation.ts";

const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS = 8;

export const handler = define.handlers({
  async GET(ctx) {
    const q = (ctx.url.searchParams.get("q") ?? "").trim();
    const cityId = Number(ctx.url.searchParams.get("cityId"));
    if (q.length < MIN_QUERY_LENGTH || !Number.isInteger(cityId)) {
      return Response.json([]);
    }

    const rows = await db.select({ id: street.id, name: street.name })
      .from(street)
      .where(
        and(
          ilike(street.name, `%${escapeLikePattern(q)}%`),
          eq(street.cityId, cityId),
        ),
      )
      .orderBy(asc(street.name))
      .limit(MAX_RESULTS);

    return Response.json(rows);
  },
});
