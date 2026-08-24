import { StyleSheet, Text, useColorScheme, View } from "react-native";
import { AppHeader } from "../../components/AppHeader";
import { colors, fontDisplay, type ThemeColors } from "../../lib/theme";

/**
 * Écran d'accueil une fois connecté. La navigation (fil, inviter,
 * messages, profil, déconnexion) vit désormais dans le menu burger de
 * `AppHeader` (mêmes entrées que web/components/Header.tsx) — plus besoin
 * ici du bouton de déconnexion isolé qui servait avant à retester le flux
 * d'inscription, la déconnexion est toujours accessible via le menu.
 */
export default function AppHome() {
  const scheme = useColorScheme();
  const palette = colors[scheme === "dark" ? "dark" : "light"];
  const styles = createStyles(palette);

  return (
    <View style={styles.flex}>
      <AppHeader />
      <View style={styles.center}>
        <Text style={styles.title}>Vous êtes connecté·e</Text>
        <Text style={styles.subtitle}>
          Ouvrez le menu pour retrouver le fil de votre rue, inviter vos
          voisins ou gérer votre profil.
        </Text>
      </View>
    </View>
  );
}

function createStyles(palette: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: palette.paper },
    center: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
      gap: 8,
    },
    title: {
      fontFamily: fontDisplay,
      fontSize: 24,
      fontWeight: "700",
      color: palette.ink,
    },
    subtitle: {
      fontSize: 15,
      color: palette.inkSoft,
      textAlign: "center",
    },
  });
}
