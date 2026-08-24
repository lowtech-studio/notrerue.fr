/**
 * Date relative en français ("il y a 2 heures", "hier"...) — même logique
 * que web/utils/relative_date.ts, dupliquée plutôt qu'importée : ce
 * fichier web n'est pas type-only (il exécute `Intl.RelativeTimeFormat`),
 * donc Metro tenterait de le bundler s'il était importé tel quel (cf.
 * _doc/architecture-mobile.md, seul un `import type` peut traverser
 * web/ → mobile/).
 */
const RELATIVE_TIME_FORMATTER = new Intl.RelativeTimeFormat("fr", {
  numeric: "auto",
});

const UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: "week", ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: "day", ms: 24 * 60 * 60 * 1000 },
  { unit: "hour", ms: 60 * 60 * 1000 },
  { unit: "minute", ms: 60 * 1000 },
];

export function formatRelativeDate(date: Date, now: Date = new Date()): string {
  const diffMs = date.getTime() - now.getTime();
  const absMs = Math.abs(diffMs);

  if (absMs < 60_000) return "à l'instant";

  const { unit, ms } = UNITS.find(({ ms }) => absMs >= ms)!;
  return RELATIVE_TIME_FORMATTER.format(Math.round(diffMs / ms), unit);
}
