interface StreetProgressProps {
  /** Foyers déjà inscrits. */
  housesCount: number;
  /** Foyers nécessaires pour que la rue s'allume (STREET_AWAKENING_THRESHOLD). */
  threshold: number;
}

/**
 * Barre de progression vers le seuil d'éveil d'une rue (un créneau par foyer
 * manquant). Purement décorative (`aria-hidden`) : le décompte en toutes
 * lettres qui l'accompagne porte l'information pour les lecteurs d'écran.
 * Partagée entre la page d'accueil (rue recherchée) et /inviter (rue de
 * l'habitant connecté).
 */
export function StreetProgress(
  { housesCount, threshold }: StreetProgressProps,
) {
  return (
    <div class="street-status__progress" aria-hidden="true">
      {Array.from({ length: threshold }, (_, i) => (
        <span
          key={i}
          class={`street-status__slot ${
            i < housesCount ? "street-status__slot--filled" : ""
          }`}
        />
      ))}
    </div>
  );
}
