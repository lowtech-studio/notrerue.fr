import { assertEquals, assertStringIncludes } from "@std/assert";
import type { Context } from "fresh";
import type { State } from "../utils.ts";
import { handler } from "./theme.ts";

function makeContext(
  options: { url?: string; cookie?: string; referer?: string } = {},
): Context<State> {
  const headers = new Headers();
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.referer) headers.set("referer", options.referer);
  return {
    url: new URL(options.url ?? "http://localhost/theme"),
    redirect: (location: string) =>
      new Response(null, { status: 302, headers: { location } }),
    req: { headers },
  } as unknown as Context<State>;
}

Deno.test("POST /theme : sans cookie (système) → passe en sombre", async () => {
  const response = await handler.POST!(makeContext()) as Response;
  assertEquals(response.status, 302);
  const cookie = response.headers.get("set-cookie") ?? "";
  assertStringIncludes(cookie, "notrerue_theme=dark");
  assertStringIncludes(cookie, "HttpOnly");
});

Deno.test("POST /theme : sombre → passe en clair", async () => {
  const response = await handler.POST!(
    makeContext({ cookie: "notrerue_theme=dark" }),
  ) as Response;
  const cookie = response.headers.get("set-cookie") ?? "";
  assertStringIncludes(cookie, "notrerue_theme=light");
});

Deno.test("POST /theme : clair → revient au système (cookie expiré)", async () => {
  const response = await handler.POST!(
    makeContext({ cookie: "notrerue_theme=light" }),
  ) as Response;
  const cookie = response.headers.get("set-cookie") ?? "";
  assertStringIncludes(cookie, "Max-Age=0");
});

Deno.test("POST /theme : revient sur le Referer (même origine)", async () => {
  const response = await handler.POST!(
    makeContext({
      url: "http://localhost/theme",
      referer: "http://localhost/fil?type=informe",
    }),
  ) as Response;
  assertEquals(
    response.headers.get("location"),
    "/fil?type=informe",
  );
});

Deno.test("POST /theme : Referer absent ou d'une autre origine → repli sur l'accueil", async () => {
  const withoutReferer = await handler.POST!(makeContext()) as Response;
  assertEquals(withoutReferer.headers.get("location"), "/");

  const crossOrigin = await handler.POST!(
    makeContext({ referer: "https://evil.example/phishing" }),
  ) as Response;
  assertEquals(crossOrigin.headers.get("location"), "/");
});
