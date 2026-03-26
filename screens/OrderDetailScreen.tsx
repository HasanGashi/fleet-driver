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
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { supabase } from "../lib/supabase";
import { RootStackParamList } from "../types/navigation";
import {
  geocodeAddress,
  fetchTruckRoute,
  openTruckNav,
  formatDistance,
  formatDuration,
  RouteResult,
} from "../lib/navigation";

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
  assigned: "in_transit",
  in_transit: "delivered",
};

const NEXT_BUTTON_LABEL: Record<string, string> = {
  assigned: "✅  Mark Picked Up",
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

  // Navigation / routing state
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [pickupCoords, setPickupCoords] = useState<{
    lat: number;
    lon: number;
  } | null>(null);
  const [destCoords, setDestCoords] = useState<{
    lat: number;
    lon: number;
  } | null>(null);
  const [resolvedLabels, setResolvedLabels] = useState<{
    pickup: string;
    delivery: string;
  } | null>(null);
  const mapRef = useRef<MapView>(null);

  // Which coords to show on the map / deep-link based on current status:
  // assigned  → go to pickup first
  // picked_up / in_transit → go to delivery
  const navCoords = order?.status === "assigned" ? pickupCoords : destCoords;

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

  const loadRoute = useCallback(
    async (pickupAddress: string, deliveryAddress: string, status: string) => {
      if (status === "delivered") return;
      setRouteLoading(true);
      try {
        const [originCoords, destCoords] = await Promise.all([
          geocodeAddress(pickupAddress),
          geocodeAddress(deliveryAddress),
        ]);

        if (!destCoords) {
          showToast("Could not get coordinates for the delivery address");
          setRouteLoading(false);
          return;
        }
        if (originCoords) setPickupCoords(originCoords);
        setDestCoords(destCoords);
        setResolvedLabels({
          pickup: originCoords?.title ?? pickupAddress,
          delivery: destCoords.title,
        });
        console.log("[loadRoute] pickup resolved:", originCoords?.title);
        console.log("[loadRoute] delivery resolved:", destCoords.title);

        // Use pickup address as origin; fall back to delivery coords if pickup geocoding fails
        const origin = originCoords ?? destCoords;

        const result = await fetchTruckRoute(
          origin.lat,
          origin.lon,
          destCoords.lat,
          destCoords.lon,
        );
        if (!result) {
          showToast("Could not compute truck route — check your connection");
        } else {
          setRouteResult(result);
        }
      } catch (err) {
        console.error("[loadRoute] error:", err);
        showToast("Could not compute truck route — check your connection");
      }
      setRouteLoading(false);
    },
    [],
  );

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  // Load truck route once order is available
  useEffect(() => {
    if (order) {
      loadRoute(order.pickup_address, order.delivery_address, order.status);
    }
  }, [order?.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

        {/* Truck route map preview */}
        {!isDelivered && (
          <View style={styles.mapContainer}>
            {routeLoading ? (
              <View style={styles.mapPlaceholder}>
                <ActivityIndicator size="small" color="#2563EB" />
                <Text style={styles.mapLoadingText}>
                  Computing truck route…
                </Text>
              </View>
            ) : routeResult && navCoords ? (
              <>
                {/* Contextual heading — tells driver where to go next */}
                <View
                  style={[
                    styles.navHeading,
                    order?.status === "assigned"
                      ? styles.navHeadingPickup
                      : styles.navHeadingDelivery,
                  ]}
                >
                  <Text style={styles.navHeadingText}>
                    {order?.status === "assigned"
                      ? "📍 Go to Pickup"
                      : "📦 Go to Delivery"}
                  </Text>
                </View>

                {/* Stats row */}
                <View style={styles.routeSummary}>
                  <Text style={styles.routeSummaryDist}>
                    {formatDistance(routeResult.distanceMeters)}
                  </Text>
                  <Text style={styles.routeSummaryDot}>·</Text>
                  <Text style={styles.routeSummaryEta}>
                    est. {formatDuration(routeResult.durationSeconds)}
                  </Text>
                </View>

                {/* Resolved address labels so driver can spot geocoding mistakes */}
                {resolvedLabels && (
                  <View style={styles.resolvedLabels}>
                    <Text style={styles.resolvedLabelRow} numberOfLines={1}>
                      <Text style={styles.resolvedLabelKey}>From </Text>
                      {resolvedLabels.pickup}
                    </Text>
                    <Text style={styles.resolvedLabelRow} numberOfLines={1}>
                      <Text style={styles.resolvedLabelKey}>To    </Text>
                      {resolvedLabels.delivery}
                    </Text>
                  </View>
                )}

                {/* Pin map — shows pickup when assigned, delivery otherwise */}
                <MapView
                  ref={mapRef}
                  style={styles.map}
                  provider={PROVIDER_DEFAULT}
                  region={{
                    latitude: navCoords.lat,
                    longitude: navCoords.lon,
                    latitudeDelta: 0.05,
                    longitudeDelta: 0.05,
                  }}
                  scrollEnabled
                  zoomEnabled
                  pitchEnabled={false}
                  rotateEnabled={false}
                >
                  <Marker
                    coordinate={{
                      latitude: navCoords.lat,
                      longitude: navCoords.lon,
                    }}
                    pinColor={
                      order?.status === "assigned" ? "#F59E0B" : "#2563EB"
                    }
                  />
                </MapView>
              </>
            ) : null}

            {/* Navigation buttons */}
            {navCoords && !routeLoading && (
              <View style={styles.navButtons}>
                <TouchableOpacity
                  style={styles.navButton}
                  onPress={() =>
                    openTruckNav(navCoords.lat, navCoords.lon, "sygic")
                  }
                  activeOpacity={0.8}
                >
                  <Text style={styles.navButtonText}>
                    🚛 Navigate (Sygic Truck)
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.navButton, styles.navButtonSecondary]}
                  onPress={() =>
                    openTruckNav(navCoords.lat, navCoords.lon, "tomtom")
                  }
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.navButtonText,
                      styles.navButtonTextSecondary,
                    ]}
                  >
                    🚛 Navigate (TomTom GO Truck)
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

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
  // Route map
  mapContainer: {
    marginTop: 16,
    marginBottom: 8,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  map: { width: "100%", height: 280 },
  mapPlaceholder: {
    height: 200,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#F1F5F9",
    gap: 8,
  },
  mapLoadingText: { fontSize: 13, color: "#64748B" },
  routeSummary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#EFF6FF",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#BFDBFE",
  },
  routeSummaryDist: { fontSize: 15, fontWeight: "700", color: "#1D4ED8" },
  routeSummaryDot: { fontSize: 15, color: "#93C5FD" },
  routeSummaryEta: { fontSize: 15, fontWeight: "500", color: "#1E40AF" },
  navButtons: { gap: 8, padding: 12, backgroundColor: "#F8FAFC" },
  navHeading: {
    paddingVertical: 8,
    alignItems: "center" as const,
  },
  navHeadingPickup: { backgroundColor: "#FFFBEB" },
  navHeadingDelivery: { backgroundColor: "#EFF6FF" },
  navHeadingText: {
    fontSize: 13,
    fontWeight: "700" as const,
    letterSpacing: 0.3,
  },
  resolvedLabels: {
    backgroundColor: "#FFFBEB",
    borderBottomWidth: 1,
    borderBottomColor: "#FDE68A",
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 2,
  },
  resolvedLabelRow: { fontSize: 11, color: "#92400E" },
  resolvedLabelKey: { fontWeight: "700", color: "#B45309" },
  navButton: {
    backgroundColor: "#2563EB",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  navButtonSecondary: {
    backgroundColor: "#F1F5F9",
    borderWidth: 1,
    borderColor: "#CBD5E1",
  },
  navButtonText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  navButtonTextSecondary: { color: "#1E293B" },
});
