import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
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
import { requestCode, verifyCode } from "../../lib/api";
import { setToken } from "../../lib/auth";
import { colors, fontDisplay, radius, type ThemeColors } from "../../lib/theme";

const CODE_LENGTH = 6;

/**
 * Vérification du code à 6 chiffres reçu par e-mail (cf.
 * routes/api/v1/auth/verify.ts) — succès : le jeton est stocké de façon
 * sécurisée (lib/auth.ts, Keychain/Keystore) puis on rejoint (app)/, jamais
 * de jeton affiché ni journalisé ici.
 */
export default function Code() {
  const { email } = useLocalSearchParams<{ email: string }>();
  const scheme = useColorScheme();
  const palette = colors[scheme === "dark" ? "dark" : "light"];
  const styles = createStyles(palette);

  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  async function handleVerify() {
    setError(null);
    if (!email || code.trim().length !== CODE_LENGTH) {
      setError(`Saisissez le code à ${CODE_LENGTH} chiffres reçu par e-mail.`);
      return;
    }
    setSubmitting(true);
    const result = await verifyCode(email, code.trim());
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    await setToken(result.data.token);
    router.replace("/(app)");
  }

  async function handleResend() {
    if (!email) return;
    setResendMessage(null);
    setResending(true);
    const result = await requestCode(email);
    setResending(false);
    setResendMessage(
      result.ok
        ? "Un nouveau code vient d'être envoyé."
        : result.error,
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.container}>
        <Text style={styles.title}>Vérifiez votre e-mail</Text>
        <Text style={styles.subtitle}>
          Saisissez le code à {CODE_LENGTH} chiffres envoyé à {email}.
        </Text>

        {error && <Text style={styles.error}>{error}</Text>}
        {resendMessage && <Text style={styles.info}>{resendMessage}</Text>}

        <TextInput
          style={styles.codeInput}
          value={code}
          onChangeText={(text) =>
            setCode(text.replace(/\D/g, "").slice(0, CODE_LENGTH))}
          keyboardType="number-pad"
          maxLength={CODE_LENGTH}
          placeholder="000000"
          placeholderTextColor={palette.inkMuted}
          textAlign="center"
        />

        <Pressable
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={handleVerify}
          disabled={submitting}
        >
          {submitting
            ? <ActivityIndicator color={palette.paperWarm} />
            : <Text style={styles.buttonText}>Se connecter</Text>}
        </Pressable>

        <Pressable onPress={handleResend} disabled={resending}>
          <Text style={styles.link}>
            {resending ? "Envoi en cours..." : "Renvoyer le code"}
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
      fontSize: 26,
      fontWeight: "700",
      color: palette.ink,
      marginBottom: 4,
    },
    subtitle: { fontSize: 15, color: palette.inkSoft, marginBottom: 24 },
    error: { color: palette.danger, marginBottom: 12, fontSize: 14 },
    info: { color: palette.inkSoft, marginBottom: 12, fontSize: 14 },
    codeInput: {
      borderWidth: 2,
      borderColor: palette.borderStrong,
      borderRadius: radius.md,
      paddingVertical: 14,
      fontSize: 28,
      letterSpacing: 8,
      color: palette.ink,
      backgroundColor: palette.paper,
      marginBottom: 20,
    },
    button: {
      backgroundColor: palette.brand,
      borderRadius: radius.md,
      paddingVertical: 14,
      alignItems: "center",
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
