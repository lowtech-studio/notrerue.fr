import { useState } from "react";
import { router } from "expo-router";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { clearToken } from "../lib/auth";
import { colors, fontDisplay, type ThemeColors } from "../lib/theme";
import { StreetPlaqueIcon } from "./icons";

type AppHref =
  | "/(app)/fil"
  | "/(app)/inviter"
  | "/(app)/messages"
  | "/(app)/profil";

interface NavEntry {
  label: string;
  href: AppHref;
}

/**
 * Mêmes liens que la navigation connectée du web (cf.
 * web/components/Header.tsx : "Le fil de ma rue", "Inviter mes voisins",
 * "Mes messages", puis "Gérer mon profil"/"Déconnexion" dans le menu de
 * compte). Pas de bascule de thème ici, contrairement au web : le mobile
 * suit uniquement le thème système pour l'instant (cf. app/_layout.tsx,
 * choix déjà acté, à revoir seulement si le besoin se confirme) — rien à
 * reproduire dans ce menu tant que ça reste vrai. Pas de gate sur
 * `isStreetAwake` non plus (contrairement au web qui masque fil/messages
 * tant que la rue dort) : aucun endpoint mobile ne renvoie encore ce
 * statut, cf. `_doc/architecture-mobile.md` (`streets/status.ts` pas
 * encore écrit) — à ajouter ici quand cet endpoint existera.
 */
const NAV_ENTRIES: NavEntry[] = [
  { label: "Le fil de ma rue", href: "/(app)/fil" },
  { label: "Inviter mes voisins", href: "/(app)/inviter" },
  { label: "Mes messages", href: "/(app)/messages" },
];

/**
 * Barre de navigation commune aux écrans connectés — menu burger à
 * gauche, logo à droite (cf. demande explicite, inversé par rapport au
 * web où la marque est à gauche). Le menu s'ouvre en panneau plein écran
 * (`Modal` natif de React Native, pas de dépendance ajoutée) plutôt qu'un
 * `<details>` comme le web : pas d'équivalent survol/clic-extérieur
 * fiable en natif, même logique que « pas de kit UI lourd » (cf.
 * mobile/AGENTS.md).
 */
export function AppHeader() {
  const scheme = useColorScheme();
  const palette = colors[scheme === "dark" ? "dark" : "light"];
  const insets = useSafeAreaInsets();
  const styles = createStyles(palette, insets.top);
  const [open, setOpen] = useState(false);

  function go(href: AppHref) {
    setOpen(false);
    router.push(href);
  }

  async function handleLogout() {
    setOpen(false);
    await clearToken();
    router.replace("/");
  }

  return (
    <View style={styles.bar}>
      <Pressable
        style={styles.burger}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Ouvrir le menu"
      >
        <View style={styles.burgerBar} />
        <View style={styles.burgerBar} />
        <View style={styles.burgerBar} />
      </Pressable>

      {
        /* Même badge que web/assets/common.css#.brand__mark (pastille
          couleur marque + plaque de rue), texte réduit à côté (cf. retour
          utilisateur « notrerue.fr en plus petit ») plutôt que le seul
          texte qui portait toute la marque jusqu'ici. */
      }
      <View style={styles.brand}>
        <View style={styles.brandMark}>
          <StreetPlaqueIcon size={16} color={palette.paperWarm} />
        </View>
        <Text style={styles.logo}>NotreRue.fr</Text>
      </View>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.modalRoot}>
          <View style={styles.panel}>
            <Text style={styles.panelTitle}>NotreRue.fr</Text>

            {NAV_ENTRIES.map((entry) => (
              <Pressable
                key={entry.href}
                style={styles.item}
                onPress={() => go(entry.href)}
              >
                <Text style={styles.itemText}>{entry.label}</Text>
              </Pressable>
            ))}

            <View style={styles.separator} />

            <Pressable
              style={styles.item}
              onPress={() => go("/(app)/profil")}
            >
              <Text style={styles.itemText}>Gérer mon profil</Text>
            </Pressable>
            <Pressable style={styles.item} onPress={handleLogout}>
              <Text style={[styles.itemText, styles.itemDanger]}>
                Déconnexion
              </Text>
            </Pressable>
          </View>

          {
            /* Zone hors panneau : ferme le menu au tap, comme un clic à
              l'extérieur du `<details>` web. Un `Pressable` distinct plutôt
              qu'un unique conteneur englobant le panneau : sinon un tap
              sur un item du panneau fermerait aussi le menu avant même de
              naviguer, la remontée d'événement React Native n'étant pas
              celle du DOM. */
          }
          <Pressable
            style={styles.backdrop}
            onPress={() => setOpen(false)}
            accessibilityLabel="Fermer le menu"
          />
        </View>
      </Modal>
    </View>
  );
}

function createStyles(palette: ThemeColors, insetTop: number) {
  return StyleSheet.create({
    bar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      // Insets réels de l'appareil (encoche/barre de statut) plutôt qu'une
      // valeur fixe : sur Android en particulier, la hauteur de la barre
      // de statut varie bien plus qu'sur iOS.
      paddingTop: insetTop + 14,
      paddingBottom: 14,
      backgroundColor: palette.paper,
      borderBottomWidth: 1,
      borderBottomColor: palette.border,
    },
    burger: { gap: 4, padding: 6 },
    burgerBar: {
      width: 22,
      height: 2,
      borderRadius: 1,
      backgroundColor: palette.ink,
    },
    brand: { flexDirection: "row", alignItems: "center", gap: 8 },
    brandMark: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: palette.brand,
      alignItems: "center",
      justifyContent: "center",
    },
    logo: {
      fontFamily: fontDisplay,
      fontSize: 14,
      fontWeight: "700",
      color: palette.brand,
    },
    modalRoot: { flex: 1, flexDirection: "row" },
    panel: {
      width: "78%",
      maxWidth: 320,
      height: "100%",
      backgroundColor: palette.paper,
      paddingTop: insetTop + 24,
      paddingHorizontal: 20,
    },
    panelTitle: {
      fontFamily: fontDisplay,
      fontSize: 20,
      fontWeight: "700",
      color: palette.ink,
      marginBottom: 20,
    },
    item: { paddingVertical: 14 },
    itemText: { fontSize: 16, color: palette.ink, fontWeight: "600" },
    itemDanger: { color: palette.danger },
    separator: {
      height: 1,
      backgroundColor: palette.border,
      marginVertical: 12,
    },
    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  });
}
