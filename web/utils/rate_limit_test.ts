import { assertEquals } from "@std/assert";
import { createCooldown } from "./rate_limit.ts";

Deno.test("createCooldown : bloque une clé pendant la fenêtre, puis la libère", async () => {
  const cooldown = createCooldown(50);

  assertEquals(cooldown.isActive("a"), false);
  cooldown.record("a");
  assertEquals(cooldown.isActive("a"), true);

  await new Promise((resolve) => setTimeout(resolve, 60));
  assertEquals(cooldown.isActive("a"), false);
});

Deno.test("createCooldown : chaque clé a son propre cooldown", () => {
  const cooldown = createCooldown(10_000);

  cooldown.record("a");
  assertEquals(cooldown.isActive("a"), true);
  assertEquals(cooldown.isActive("b"), false);
});
