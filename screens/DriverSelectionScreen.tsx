import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  SafeAreaView,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { supabase } from "../lib/supabase";
import { registerForPushNotificationsAsync } from "../lib/notifications";
import { RootStackParamList } from "../types/navigation";

type Props = NativeStackScreenProps<RootStackParamList, "DriverSelection">;

type Driver = {
  id: string;
  full_name: string;
  phone: string | null;
  truck_plate: string | null;
};

export default function DriverSelectionScreen({ navigation }: Props) {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function fetchDrivers() {
      const { data, error } = await supabase
        .from("drivers")
        .select("id, full_name, phone, truck_plate")
        .order("full_name");

      if (error) {
        Alert.alert("Error", "Could not load drivers. Check your connection.");
      } else if (data) {
        setDrivers(data);
      }
      setLoading(false);
    }

    fetchDrivers();
  }, []);

  async function handleConfirm() {
    if (!selectedDriverId) {
      Alert.alert("Select a driver", "Please tap your name before confirming.");
      return;
    }

    setSaving(true);

    // Persist driver identity
    await AsyncStorage.setItem("driverId", selectedDriverId);

    // Register for push notifications and save token to Supabase
    const token = await registerForPushNotificationsAsync();
    if (token) {
      await supabase
        .from("drivers")
        .update({ expo_push_token: token })
        .eq("id", selectedDriverId);
    }

    navigation.replace("Orders");
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>FleetManager</Text>
        <Text style={styles.subtitle}>Who are you?</Text>
      </View>

      <FlatList
        data={drivers}
        keyExtractor={(item) => item.id}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const isSelected = selectedDriverId === item.id;
          return (
            <TouchableOpacity
              style={[
                styles.driverItem,
                isSelected && styles.driverItemSelected,
              ]}
              onPress={() => setSelectedDriverId(item.id)}
              activeOpacity={0.7}
            >
              <View>
                <Text
                  style={[
                    styles.driverName,
                    isSelected && styles.driverNameSelected,
                  ]}
                >
                  {item.full_name}
                </Text>
                {item.truck_plate ? (
                  <Text style={styles.driverMeta}>{item.truck_plate}</Text>
                ) : null}
              </View>
              {isSelected && <Text style={styles.checkmark}>✓</Text>}
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            No drivers found.{"\n"}Ask the admin to add drivers first.
          </Text>
        }
      />

      <TouchableOpacity
        style={[
          styles.button,
          (!selectedDriverId || saving) && styles.buttonDisabled,
        ]}
        onPress={handleConfirm}
        disabled={!selectedDriverId || saving}
        activeOpacity={0.8}
      >
        {saving ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Confirm</Text>
        )}
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
  },
  header: {
    alignItems: "center",
    paddingTop: 48,
    paddingBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#1E3A5F",
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 18,
    color: "#64748B",
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 16,
  },
  driverItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: "#E2E8F0",
  },
  driverItemSelected: {
    borderColor: "#2563EB",
    backgroundColor: "#EFF6FF",
  },
  driverName: {
    fontSize: 16,
    color: "#1E293B",
    fontWeight: "500",
  },
  driverNameSelected: {
    color: "#2563EB",
    fontWeight: "600",
  },
  driverMeta: {
    fontSize: 13,
    color: "#94A3B8",
    marginTop: 2,
  },
  checkmark: {
    fontSize: 20,
    color: "#2563EB",
    fontWeight: "700",
  },
  emptyText: {
    textAlign: "center",
    color: "#94A3B8",
    marginTop: 60,
    fontSize: 15,
    lineHeight: 24,
  },
  button: {
    backgroundColor: "#2563EB",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  buttonDisabled: {
    backgroundColor: "#93C5FD",
  },
  buttonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
