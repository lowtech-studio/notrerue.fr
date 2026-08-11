import { define } from "../utils.ts";
import { findSessionUserById } from "../db/users.ts";
import { getStreetHousesStatus } from "../db/streets.ts";
import { parseCookies } from "../utils/cookies.ts";
import { SESSION_COOKIE, verifySessionValue } from "../utils/session.ts";

export const handler = define.middleware(async (ctx) => {
  ctx.state.user = null;
  ctx.state.isStreetAwake = null;

  const cookies = parseCookies(ctx.req.headers.get("cookie"));
  const sessionValue = cookies[SESSION_COOKIE];

  if (sessionValue) {
    const userId = await verifySessionValue(sessionValue);
    if (userId) {
      ctx.state.user = await findSessionUserById(userId);
      if (ctx.state.user) {
        const status = await getStreetHousesStatus(ctx.state.user.street.id);
        ctx.state.isStreetAwake = status.isAwake;
      }
    }
  }

  return ctx.next();
});
