// Dynamic config that merges with app.json and adds plugins + env vars
export default ({ config }) => ({
  ...config,
  plugins: [
    [
      "expo-notifications",
      {
        icon: "./assets/icon.png",
        color: "#ffffff",
      },
    ],
  ],
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    eas: {
      projectId: process.env.EAS_PROJECT_ID ?? "your-eas-project-id",
    },
  },
});
