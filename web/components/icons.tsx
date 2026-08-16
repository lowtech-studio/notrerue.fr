interface IconProps {
  class?: string;
}

/**
 * Petits pictogrammes SVG inline (traits, `currentColor`) : pas de police
 * d'icônes ni d'image externe (RWEB0050/RWEB0100), et la couleur suit le
 * texte du bouton qui les porte.
 */

/** Contour d'une plaque de rue parisienne (double liseré, petite bosse au
 * centre du haut) — motif du badge de marque (cf. .brand__mark dans
 * common.css, Header.tsx, static/icon.svg, static/icon-maskable.svg,
 * static/offline.html). Remplace l'ancien glyphe texte "◍" partout où une
 * vraie forme est possible ; email/layout.ts garde volontairement le
 * glyphe texte (la plupart des clients mail bloquent les images/SVG par
 * défaut, cf. commentaire sur place). */
export function StreetPlaqueIcon({ class: className }: IconProps) {
  return (
    <svg
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      stroke-linejoin="round"
      aria-hidden="true"
      class={className}
    >
      <path
        d="M 6,12.2 L 14.4,12.2 A 5.6,5 0 0 1 25.6,12.2 L 34,12.2 L 34,27.8 L 6,27.8 Z"
        stroke-width="2"
      />
      <rect
        x="9.4"
        y="15"
        width="21.2"
        height="10.1"
        rx="0.7"
        stroke-width="1.3"
      />
    </svg>
  );
}

export function MailIcon({ class: className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={className}
    >
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

/** Bulle de discussion générique (pas le logo WhatsApp officiel) accompagnant le bouton « Inviter par WhatsApp ». */
export function ChatBubbleIcon({ class: className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={className}
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}

/** Silhouette, pour le lien « Gérer mon profil » du menu de compte. */
export function UserIcon({ class: className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={className}
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
    </svg>
  );
}

/** Bouton « power », pour l'action « Déconnexion » du menu de compte. */
export function LogoutIcon({ class: className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={className}
    >
      <path d="M12 3v9" />
      <path d="M18.4 6.6a8 8 0 1 1-12.8 0" />
    </svg>
  );
}

/** Cercle mi-plein, pour le bouton d'apparence (mode sombre/clair) du menu de compte — icône fixe, le libellé change selon l'état (cf. Header.tsx). */
export function ThemeIcon({ class: className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={className}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Photo/paysage, pour la zone d'ajout d'image d'une demande (cf. islands/ImageDropzone.tsx). */
export function ImageIcon({ class: className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={className}
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="m21 15-5-5L5 21" />
    </svg>
  );
}

/** Imprimante, pour le bouton « Imprimer le kit papier ». */
export function PrinterIcon({ class: className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      class={className}
    >
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}
