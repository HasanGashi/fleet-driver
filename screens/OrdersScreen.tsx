import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "@react-navigation/native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { supabase } from "../lib/supabase";
import { RootStackParamList } from "../types/navigation";

type Props = NativeStackScreenProps<RootStackParamList, "Orders">;

type Order = {
  id: string;
  pickup_address: string;
  delivery_address: string;
  goods_desc: string | null;
  weight_tons: number | null;
  status: string;
  created_at: string;
};

type Driver = { id: string; full_name: string };

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  pending: { label: "PENDING", color: "#64748B", bg: "#F1F5F9" },
  assigned: { label: "ASSIGNED", color: "#B45309", bg: "#FEF3C7" },
  picked_up: { label: "PICKED UP", color: "#C2410C", bg: "#FFF7ED" },
  in_transit: { label: "IN TRANSIT", color: "#1D4ED8", bg: "#EFF6FF" },
  delivered: { label: "DELIVERED", color: "#15803D", bg: "#F0FDF4" },
};

function shortId(id: string) {
  return "#" + id.slice(0, 6).toUpperCase();
}

export default function OrdersScreen({ navigation }: Props) {
  const [driverId, setDriverId] = useState<string | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Load driver identity once on mount
  useEffect(() => {
    async function loadDriver() {
      const id = await AsyncStorage.getItem("driverId");
      if (!id) return;
      setDriverId(id);
      const { data } = await supabase
        .from("drivers")
        .select("id, full_name")
        .eq("id", id)
        .single();
      if (data) setDriver(data);
    }
    loadDriver();
  }, []);

  const fetchOrders = useCallback(async (id: string) => {
    const { data, error } = await supabase
      .from("orders")
      .select(
        "id, pickup_address, delivery_address, goods_desc, weight_tons, status, created_at",
      )
      .eq("driver_id", id)
      .order("created_at", { ascending: false });

    if (error) {
      Alert.alert("Error", "Could not load orders.");
    } else if (data) {
      // Active orders first, delivered last
      const sorted = [...data].sort((a, b) => {
        if (a.status === "delivered" && b.status !== "delivered") return 1;
        if (a.status !== "delivered" && b.status === "delivered") return -1;
        return 0;
      });
      setOrders(sorted);
    }
  }, []);

  // Initial load when driverId becomes available
  useEffect(() => {
    if (!driverId) return;
    setLoading(true);
    fetchOrders(driverId).finally(() => setLoading(false));
  }, [driverId, fetchOrders]);

  // Re-fetch when screen comes back into focus (e.g. returning from OrderDetail)
  useFocusEffect(
    useCallback(() => {
      if (driverId) fetchOrders(driverId);
    }, [driverId, fetchOrders]),
  );

  // Subscribe to Realtime so new assignments appear instantly
  useEffect(() => {
    if (!driverId) return;
    const channel = supabase
      .channel(`orders-driver-${driverId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `driver_id=eq.${driverId}`,
        },
        () => fetchOrders(driverId),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [driverId, fetchOrders]);

  async function handleRefresh() {
    if (!driverId) return;
    setRefreshing(true);
    await fetchOrders(driverId);
    setRefreshing(false);
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
      <View style={styles.headerBar}>
        <Text style={styles.greeting}>Hi, {driver?.full_name ?? "..."}</Text>
      </View>

      <FlatList
        data={orders}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#2563EB"
          />
        }
        renderItem={({ item }) => {
          const cfg = STATUS_CONFIG[item.status] ?? STATUS_CONFIG.pending;
          return (
            <View
              style={[
                styles.card,
                item.status === "delivered" && styles.cardDelivered,
              ]}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.orderId}>{shortId(item.id)}</Text>
                <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
                  <Text style={[styles.badgeText, { color: cfg.color }]}>
                    {cfg.label}
                  </Text>
                </View>
              </View>

              <View style={styles.cardBody}>
                <Text style={styles.addressLabel}>From</Text>
                <Text style={styles.addressText} numberOfLines={1}>
                  {item.pickup_address}
                </Text>
                <Text style={[styles.addressLabel, { marginTop: 6 }]}>To</Text>
                <Text style={styles.addressText} numberOfLines={1}>
                  {item.delivery_address}
                </Text>
                {item.goods_desc ? (
                  <Text style={styles.goodsText} numberOfLines={1}>
                    {item.goods_desc}
                    {item.weight_tons ? ` · ${item.weight_tons}T` : ""}
                  </Text>
                ) : null}
              </View>

              <TouchableOpacity
                style={styles.viewButton}
                onPress={() =>
                  navigation.navigate("OrderDetail", { orderId: item.id })
                }
                activeOpacity={0.7}
              >
                <Text style={styles.viewButtonText}>View →</Text>
              </TouchableOpacity>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>Waiting for orders...</Text>
            <Text style={styles.emptySubText}>
              The dispatcher will assign orders to you soon.
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
  },
  headerBar: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },
  greeting: { fontSize: 22, fontWeight: "700", color: "#1E293B" },
  listContent: { padding: 20, paddingTop: 12, paddingBottom: 40 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardDelivered: { opacity: 0.65 },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  orderId: {
    fontSize: 14,
    fontWeight: "700",
    color: "#1E293B",
    letterSpacing: 0.5,
  },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  cardBody: { marginBottom: 14 },
  addressLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#94A3B8",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  addressText: { fontSize: 14, color: "#1E293B" },
  goodsText: { fontSize: 13, color: "#64748B", marginTop: 8 },
  viewButton: {
    alignSelf: "flex-end",
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#EFF6FF",
    borderRadius: 8,
  },
  viewButtonText: { color: "#2563EB", fontWeight: "600", fontSize: 14 },
  emptyContainer: { alignItems: "center", marginTop: 80 },
  emptyText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#64748B",
    marginBottom: 8,
  },
  emptySubText: {
    fontSize: 14,
    color: "#94A3B8",
    textAlign: "center",
    lineHeight: 20,
  },
});
