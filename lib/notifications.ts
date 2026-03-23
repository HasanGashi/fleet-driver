import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

/**
 * Requests push notification permissions and returns the Expo push token.
 * Returns null on simulators or if permission is denied.
 */
export async function registerForPushNotificationsAsync(): Promise<
  string | null
> {
  if (!Device.isDevice) {
    return null;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#2563EB",
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    return null;
  }

  const token = (await Notifications.getExpoPushTokenAsync()).data;
  return token;
}
