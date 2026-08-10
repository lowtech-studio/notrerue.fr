import qrcode from "qrcode-generator";
import type { VNode } from "preact";

interface QrCodeProps {
  /** Contenu encodé (ici, toujours le lien d'invitation vers /rejoindre). */
  value: string;
  /** Taille d'un module en px ; le SVG carré fait `moduleCount * cellSize`. */
  cellSize?: number;
  class?: string;
}

/**
 * QR code rendu en SVG pur (un `<rect>` par module sombre), sans dépendance
 * réseau ni service tiers (RWEB0021, ANSSI R8) : tout est généré côté
 * serveur à partir de `value`. Utilisé par le kit papier de /inviter.
 *
 * Volontairement pas de `dangerouslySetInnerHTML` (la lib expose bien
 * `createSvgTag()`, mais composer le SVG en JSX reste dans les clous de la
 * règle « jamais de HTML injecté » même si `value` n'est pas une saisie
 * utilisateur libre).
 */
export function QrCode({ value, cellSize = 6, class: className }: QrCodeProps) {
  const qr = qrcode(0, "M");
  qr.addData(value);
  qr.make();

  const moduleCount = qr.getModuleCount();
  const size = moduleCount * cellSize;

  const modules: VNode[] = [];
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (qr.isDark(row, col)) {
        modules.push(
          <rect
            key={`${row}-${col}`}
            x={col * cellSize}
            y={row * cellSize}
            width={cellSize}
            height={cellSize}
          />,
        );
      }
    }
  }

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label="QR code d'invitation vers NotreRue.fr"
      class={className}
    >
      <rect x={0} y={0} width={size} height={size} fill="#fff" />
      <g fill="#1b1a17">{modules}</g>
    </svg>
  );
}
