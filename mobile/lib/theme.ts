/**
 * Tokens repris de web/assets/common.css (`:root` et son bloc sombre) —
 * même identité visuelle que le web, sans dépendance à un kit UI (cf.
 * _doc/architecture-mobile.md : « pas de kit de composants lourd », même
 * logique que l'interdiction de framework CSS côté web, AGENTS.md).
 *
 * Pas de police custom embarquée (RWEB0032, même raisonnement que le web
 * qui reste sur des piles système) : `fontFamily` retombe sur les polices
 * système de chaque plateforme plutôt que de charger une webfont.
 */
export interface ThemeColors {
  paper: string;
  paperWarm: string;
  ink: string;
  inkSoft: string;
  inkMuted: string;
  border: string;
  borderStrong: string;
  brand: string;
  brandHover: string;
  danger: string;
}

/**
 * Champs typés `string` (pas de littéraux `as const`) : `colors.light` et
 * `colors.dark` doivent rester interchangeables partout où `ThemeColors`
 * est attendu (cf. `palette = colors[scheme === "dark" ? "dark" : "light"]`
 * dans chaque écran) — sans ça, TypeScript infère un type par variante à
 * partir de ses propres valeurs littérales et les deux deviennent
 * incompatibles entre elles (constaté au premier `tsc --noEmit`).
 */
export const colors: Record<"light" | "dark", ThemeColors> = {
  light: {
    paper: "#fffdf8",
    paperWarm: "#fff6ea",
    ink: "#1b1a17",
    inkSoft: "#4a453c",
    inkMuted: "#6b6558",
    border: "#e3dbcc",
    borderStrong: "#d8cfbe",
    brand: "#9a3f12",
    brandHover: "#7b300b",
    danger: "#c0392b",
  },
  dark: {
    paper: "#1c1814",
    paperWarm: "#26201a",
    ink: "#f0e9dc",
    inkSoft: "#cdc0ac",
    inkMuted: "#a4967f",
    border: "#3a3126",
    borderStrong: "#4a4030",
    brand: "#e08a52",
    brandHover: "#ef9d6c",
    danger: "#e2574c",
  },
};

export const radius = {
  md: 10,
  lg: 16,
} as const;

/** Georgia est native sur iOS/Android ; secours système sinon (pas de
 * webfont, cf. commentaire en tête de fichier). */
export const fontDisplay = "Georgia";
