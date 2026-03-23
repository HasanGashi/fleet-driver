import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import {
  NavigationContainer,
  createNavigationContainerRef,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { supabase } from "./lib/supabase";
import { registerForPushNotificationsAsync } from "./lib/notifications";
import DriverSelectionScreen from "./screens/DriverSelectionScreen";
import OrdersScreen from "./screens/OrdersScreen";
import OrderDetailScreen from "./screens/OrderDetailScreen";
import { RootStackParamList } from "./types/navigation";

// Handle notifications that arrive while the app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const Stack = createNativeStackNavigator<RootStackParamList>();
const navigationRef = createNavigationContainerRef<RootStackParamList>();

export default function App() {
  const [isLoading, setIsLoading] = useState(true);
  const [initialRoute, setInitialRoute] =
    useState<keyof RootStackParamList>("DriverSelection");

  // On every launch, check stored driver identity and refresh the push token
  useEffect(() => {
    async function initApp() {
      const driverId = await AsyncStorage.getItem("driverId");

      if (driverId) {
        // Driver already identified — refresh push token silently
        const token = await registerForPushNotificationsAsync();
        if (token) {
          await supabase
            .from("drivers")
            .update({ expo_push_token: token })
            .eq("id", driverId);
        }
        setInitialRoute("Orders");
      }

      setIsLoading(false);
    }

    initApp();
  }, []);

  // Navigate to Order Detail when user taps a push notification
  useEffect(() => {
    const responseListener =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const orderId = response.notification.request.content.data?.orderId as
          | string
          | undefined;
        if (orderId && navigationRef.isReady()) {
          navigationRef.navigate("OrderDetail", { orderId });
        }
      });

    return () => responseListener.remove();
  }, []);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={{
          headerTintColor: "#2563EB",
          headerTitleStyle: { fontWeight: "700" },
        }}
      >
        <Stack.Screen
          name="DriverSelection"
          component={DriverSelectionScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="Orders"
          component={OrdersScreen}
          options={{ title: "FleetManager", headerBackVisible: false }}
        />
        <Stack.Screen
          name="OrderDetail"
          component={OrderDetailScreen}
          options={{ title: "Order Detail" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
