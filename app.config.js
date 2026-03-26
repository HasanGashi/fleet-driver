// Dynamic config that merges with app.json and adds plugins + env vars
export default ({ config }) => ({
  ...config,
  plugins: [
    "expo-dev-client",
    [
      "expo-notifications",
      {
        icon: "./assets/icon.png",
        color: "#ffffff",
      },
    ],
    [
      "expo-location",
      {
        locationAlwaysAndWhenInUsePermission:
          "FleetManager needs your location to track deliveries in the background.",
        locationWhenInUsePermission:
          "FleetManager needs your location to show your position on the fleet map.",
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
  ],
  ios: {
    ...config.ios,
    infoPlist: {
      ...config.ios?.infoPlist,
      NSLocationAlwaysAndWhenInUseUsageDescription:
        "FleetManager needs your location to track deliveries in the background.",
      NSLocationWhenInUseUsageDescription:
        "FleetManager needs your location to show your position on the fleet map.",
      UIBackgroundModes: [
        ...(config.ios?.infoPlist?.UIBackgroundModes ?? []),
        "location",
        "fetch",
      ],
    },
  },
  extra: {
    ...config.extra,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    hereApiKey: process.env.HERE_API_KEY,
    truck: {
      height: 300,
      width: 220,
      length: 750,
      weight: 7500,
      axleCount: 2,
    },
  },
});
