import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Share,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from "react-native";
import { AppHeader } from "../../components/AppHeader";
import { fetchStreetStatus, joinUrl, type StreetStatus } from "../../lib/api";
import { colors, fontDisplay, radius, type ThemeColors } from "../../lib/theme";

/** Même accord simple singulier/pluriel que web/utils/pluralize.ts —
 * dupliqué (pure, sans dépendance runtime web) plutôt qu'importé, cf.
 * lib/relativeDate.ts pour le même raisonnement sur la frontière
 * Deno/Metro. */
function pluralizeCount(
  count: number,
  singular: string,
  plural: string = `${singular}s`,
): string {
  return `${count} ${count > 1 ? plural : singular}`;
}

/** Même texte que web/routes/inviter.tsx#buildSubtitle. */
function buildSubtitle(status: StreetStatus): string {
  if (status.isAwake) {
    return `${
      pluralizeCount(
        status.housesCount,
        "foyer est déjà inscrit",
        "foyers sont déjà inscrits",
      )
    } sur la ${status.streetName}. Continuez à inviter pour que l'entraide reste vivante.`;
  }
  if (status.remaining === 1) {
    return `Il manque un seul foyer pour que la ${status.streetName} s'allume. Tant qu'elle dort, la seule chose à faire ici : inviter.`;
  }
  return `${
    pluralizeCount(status.housesCount, "foyer inscrit", "foyers inscrits")
  } sur ${status.threshold} sur la ${status.streetName}. Tant qu'elle dort, la seule chose à faire ici : inviter.`;
}

/** Même message que web/routes/inviter.tsx#loadInviterCore. */
function buildShareMessage(status: StreetStatus): string {
  const url = joinUrl(status.cityId, status.streetName);
  return `Salut ! Je m'inscris sur NotreRue.fr pour qu'on s'entraide entre ` +
    `voisins de la ${status.streetName} (${status.cityName}) : partage, ` +
    `coup de main, bons plans. Rejoins-moi ici : ${url}`;
}

/**
 * Invitation des voisins (cf. backlog mobile « inviter mes voisins en
 * utilisant les fonctions de partage mobiles »). Contrairement au web (qui
 * doit reconstruire à la main un bouton par canal — e-mail envoyé par le
 * serveur, lien wa.me pour WhatsApp, kit papier à imprimer, cf.
 * web/routes/inviter.tsx), le mobile délègue directement à la feuille de
 * partage native (`Share.share`, cf. React Native) : SMS, WhatsApp,
 * e-mail, ou n'importe quelle appli installée qui sait recevoir du texte —
 * un seul bouton plutôt qu'un par canal.
 */
export default function Inviter() {
  const scheme = useColorScheme();
  const palette = colors[scheme === "dark" ? "dark" : "light"];
  const styles = createStyles(palette);

  const [status, setStatus] = useState<StreetStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    fetchStreetStatus().then((result) => {
      if (result.ok) {
        setStatus(result.data);
      } else {
        setError(result.error);
      }
      setLoading(false);
    });
  }, []);

  async function handleShare() {
    if (!status) return;
    setSharing(true);
    try {
      await Share.share({ message: buildShareMessage(status) });
    } catch {
      // Partage annulé par l'habitant, ou indisponible sur cette
      // plateforme (cf. cible web, non distribuée, `Share` n'y est pas
      // implémenté) — le lien reste de toute façon affiché en clair
      // ci-dessous, jamais bloquant.
    }
    setSharing(false);
  }

  return (
    <View style={styles.flex}>
      <AppHeader />

      {loading
        ? (
          <View style={styles.center}>
            <ActivityIndicator color={palette.brand} />
          </View>
        )
        : (
          <View style={styles.container}>
            <Text style={styles.title}>Invitez vos voisins</Text>

            {error && <Text style={styles.error}>{error}</Text>}

            {status && (
              <>
                <Text style={styles.subtitle}>{buildSubtitle(status)}</Text>

                {!status.isAwake && (
                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.progressFill,
                        {
                          width: `${
                            Math.min(
                              100,
                              (status.housesCount / status.threshold) * 100,
                            )
                          }%`,
                        },
                      ]}
                    />
                  </View>
                )}

                <Pressable
                  style={[styles.button, sharing && styles.buttonDisabled]}
                  onPress={handleShare}
                  disabled={sharing}
                >
                  {sharing
                    ? <ActivityIndicator color={palette.paperWarm} />
                    : (
                      <Text style={styles.buttonText}>
                        Partager l'invitation
                      </Text>
                    )}
                </Pressable>
                <Text style={styles.buttonHint}>
                  SMS, WhatsApp, e-mail… choisissez dans la liste proposée.
                </Text>

                <Text style={styles.linkLabel}>Ou copiez le lien :</Text>
                <Text selectable style={styles.link}>
                  {joinUrl(status.cityId, status.streetName)}
                </Text>
              </>
            )}
          </View>
        )}
    </View>
  );
}

function createStyles(palette: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: palette.paper },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    container: { flex: 1, padding: 24 },
    title: {
      fontFamily: fontDisplay,
      fontSize: 24,
      fontWeight: "700",
      color: palette.ink,
      marginBottom: 8,
    },
    subtitle: {
      fontSize: 15,
      color: palette.inkSoft,
      lineHeight: 21,
      marginBottom: 16,
    },
    error: { color: palette.danger, marginBottom: 12, fontSize: 14 },
    progressTrack: {
      height: 8,
      borderRadius: 4,
      backgroundColor: palette.border,
      overflow: "hidden",
      marginBottom: 24,
    },
    progressFill: { height: "100%", backgroundColor: palette.brand },
    button: {
      backgroundColor: palette.brand,
      borderRadius: radius.md,
      paddingVertical: 14,
      alignItems: "center",
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: palette.paperWarm, fontSize: 16, fontWeight: "700" },
    buttonHint: {
      fontSize: 12,
      color: palette.inkMuted,
      textAlign: "center",
      marginTop: 6,
      marginBottom: 28,
    },
    linkLabel: { fontSize: 13, color: palette.inkSoft, marginBottom: 4 },
    link: {
      fontSize: 13,
      color: palette.brand,
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: radius.md,
      padding: 10,
    },
  });
}
