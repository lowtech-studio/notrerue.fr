import { assertEquals, assertExists } from "@std/assert";
import { createSessionValue, verifySessionValue } from "./session.ts";

Deno.test("createSessionValue / verifySessionValue : aller-retour valide", async () => {
  const value = await createSessionValue(42);
  const verified = await verifySessionValue(value);
  assertExists(verified);
  assertEquals(verified.userId, 42);
  // `issuedAt` se déduit de l'expiration moins la durée de vie fixe (cf.
  // commentaire dans session.ts) : doit retomber sur "maintenant" (le jeton
  // vient d'être créé), à quelques secondes près.
  const nowSeconds = Math.floor(Date.now() / 1000);
  assertEquals(Math.abs(verified.issuedAt - nowSeconds) < 5, true);
});

Deno.test("verifySessionValue : signature altérée rejetée", async () => {
  const value = await createSessionValue(42);
  const tampered = value.slice(0, -1) + (value.at(-1) === "0" ? "1" : "0");
  assertEquals(await verifySessionValue(tampered), null);
});

Deno.test("verifySessionValue : format invalide rejeté", async () => {
  assertEquals(await verifySessionValue("pas-une-session"), null);
});

Deno.test("verifySessionValue : expiration rejetée", async () => {
  const expiredPayload = `42.${Math.floor(Date.now() / 1000) - 10}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(Deno.env.get("SESSION_SECRET")!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(expiredPayload),
  );
  const hex = Array.from(new Uint8Array(signature)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
  assertEquals(await verifySessionValue(`${expiredPayload}.${hex}`), null);
});
