/**
 * Préférence d'apparence explicite (cf. menu de compte, « Mode sombre »).
 * `null`/absent = suit la préférence système (`prefers-color-scheme`,
 * comportement par défaut du site, cf. assets/common.css) — ce module ne
 * gère que le cas où l'habitant a explicitement forcé un choix.
 */
export type Theme = "light" | "dark";

export const THEME_COOKIE = "notrerue_theme";

export function parseTheme(raw: string | undefined | null): Theme | null {
  return raw === "light" || raw === "dark" ? raw : null;
}

/**
 * Cycle à trois états déclenché par un clic sur le bouton du menu de
 * compte : système → sombre → clair → système... Un seul bouton suffit
 * ainsi à couvrir les trois états sans repli JS (règle Fresh n°1 : pas
 * d'island pour ça), chaque clic est un simple POST qui avance d'un cran.
 */
export function nextTheme(current: Theme | null): Theme | null {
  if (current === null) return "dark";
  if (current === "dark") return "light";
  return null;
}

/**
 * Libellé du bouton — une action, pas un état (même convention que les
 * autres items du menu de compte, « Gérer mon profil »/« Déconnexion ») :
 * "Mode sombre" prêtait à confusion, lu comme le mode courant plutôt que
 * comme ce que le clic allait activer (cf. retour utilisateur).
 */
export function nextThemeLabel(current: Theme | null): string {
  if (current === null) return "Activer le mode sombre";
  if (current === "dark") return "Activer le mode clair";
  return "Suivre le système";
}
