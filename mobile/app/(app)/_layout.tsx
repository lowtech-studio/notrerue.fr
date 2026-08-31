import { useEffect } from "react";
import { Stack } from "expo-router";
import { registerForPushNotifications } from "../../lib/notifications";

/**
 * Enveloppe de tous les écrans connectés — un seul endroit pour
 * l'enregistrement des notifications push (cf. lib/notifications.ts),
 * plutôt que de le répéter sur chaque écran : couvre à la fois « je viens
 * de me connecter » et « je rouvre l'app avec une session déjà active »,
 * les deux passant par ce layout.
 */
export default function AppLayout() {
  useEffect(() => {
    registerForPushNotifications();
  }, []);

  return <Stack screenOptions={{ headerShown: false }} />;
}
