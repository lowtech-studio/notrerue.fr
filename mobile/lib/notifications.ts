import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { registerPushToken } from "./api";

/**
 * Comportement d'une notification reçue pendant que l'app est au premier
 * plan (cf. doc Expo) — bannière + entrée dans le centre de notifications,
 * pas de son (une demande/un message n'est pas une urgence), pas de badge
 * (pas de compteur géré côté app pour l'instant).
 */
Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
});

/**
 * Demande la permission puis enregistre le jeton de push Expo côté serveur
 * (cf. routes/api/v1/push/register.ts, push/expo.ts, backlog mobile
 * « être notifié via la notification mobile »). Tolérant à l'échec à
 * chaque étape — permission refusée, cible web (`Notifications` n'y est
 * pas implémenté), ou pas encore de projet EAS lié donc pas de
 * `projectId` (cf. `_doc/publishing-mobile.md`, `eas init`/`eas
 * update:configure` pas encore exécutés) : ne bloque jamais le reste de
 * l'app, se contente de ne rien enregistrer. À appeler après connexion et
 * à chaque lancement de l'app pendant qu'une session existe (cf.
 * app/(app)/_layout.tsx) — le jeton peut changer d'un lancement à l'autre.
 */
export async function registerForPushNotifications(): Promise<void> {
  try {
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const current = await Notifications.getPermissionsAsync();
    let status = current.status;
    if (status !== "granted") {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== "granted") return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId as
      | string
      | undefined;
    if (!projectId) return;

    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId,
    });
    await registerPushToken(token);
  } catch (error) {
    console.error(
      "Échec de l'enregistrement du jeton de notifications push :",
      error,
    );
  }
}
