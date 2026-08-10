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

/**
 * Date relative en français ("il y a 2 heures", "hier"...) via l'API
 * `Intl.RelativeTimeFormat` du navigateur/runtime — pas de librairie de date
 * supplémentaire pour ça. `now` n'est là que pour les tests (déterministe).
 */
export function formatRelativeDate(date: Date, now: Date = new Date()): string {
  const diffMs = date.getTime() - now.getTime();
  const absMs = Math.abs(diffMs);

  if (absMs < 60_000) return "à l'instant";

  for (const { unit, ms } of UNITS) {
    if (absMs >= ms) {
      return RELATIVE_TIME_FORMATTER.format(Math.round(diffMs / ms), unit);
    }
  }
  return RELATIVE_TIME_FORMATTER.format(Math.round(diffMs / 60_000), "minute");
}
