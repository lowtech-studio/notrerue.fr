import { assertEquals } from "@std/assert";
import type { Context } from "fresh";
import type { State } from "../utils.ts";
import { handler } from "./index.tsx";

function makeContext(url: string): Context<State> {
  return { url: new URL(url) } as unknown as Context<State>;
}

Deno.test("GET / sans paramètre rue renvoie une chaîne vide", async () => {
  const result = await handler.GET!(makeContext("http://localhost/"));
  assertEquals(result, { data: { rue: "" } });
});

