import { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, useColorScheme, View } from "react-native";
import { getToken } from "../lib/auth";
import { colors } from "../lib/theme";

/**
 * Porte d'entrée : vérifie s'il existe déjà un jeton de session valide
 * (Keychain/Keystore, cf. lib/auth.ts) et redirige en conséquence — jamais
 * de vérification serveur ici, juste la présence du jeton (un jeton
 * expiré/révoqué échouera simplement au premier appel authentifié, cf.
 * lib/api.ts#authFetch, à traiter par les écrans qui viendront avec
 * `/api/v1/posts`/`/api/v1/messages`).
 */
export default function Index() {
  const [token, setToken] = useState<string | null | "loading">("loading");
  const scheme = useColorScheme();
  const palette = colors[scheme === "dark" ? "dark" : "light"];

  useEffect(() => {
    getToken().then(setToken);
  }, []);

  if (token === "loading") {
    return (
      <View style={[styles.center, { backgroundColor: palette.paper }]}>
        <ActivityIndicator color={palette.brand} />
      </View>
    );
  }

  return token
    ? <Redirect href="/(app)" />
    : <Redirect href="/(auth)/inscription" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
