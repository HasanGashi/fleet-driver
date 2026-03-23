import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { supabase } from "../lib/supabase";
import { RootStackParamList } from "../types/navigation";

type Props = NativeStackScreenProps<RootStackParamList, "OrderDetail">;

type Order = {
  id: string;
  pickup_address: string;
  delivery_address: string;
  goods_desc: string | null;
  weight_tons: number | null;
  notes: string | null;
  status: string;
  created_at: string;
};

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

const NEXT_STATUS: Record<string, string> = {
  assigned: "picked_up",
  picked_up: "in_transit",
  in_transit: "delivered",
};

const NEXT_BUTTON_LABEL: Record<string, string> = {
  assigned: "✅  Mark Picked Up",
  picked_up: "🚛  Mark In Transit",
  in_transit: "📦  Mark Delivered",
};

function shortId(id: string) {
  return "#" + id.slice(0, 6).toUpperCase();
}

export default function OrderDetailScreen({ route, navigation }: Props) {
  const { orderId } = route.params;
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const [toastMessage, setToastMessage] = useState("");

  const fetchOrder = useCallback(async () => {
    const { data, error } = await supabase
      .from("orders")
      .select(
        "id, pickup_address, delivery_address, goods_desc, weight_tons, notes, status, created_at",
      )
      .eq("id", orderId)
      .single();

    if (error) {
      Alert.alert("Error", "Could not load order details.");
    } else if (data) {
      setOrder(data);
    }
    setLoading(false);
  }, [orderId]);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  // Update header title once order is loaded
  useEffect(() => {
    if (order) {
      navigation.setOptions({ title: `ORDER ${shortId(order.id)}` });
    }
  }, [order, navigation]);

  function showToast(msg: string) {
    setToastMessage(msg);
    toastOpacity.setValue(0);
    Animated.sequence([
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.delay(1800),
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();
  }

  async function handleAdvanceStatus() {
    if (!order) return;
    const nextStatus = NEXT_STATUS[order.status];
    if (!nextStatus) return;

    setUpdating(true);
    const { error } = await supabase
      .from("orders")
      .update({ status: nextStatus })
      .eq("id", order.id);

    if (error) {
      Alert.alert("Error", "Could not update order status. Please try again.");
    } else {
      setOrder({ ...order, status: nextStatus });
      showToast("Status updated!");
    }
    setUpdating(false);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  if (!order) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Order not found.</Text>
      </View>
    );
  }

  const cfg = STATUS_CONFIG[order.status] ?? STATUS_CONFIG.pending;
  const nextButtonLabel = NEXT_BUTTON_LABEL[order.status];
  const isDelivered = order.status === "delivered";

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Status badge */}
        <View style={styles.statusRow}>
          <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
            <Text style={[styles.badgeText, { color: cfg.color }]}>
              {cfg.label}
            </Text>
          </View>
        </View>

        {/* Addresses */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Pickup</Text>
          <Text style={styles.sectionValue}>{order.pickup_address}</Text>
        </View>

        <View style={styles.divider} />

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Deliver to</Text>
          <Text style={styles.sectionValue}>{order.delivery_address}</Text>
        </View>

        <View style={styles.divider} />

        {/* Goods details */}
        <View style={styles.row}>
          <View style={styles.rowItem}>
            <Text style={styles.sectionLabel}>Goods</Text>
            <Text style={styles.sectionValue}>{order.goods_desc ?? "—"}</Text>
          </View>
          <View style={styles.rowItem}>
            <Text style={styles.sectionLabel}>Weight</Text>
            <Text style={styles.sectionValue}>
              {order.weight_tons != null ? `${order.weight_tons} T` : "—"}
            </Text>
          </View>
        </View>

        {order.notes ? (
          <>
            <View style={styles.divider} />
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Notes</Text>
              <Text style={styles.sectionValue}>{order.notes}</Text>
            </View>
          </>
        ) : null}

        {/* Delivered confirmation */}
        {isDelivered && (
          <View style={styles.completedBanner}>
            <Text style={styles.completedText}>🎉 Order Complete</Text>
            <Text style={styles.completedSub}>
              This order has been delivered successfully.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Action button — hidden when delivered */}
      {!isDelivered && nextButtonLabel ? (
        <View style={styles.footer}>
          <TouchableOpacity
            style={[
              styles.actionButton,
              updating && styles.actionButtonDisabled,
            ]}
            onPress={handleAdvanceStatus}
            disabled={updating}
            activeOpacity={0.8}
          >
            {updating ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.actionButtonText}>{nextButtonLabel}</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Floating toast */}
      <Animated.View
        style={[styles.toast, { opacity: toastOpacity }]}
        pointerEvents="none"
      >
        <Text style={styles.toastText}>{toastMessage}</Text>
      </Animated.View>
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
  errorText: { fontSize: 16, color: "#94A3B8" },
  scrollContent: { padding: 24, paddingBottom: 40 },
  statusRow: { marginBottom: 24 },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  badgeText: { fontSize: 12, fontWeight: "700", letterSpacing: 0.6 },
  section: { paddingVertical: 4 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#94A3B8",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  sectionValue: { fontSize: 15, color: "#1E293B", lineHeight: 22 },
  divider: { height: 1, backgroundColor: "#E2E8F0", marginVertical: 16 },
  row: { flexDirection: "row", gap: 24, paddingVertical: 4 },
  rowItem: { flex: 1 },
  completedBanner: {
    marginTop: 32,
    backgroundColor: "#F0FDF4",
    borderRadius: 14,
    padding: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#BBF7D0",
  },
  completedText: {
    fontSize: 18,
    fontWeight: "700",
    color: "#15803D",
    marginBottom: 6,
  },
  completedSub: { fontSize: 14, color: "#166534", textAlign: "center" },
  footer: {
    padding: 20,
    paddingBottom: 28,
    backgroundColor: "#F8FAFC",
    borderTopWidth: 1,
    borderTopColor: "#E2E8F0",
  },
  actionButton: {
    backgroundColor: "#2563EB",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  actionButtonDisabled: { backgroundColor: "#93C5FD" },
  actionButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  toast: {
    position: "absolute",
    bottom: 100,
    alignSelf: "center",
    backgroundColor: "#1E293B",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
  },
  toastText: { color: "#fff", fontSize: 14, fontWeight: "500" },
});
