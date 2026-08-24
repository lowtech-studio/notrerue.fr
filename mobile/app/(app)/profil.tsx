import { useEffect, useState } from "react";
import { router } from "expo-router";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { AppHeader } from "../../components/AppHeader";
import { clearToken } from "../../lib/auth";
import {
  deleteAccount,
  fetchProfile,
  type Profile,
  updateProfile,
} from "../../lib/api";
import { colors, fontDisplay, radius, type ThemeColors } from "../../lib/theme";

const MAX_LOGIN_LENGTH = 40;
const MAX_HOUSE_NUMBER_LENGTH = 10;

/**
 * Profil (cf. routes/api/v1/profile.ts, backlog mobile « toutes les
 * fonctionnalités de la page /profil ») : login et numéro de foyer
 * modifiables (mêmes seuls champs que web/routes/profil.tsx — ni l'e-mail
 * ni la rue/ville), et suppression de compte irréversible. Pas de
 * déconnexion de toutes les sessions ici : item de backlog mobile distinct
 * (« déconnecter toutes mes sessions actives »), la déconnexion simple
 * reste dans le menu burger (cf. components/AppHeader.tsx).
 */
export default function Profil() {
  const scheme = useColorScheme();
  const palette = colors[scheme === "dark" ? "dark" : "light"];
  const styles = createStyles(palette);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [login, setLogin] = useState("");
  const [houseNumber, setHouseNumber] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchProfile().then((result) => {
      if (result.ok) {
        setProfile(result.data);
        setLogin(result.data.login);
        setHouseNumber(result.data.houseNumber);
      } else {
        setError(result.error);
      }
      setLoading(false);
    });
  }, []);

  async function handleSave() {
    setError(null);
    setUpdated(false);
    if (!login.trim()) {
      setError("Merci de renseigner un login.");
      return;
    }
    setSaving(true);
    const result = await updateProfile(login.trim(), houseNumber.trim());
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setProfile(result.data);
    setLogin(result.data.login);
    setHouseNumber(result.data.houseNumber);
    setUpdated(true);
  }

  async function handleDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setDeleting(true);
    const result = await deleteAccount();
    if (!result.ok) {
      setDeleting(false);
      setError(result.error);
      return;
    }
    await clearToken();
    router.replace("/");
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <AppHeader />

      {loading
        ? (
          <View style={styles.center}>
            <ActivityIndicator color={palette.brand} />
          </View>
        )
        : (
          <ScrollView
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.title}>Mon profil</Text>
            {profile && (
              <Text style={styles.subtitle}>
                {profile.streetName}, {profile.cityName}
              </Text>
            )}

            {updated && (
              <Text style={styles.confirmation}>
                Votre profil a été mis à jour.
              </Text>
            )}
            {error && <Text style={styles.error}>{error}</Text>}

            <Text style={styles.label}>Login</Text>
            <TextInput
              style={styles.input}
              value={login}
              onChangeText={(text) => setLogin(text.slice(0, MAX_LOGIN_LENGTH))}
              autoCapitalize="none"
              autoCorrect={false}
              placeholderTextColor={palette.inkMuted}
            />

            <Text style={styles.label}>Numéro de rue (facultatif)</Text>
            <TextInput
              style={styles.input}
              value={houseNumber}
              onChangeText={(text) =>
                setHouseNumber(text.slice(0, MAX_HOUSE_NUMBER_LENGTH))}
              placeholder="14"
              placeholderTextColor={palette.inkMuted}
            />
            <Text style={styles.hint}>
              Seuls les foyers que vous choisirez pourront le voir.
            </Text>

            <Text style={styles.label}>E-mail</Text>
            <Text style={styles.readOnly}>{profile?.email}</Text>

            <Pressable
              style={[styles.button, saving && styles.buttonDisabled]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color={palette.paperWarm} />
                : <Text style={styles.buttonText}>Enregistrer</Text>}
            </Pressable>

            <View style={styles.dangerZone}>
              <Text style={styles.dangerTitle}>Zone de danger</Text>
              {confirmingDelete && (
                <Text style={styles.dangerWarning}>
                  Votre foyer et toutes vos publications (demandes, réponses)
                  seront supprimés. Cette action est irréversible.
                </Text>
              )}
              <Pressable
                style={[styles.dangerButton, deleting && styles.buttonDisabled]}
                onPress={handleDelete}
                disabled={deleting}
              >
                {deleting
                  ? <ActivityIndicator color={palette.paperWarm} />
                  : (
                    <Text style={styles.dangerButtonText}>
                      {confirmingDelete
                        ? "Oui, supprimer définitivement mon compte"
                        : "Supprimer mon compte"}
                    </Text>
                  )}
              </Pressable>
            </View>
          </ScrollView>
        )}
    </KeyboardAvoidingView>
  );
}

function createStyles(palette: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: palette.paper },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    container: { padding: 24, gap: 4 },
    title: {
      fontFamily: fontDisplay,
      fontSize: 24,
      fontWeight: "700",
      color: palette.ink,
    },
    subtitle: { fontSize: 14, color: palette.inkSoft, marginBottom: 16 },
    confirmation: {
      color: palette.brand,
      fontSize: 14,
      fontWeight: "600",
      marginBottom: 12,
    },
    error: { color: palette.danger, fontSize: 14, marginBottom: 12 },
    label: {
      fontSize: 13,
      fontWeight: "600",
      color: palette.inkSoft,
      marginTop: 12,
      marginBottom: 4,
    },
    input: {
      borderWidth: 2,
      borderColor: palette.borderStrong,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 16,
      color: palette.ink,
      backgroundColor: palette.paper,
    },
    hint: { fontSize: 12, color: palette.inkMuted, marginTop: 4 },
    readOnly: { fontSize: 16, color: palette.inkSoft },
    button: {
      backgroundColor: palette.brand,
      borderRadius: radius.md,
      paddingVertical: 14,
      alignItems: "center",
      marginTop: 24,
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: palette.paperWarm, fontSize: 16, fontWeight: "700" },
    dangerZone: {
      marginTop: 40,
      paddingTop: 20,
      borderTopWidth: 1,
      borderTopColor: palette.border,
    },
    dangerTitle: {
      fontSize: 13,
      fontWeight: "700",
      color: palette.inkMuted,
      textTransform: "uppercase",
      letterSpacing: 0.4,
      marginBottom: 10,
    },
    dangerWarning: {
      fontSize: 13,
      color: palette.inkSoft,
      marginBottom: 12,
      lineHeight: 18,
    },
    dangerButton: {
      backgroundColor: palette.danger,
      borderRadius: radius.md,
      paddingVertical: 14,
      alignItems: "center",
    },
    dangerButtonText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  });
}
