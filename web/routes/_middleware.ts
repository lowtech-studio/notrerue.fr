import { define } from "../utils.ts";
import { findSessionUserById } from "../db/users.ts";
import { parseCookies } from "../utils/cookies.ts";
import { SESSION_COOKIE, verifySessionValue } from "../utils/session.ts";

export const handler = define.middleware(async (ctx) => {
  ctx.state.user = null;

  const cookies = parseCookies(ctx.req.headers.get("cookie"));
  const sessionValue = cookies[SESSION_COOKIE];

  if (sessionValue) {
    const userId = await verifySessionValue(sessionValue);
    if (userId) {
      ctx.state.user = await findSessionUserById(userId);
    }
  }

  return ctx.next();
});
