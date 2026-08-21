import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";

/**
 * Enveloppe commune à tout l'arbre de routes (équivalent mobile de
 * web/routes/_app.tsx) : pas d'en-tête natif (chaque écran gère son propre
 * titre/retour dans son contenu, cf. écrans d'inscription), et la barre de
 * statut suit le thème système — pas de bascule manuelle pour l'instant
 * (contrairement au web, cf. web/utils/theme.ts), à ajouter si le besoin
 * se confirme une fois le reste de l'app en place.
 */
export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
