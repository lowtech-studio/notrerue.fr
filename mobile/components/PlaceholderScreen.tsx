import { StyleSheet, Text, useColorScheme, View } from "react-native";
import { AppHeader } from "./AppHeader";
import { colors, fontDisplay, type ThemeColors } from "../lib/theme";

interface PlaceholderScreenProps {
  title: string;
  subtitle: string;
}

/**
 * Écran « à venir » générique, avec l'en-tête commune (menu burger). Le
 * menu burger (cf. AppHeader) pointe vers plusieurs écrans pas encore
 * implémentés côté mobile (fil, inviter, messages, profil — items de
 * backlog distincts, cf. _doc/backlog.md « Backlog Mobile ») : plutôt que
 * de dupliquer le même contenu de repli quatre fois, un seul composant
 * paramétré par titre/sous-titre.
 */
export function PlaceholderScreen(
  { title, subtitle }: PlaceholderScreenProps,
) {
  const scheme = useColorScheme();
  const palette = colors[scheme === "dark" ? "dark" : "light"];
  const styles = createStyles(palette);

  return (
    <View style={styles.flex}>
      <AppHeader />
      <View style={styles.center}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
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
      fontSize: 22,
      fontWeight: "700",
      color: palette.ink,
      textAlign: "center",
    },
    subtitle: {
      fontSize: 15,
      color: palette.inkSoft,
      textAlign: "center",
    },
  });
}
