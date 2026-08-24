import { useState } from "react";
import { router } from "expo-router";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { requestCode } from "../../lib/api";
import { colors, fontDisplay, radius, type ThemeColors } from "../../lib/theme";

/**
 * Connexion d'un habitant déjà inscrit — cf. web/routes/connexion.tsx
 * (étape e-mail) et routes/api/v1/auth/code.ts, réutilisé tel quel : un
 * simple code à 6 chiffres par e-mail, pas de mot de passe. La saisie du
 * code réutilise ensuite le même écran que l'inscription ((auth)/code.tsx,
 * cf. lib/api.ts#verifyCode) — un seul écran de vérification pour les deux
 * flux, comme `/connexion?email=...` côté web après une inscription.
 */
export default function Connexion() {
  const scheme = useColorScheme();
  const palette = colors[scheme === "dark" ? "dark" : "light"];
  const styles = createStyles(palette);

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    const trimmedEmail = email.trim();
    if (!trimmedEmail.includes("@")) {
      setError("Merci de renseigner un e-mail valide.");
      return;
    }

    setSubmitting(true);
    // Réponse volontairement uniforme que l'e-mail soit inscrit ou non
    // (cf. routes/api/v1/auth/code.ts) : on avance toujours à l'étape
    // suivante, jamais d'indice ici sur l'existence d'un compte.
    const result = await requestCode(trimmedEmail);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push({
      pathname: "/(auth)/code",
      params: { email: trimmedEmail },
    });
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.container}>
        <Text style={styles.title}>Se connecter</Text>
        <Text style={styles.subtitle}>
          Recevez un code de connexion à 6 chiffres par e-mail — pas de mot
          de passe à retenir.
        </Text>

        {error && <Text style={styles.error}>{error}</Text>}

        <Text style={styles.label}>E-mail</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="camille@exemple.fr"
          placeholderTextColor={palette.inkMuted}
        />

        <Pressable
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator color={palette.paperWarm} />
            : <Text style={styles.buttonText}>Recevoir mon code</Text>}
        </Pressable>

        <Pressable onPress={() => router.push("/(auth)/inscription")}>
          <Text style={styles.link}>
            Pas encore inscrit·e ? Rejoindre NotreRue.fr
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function createStyles(palette: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1, backgroundColor: palette.paper },
    container: { flex: 1, padding: 24, justifyContent: "center" },
    title: {
      fontFamily: fontDisplay,
      fontSize: 28,
      fontWeight: "700",
      color: palette.ink,
      marginBottom: 4,
    },
    subtitle: {
      fontSize: 15,
      color: palette.inkSoft,
      marginBottom: 24,
    },
    error: {
      color: palette.danger,
      marginBottom: 12,
      fontSize: 14,
    },
    label: {
      fontSize: 13,
      fontWeight: "600",
      color: palette.inkSoft,
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
    button: {
      backgroundColor: palette.brand,
      borderRadius: radius.md,
      paddingVertical: 14,
      alignItems: "center",
      marginTop: 24,
      marginBottom: 16,
    },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: palette.paperWarm, fontSize: 16, fontWeight: "700" },
    link: {
      textAlign: "center",
      color: palette.brand,
      fontSize: 14,
      fontWeight: "600",
    },
  });
}
