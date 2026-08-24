import Svg, { Path, Rect } from "react-native-svg";

interface IconProps {
  size?: number;
  /** Pas de `currentColor` ici (concept CSS web, sans équivalent en SVG
   * React Native) : la couleur se passe explicitement à chaque usage. */
  color: string;
}

/**
 * Contour d'une plaque de rue parisienne — même tracé que
 * web/components/icons.tsx#StreetPlaqueIcon (motif du badge de marque,
 * cf. web/static/icon.svg), porté en `react-native-svg` (seule dépendance
 * qui rend du SVG en React Native ; pas d'équivalent natif).
 */
export function StreetPlaqueIcon({ size = 22, color }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40" fill="none">
      <Path
        d="M 6,12.2 L 14.4,12.2 A 5.6,5 0 0 1 25.6,12.2 L 34,12.2 L 34,27.8 L 6,27.8 Z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Rect
        x={9.4}
        y={15}
        width={21.2}
        height={10.1}
        rx={0.7}
        stroke={color}
        strokeWidth={1.3}
      />
    </Svg>
  );
}
