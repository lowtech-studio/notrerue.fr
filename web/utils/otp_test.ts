import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  generateLoginCode,
  hashLoginCode,
  loginCodeExpiryDate,
  loginCodeMatches,
} from "./otp.ts";

Deno.test("generateLoginCode : toujours 6 chiffres", () => {
  for (let i = 0; i < 50; i++) {
    const code = generateLoginCode();
    assertEquals(code.length, 6);
    assert(/^\d{6}$/.test(code));
  }
});

Deno.test("hashLoginCode / loginCodeMatches : aller-retour valide", async () => {
  const code = "042817";
  const hash = await hashLoginCode(code);
  assert(await loginCodeMatches(code, hash));
});

Deno.test("loginCodeMatches : code incorrect rejeté", async () => {
  const hash = await hashLoginCode("042817");
  assertFalse(await loginCodeMatches("999999", hash));
});

Deno.test("loginCodeExpiryDate : expire 15 minutes après la date fournie", () => {
  const from = new Date("2026-01-01T00:00:00Z");
  const expiry = loginCodeExpiryDate(from);
  assertEquals(expiry.getTime() - from.getTime(), 15 * 60_000);
});
