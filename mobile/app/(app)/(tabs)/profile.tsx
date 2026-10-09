import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
  Platform,
} from "react-native";
import { useState, useEffect } from "react";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { api, API_URL, getErrorMessage } from "../../../lib/api";
import { useAuth } from "../../../stores/auth";
import { getPendingSyncCount, syncAll, clearSyncedData } from "../../../lib/offline";
import { useNetworkStatus } from "../../../lib/nativeNetwork";
import { useHeaderTop } from "../../../lib/safeArea";
import { useResponsive } from "../../../lib/theme";
import { colors, radius, spacing, type, shadows, typography } from "../../../lib/theme";

export default function ProfileScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const network = useNetworkStatus();
  const headerTop = useHeaderTop();
  const { isTablet } = useResponsive();
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  const { data: currentUser, isLoading } = useQuery({
    queryKey: ["user-me"],
    queryFn: async () => (await api.get("/users/me")).data,
  });

  const { data: notifications, refetch: refetchNotifications } = useQuery({
    queryKey: ["my-notifications"],
    queryFn: async () => (await api.get("/dashboard/notifications")).data,
  });

  const markRead = async (notifId: string, entityId?: string | null) => {
    try {
      await api.post(`/dashboard/notifications/${notifId}/read`);
      refetchNotifications();
    } catch {}
    if (entityId) {
      router.push(`/visit/${entityId}`);
    }
  };

  const refreshPendingCount = () => {
    getPendingSyncCount().then(setPendingCount).catch(() => setPendingCount(0));
  };

  useEffect(() => {
    refreshPendingCount();
  }, []);

  const handleSyncNow = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const res = await syncAll();
      refreshPendingCount();
      if (res.failed === 0) {
        Alert.alert("Sync Complete", `Successfully synced ${res.success} item(s) to server.`);
      } else {
        Alert.alert(
          "Sync Completed with Warnings",
          `Synced: ${res.success}, Failed: ${res.failed}\n\n${res.errors.slice(0, 3).join("\n")}`
        );
      }
    } catch (e: any) {
      Alert.alert("Sync Error", await getErrorMessage(e));
    } finally {
      setIsSyncing(false);
    }
  };

  const handleClearCache = async () => {
    Alert.alert("Clear Synced Cache", "This will clean up local data that has already been synced to the server.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clean Up",
        onPress: async () => {
          await clearSyncedData();
          refreshPendingCount();
          Alert.alert("Cleaned", "Synced local cache cleared successfully.");
        },
      },
    ]);
  };

  const handleLogout = async () => {
    Alert.alert("Logout", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout",
        style: "destructive",
        onPress: async () => {
          await logout();
          router.replace("/(auth)/login");
        },
      },
    ]);
  };

  if (isLoading || !currentUser) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brand} />
        <Text style={styles.loadingText}>Loading Profile...</Text>
      </View>
    );
  }

  const initials = `${currentUser.first_name?.[0] || ""}${currentUser.last_name?.[0] || ""}` || "U";
  const notifs = notifications ?? [];

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{
        paddingBottom: 40,
        paddingHorizontal: isTablet ? spacing.xxl : spacing.lg,
      }}
      showsVerticalScrollIndicator={false}
    >
      {/* Header Profile Card */}
      <LinearGradient
        colors={["#1E40AF", "#2563EB", "#3B82F6"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, headerTop]}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials}</Text>
        </View>
        <Text style={styles.name}>
          {currentUser.first_name} {currentUser.last_name}
        </Text>
        <Text style={styles.email}>{currentUser.email}</Text>

        <View style={styles.rolesContainer}>
          {currentUser.roles?.map((r: any) => (
            <View key={r.id} style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>{r.name}</Text>
            </View>
          ))}
        </View>
      </LinearGradient>

      {/* Review Feedback & Audit Notifications */}
      {notifs.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeadRow}>
            <Text style={styles.sectionTitle}>Audit Alerts &amp; Review Feedback</Text>
            <TouchableOpacity onPress={() => refetchNotifications()}>
              <Text style={styles.refreshText}>Refresh</Text>
            </TouchableOpacity>
          </View>

          <View style={{ gap: 10 }}>
            {notifs.slice(0, 10).map((n: any) => {
              const isRej = n.type === "PHOTO_REJECTED";
              return (
                <TouchableOpacity
                  key={n.id}
                  style={[
                    styles.notifCard,
                    isRej && styles.notifCardRejected,
                    n.is_read && styles.notifCardRead,
                  ]}
                  activeOpacity={0.8}
                  onPress={() => markRead(n.id, n.entity_id)}
                >
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                    <Text style={{ fontSize: 18 }}>{isRej ? "🚨" : "📢"}</Text>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                        <Text style={[styles.notifTitle, isRej && { color: "#9F1239" }]}>{n.title}</Text>
                        {!n.is_read && <View style={styles.unreadDot} />}
                      </View>
                      {n.body && <Text style={styles.notifBody}>{n.body}</Text>}
                      {n.entity_id && (
                        <Text style={styles.notifAction}>Tap to open visit and fix evidence ›</Text>
                      )}
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {/* Sync & Offline Status Card */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Offline &amp; Sync Status</Text>

        <View style={styles.statusRow}>
          <Text style={styles.infoLabel}>Network Status</Text>
          <View
            style={[
              styles.networkPill,
              { backgroundColor: network.isConnected ? colors.successSubtle : colors.dangerSubtle },
            ]}
          >
            <Text
              style={[styles.networkPillText, { color: network.isConnected ? "#059669" : "#DC2626" }]}
            >
              {network.isConnected ? "● Online (Connected)" : "● Offline Mode"}
            </Text>
          </View>
        </View>

        <View style={styles.statusRow}>
          <Text style={styles.infoLabel}>Unsynced Local Queue</Text>
          <Text
            style={[
              styles.infoValue,
              { color: pendingCount > 0 ? colors.warning : "#059669", fontWeight: "700" },
            ]}
          >
            {pendingCount} item(s) pending
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.syncButton, (!network.isConnected || isSyncing) && styles.syncButtonDisabled]}
          onPress={handleSyncNow}
          disabled={!network.isConnected || isSyncing}
          activeOpacity={0.9}
        >
          {isSyncing ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <>
              <Ionicons name="sync-outline" size={18} color="#fff" />
              <Text style={styles.syncButtonText}>Sync Now with Server</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.clearCacheButton} onPress={handleClearCache}>
          <Ionicons name="trash-outline" size={15} color={colors.textMuted} />
          <Text style={styles.clearCacheText}>Clean Synced Local Storage</Text>
        </TouchableOpacity>
      </View>

      {/* Organization Details */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Inspector Assignment</Text>
        {currentUser.region && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Region</Text>
            <Text style={styles.infoValue}>{currentUser.region.name}</Text>
          </View>
        )}
        {currentUser.area && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Area</Text>
            <Text style={styles.infoValue}>{currentUser.area.name}</Text>
          </View>
        )}
        {currentUser.branch && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Base Branch</Text>
            <Text style={styles.infoValue}>{currentUser.branch.name}</Text>
          </View>
        )}
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Phone</Text>
          <Text style={styles.infoValue}>{currentUser.phone || "Not configured"}</Text>
        </View>
        <View style={[styles.infoRow, styles.infoRowLast]}>
          <Text style={styles.infoLabel}>Server Endpoint</Text>
          <Text style={[styles.infoValue, { fontSize: 12 }]} numberOfLines={1}>
            {API_URL}
          </Text>
        </View>
      </View>

      {/* App & Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Application</Text>
        <View style={[styles.infoRow, styles.infoRowLast]}>
          <Text style={styles.infoLabel}>App Version</Text>
          <Text style={styles.infoValue}>1.0.0 (Production Release)</Text>
        </View>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout} activeOpacity={0.9}>
          <Ionicons name="log-out-outline" size={18} color="#DC2626" />
          <Text style={styles.logoutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: colors.bg },
  loadingText: { marginTop: 12, color: colors.textMuted, fontWeight: "600" },

  header: {
    alignItems: "center",
    marginBottom: spacing.lg,
    marginTop: spacing.lg,
    borderRadius: radius.xl,
    padding: spacing.xl,
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "rgba(255,255,255,0.22)",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.5)",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  avatarText: { color: "#fff", fontSize: 26, fontWeight: "800" },
  name: { fontSize: type.heading, fontWeight: "800", color: "#fff" },
  email: { fontSize: type.label, color: "#DBEAFE", marginTop: 3 },
  rolesContainer: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6, marginTop: 12 },
  roleBadge: {
    backgroundColor: "rgba(255,255,255,0.22)",
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  roleBadgeText: { color: "#fff", fontSize: type.small, fontWeight: "700", textTransform: "capitalize" },

  section: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  sectionHeadRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: type.label,
    fontWeight: "800",
    color: "#334155",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  refreshText: { fontSize: type.small, color: colors.brand, fontWeight: "600" },

  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceSubtle,
  },
  networkPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  networkPillText: { fontSize: type.small, fontWeight: "700" },

  syncButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: 14,
    marginTop: 14,
  },
  syncButtonDisabled: { opacity: 0.6 },
  syncButtonText: { color: "#fff", fontWeight: "700", fontSize: type.body },

  clearCacheButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    marginTop: 6,
  },
  clearCacheText: { color: colors.textMuted, fontSize: type.label, fontWeight: "600" },

  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceSubtle,
  },
  infoRowLast: { borderBottomWidth: 0 },
  infoLabel: { fontSize: type.label, color: colors.textMuted },
  infoValue: { fontSize: type.label, fontWeight: "600", color: colors.text, textAlign: "right", flex: 1, marginLeft: 16 },

  logoutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.dangerSubtle,
    borderRadius: radius.md,
    paddingVertical: 14,
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  logoutText: { color: "#DC2626", fontWeight: "700", fontSize: type.body },

  notifCard: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  notifCardRejected: { backgroundColor: "#FFF1F2", borderColor: "#FECDD3" },
  notifCardRead: { opacity: 0.65 },
  notifTitle: { fontSize: type.label, fontWeight: "700", color: colors.text, flex: 1 },
  notifBody: { fontSize: type.small, color: "#475569", marginTop: 3, lineHeight: 17 },
  notifAction: { fontSize: type.small, fontWeight: "700", color: colors.brand, marginTop: 6 },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger, marginLeft: 6 },
});
