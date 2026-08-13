/**
 * Accord simple singulier/pluriel pour un compte affiché (« 1 foyer », « 3
 * foyers », « 0 foyer » — le français traite 0 et 1 comme singuliers). Évite
 * de disperser le même ternaire à chaque endroit où un nombre de foyers est
 * affiché (page d'accueil, /inviter — cf. revue : pluriel non accordé sur
 * « 1 foyers inscrits »).
 */
export function pluralizeCount(
  count: number,
  singular: string,
  plural: string = `${singular}s`,
): string {
  return `${count} ${count > 1 ? plural : singular}`;
}
