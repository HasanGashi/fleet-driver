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
  ],
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
