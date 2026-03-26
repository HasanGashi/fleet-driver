import { registerRootComponent } from "expo";
import * as TaskManager from "expo-task-manager";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./lib/supabase";

import App from "./App";

export const LOCATION_TASK = "background-location";

// Must be defined in the root entry file before registerRootComponent
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error("[LocationTask] error:", error);
    return;
  }
  if (!data) return;

  const { locations } = data as { locations: Location.LocationObject[] };
  if (!locations || locations.length === 0) return;

  const { latitude: lat, longitude: lon, heading } = locations[0].coords;
  const driverId = await AsyncStorage.getItem("driverId");
  if (!driverId) return;

  await supabase.from("driver_locations").upsert({
    driver_id: driverId,
    lat,
    lon,
    heading: heading ?? null,
    updated_at: new Date().toISOString(),
  });
});

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
