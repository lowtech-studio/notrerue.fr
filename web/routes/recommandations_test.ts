import { assertEquals } from "@std/assert";
import type { Context } from "fresh";
import type { State } from "../utils.ts";
import { handler } from "./recommandations.ts";

function makeContext(url: string): Context<State> {
  return {
    url: new URL(url),
    redirect: (location: string) =>
      new Response(null, { status: 302, headers: { location } }),
  } as unknown as Context<State>;
}

// Type "recommandation" supprimé (cf. revue « simplifier la navigation ») :
// cette route ne fait plus que rediriger vers /fil, `q`/`page` préservés,
// pour ne pas casser un lien/favori déjà partagé vers /recommandations.

Deno.test("GET /recommandations : redirige vers /fil", async () => {
  const response = await handler.GET!(
    makeContext("http://localhost/recommandations"),
  ) as Response;
  assertEquals(response.status, 302);
  assertEquals(response.headers.get("location"), "/fil");
});

Deno.test("GET /recommandations?q=...&page=... : `q`/`page` préservés dans la redirection, `type` retiré", async () => {
  const response = await handler.GET!(
    makeContext(
      "http://localhost/recommandations?type=recommandation&q=plombier&page=2",
    ),
  ) as Response;
  assertEquals(response.status, 302);
  const location = new URL(
    response.headers.get("location")!,
    "http://localhost",
  );
  assertEquals(location.pathname, "/fil");
  assertEquals(location.searchParams.get("type"), null);
  assertEquals(location.searchParams.get("q"), "plombier");
  assertEquals(location.searchParams.get("page"), "2");
});
