/**
 * Anti-abus en mémoire process, à clé simple (ex. id utilisateur) : mémorise
 * le dernier passage par clé et dit si on est encore dans la fenêtre de
 * cooldown. Pas persistant (perdu au redémarrage, pas partagé entre
 * instances) — un choix volontairement léger pour un déploiement
 * mono-instance ; à remplacer par un stockage partagé (Postgres, Redis…) si
 * ça devient un vrai enjeu.
 */
export function createCooldown(windowMs: number) {
  const lastAt = new Map<string | number, number>();

  return {
    isActive(key: string | number): boolean {
      const last = lastAt.get(key);
      return last !== undefined && Date.now() - last < windowMs;
    },
    record(key: string | number): void {
      lastAt.set(key, Date.now());
    },
  };
}
