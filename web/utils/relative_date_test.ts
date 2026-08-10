import { assertEquals } from "@std/assert";
import { formatRelativeDate } from "./relative_date.ts";

const NOW = new Date("2026-08-10T12:00:00Z");

Deno.test("formatRelativeDate : moins d'une minute → à l'instant", () => {
  assertEquals(
    formatRelativeDate(new Date("2026-08-10T11:59:45Z"), NOW),
    "à l'instant",
  );
});

Deno.test("formatRelativeDate : quelques minutes / heures dans le passé", () => {
  assertEquals(
    formatRelativeDate(new Date("2026-08-10T11:55:00Z"), NOW),
    "il y a 5 minutes",
  );
  assertEquals(
    formatRelativeDate(new Date("2026-08-10T10:00:00Z"), NOW),
    "il y a 2 heures",
  );
});

Deno.test("formatRelativeDate : hier / la semaine dernière", () => {
  assertEquals(
    formatRelativeDate(new Date("2026-08-09T12:00:00Z"), NOW),
    "hier",
  );
  assertEquals(
    formatRelativeDate(new Date("2026-08-02T12:00:00Z"), NOW),
    "la semaine dernière",
  );
});
