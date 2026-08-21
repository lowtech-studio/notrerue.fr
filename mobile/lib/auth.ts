import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Jeton de session (même format que le cookie web, cf.
 * web/utils/session.ts#createSessionValue et _doc/architecture-mobile.md)
 * stocké via le Keychain iOS / Keystore Android — jamais `AsyncStorage` en
 * clair (AGENTS.md « Cyber sécurité » R23 : rien de sensible en
 * localStorage/équivalent, même exigence côté mobile).
 *
 * `expo-secure-store` ne supporte pas la cible web (aucun Keychain/Keystore
 * à y adosser, cf. doc Expo) — `SecureStore.getItemAsync` y lève
 * `getValueWithKeyAsync is not a function` plutôt que de dégrader
 * proprement. La cible réelle de l'app reste iOS/Android (cf.
 * _doc/architecture-mobile.md : Capacitor/PWA explicitement écartés pour
 * privilégier du natif) — `web` ne sert qu'à prévisualiser un écran vite
 * fait dans un navigateur pendant le développement, jamais distribué.
 * `localStorage` y est donc un repli acceptable : aucune garantie de
 * sécurité réelle sur cette plateforme de toute façon (contrairement à
 * iOS/Android, où `expo-secure-store` s'applique sans exception).
 */
const TOKEN_KEY = "notrerue_session_token";
const isWeb = Platform.OS === "web";

export async function getToken(): Promise<string | null> {
  if (isWeb) return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
  return await SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  if (isWeb) {
    globalThis.localStorage?.setItem(TOKEN_KEY, token);
    return;
  }
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  if (isWeb) {
    globalThis.localStorage?.removeItem(TOKEN_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
