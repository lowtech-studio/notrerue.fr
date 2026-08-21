import { router } from "expo-router";
import { Pressable, StyleSheet, Text, useColorScheme, View } from "react-native";
import { clearToken } from "../../lib/auth";
import { colors, fontDisplay, radius, type ThemeColors } from "../../lib/theme";

/**
 * Écran minimal une fois connecté — placeholder volontaire : le fil, la
 * messagerie et le profil sont d'autres items du backlog mobile
 * (`/api/v1/posts`, `/api/v1/messages`, cf. _doc/backlog.md), pas cette
 * story (inscription/connexion). Le bouton de déconnexion existe pour
 * pouvoir tester le flux d'inscription plusieurs fois, pas comme
 * fonctionnalité finale.
 */
export default function AppHome() {
  const scheme = useColorScheme();
  const palette = colors[scheme === "dark" ? "dark" : "light"];
  const styles = createStyles(palette);

  async function handleLogout() {
    await clearToken();
    router.replace("/");
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Vous êtes connecté·e</Text>
      <Text style={styles.subtitle}>
        Le fil de votre rue et la messagerie arrivent bientôt.
      </Text>
      <Pressable style={styles.button} onPress={handleLogout}>
        <Text style={styles.buttonText}>Se déconnecter</Text>
      </Pressable>
    </View>
  );
}

function createStyles(palette: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: palette.paper,
      padding: 24,
      justifyContent: "center",
      alignItems: "center",
      gap: 12,
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
      marginBottom: 24,
    },
    button: {
      borderWidth: 2,
      borderColor: palette.borderStrong,
      borderRadius: radius.md,
      paddingHorizontal: 20,
      paddingVertical: 12,
    },
    buttonText: { color: palette.ink, fontSize: 15, fontWeight: "600" },
  });
}
