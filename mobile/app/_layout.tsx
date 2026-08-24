import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

/**
 * Enveloppe commune à tout l'arbre de routes (équivalent mobile de
 * web/routes/_app.tsx) : pas d'en-tête natif (chaque écran gère son propre
 * titre/retour dans son contenu, cf. écrans d'inscription), et la barre de
 * statut suit le thème système — pas de bascule manuelle pour l'instant
 * (contrairement au web, cf. web/utils/theme.ts), à ajouter si le besoin
 * se confirme une fois le reste de l'app en place.
 *
 * `SafeAreaProvider` : requis par `useSafeAreaInsets` (cf.
 * components/AppHeader.tsx) — sans lui le hook renvoie des insets à zéro
 * partout, silencieusement, plutôt que de planter.
 */
export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <SafeAreaProvider>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false }} />
    </SafeAreaProvider>
  );
}
