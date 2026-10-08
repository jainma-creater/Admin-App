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
import { api, API_URL, getErrorMessage } from "../../../lib/api";
import { useAuth } from "../../../stores/auth";
import { getPendingSyncCount, syncAll, clearSyncedData } from "../../../lib/offline";
import { useNetworkStatus } from "../../../lib/nativeNetwork";
import { useHeaderTop } from "../../../lib/safeArea";

export default function ProfileScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const network = useNetworkStatus();
  const headerTop = useHeaderTop();
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
        Alert.alert("Sync Complete ✅", `Successfully synced ${res.success} item(s) to server.`);
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
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={{ marginTop: 12, color: "#64748b", fontWeight: "600" }}>Loading Profile...</Text>
      </View>
    );
  }

  const initials = `${currentUser.first_name?.[0] || ""}${currentUser.last_name?.[0] || ""}` || "U";

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
{/* Header Profile Card */}
      <View style={[styles.header, headerTop]}>
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
      </View>

      {/* Review Feedback & Audit Notifications */}
      {(notifications ?? []).length > 0 && (
        <View style={styles.section}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <Text style={styles.sectionTitle}>Audit Alerts & Review Feedback</Text>
            <TouchableOpacity onPress={() => refetchNotifications()}>
              <Text style={{ fontSize: 12, color: "#2563eb", fontWeight: "600" }}>Refresh</Text>
            </TouchableOpacity>
          </View>

          <View style={{ gap: 10 }}>
            {(notifications ?? []).slice(0, 10).map((n: any) => {
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
                        <Text style={[styles.notifTitle, isRej && { color: "#9f1239" }]}>{n.title}</Text>
                        {!n.is_read && (
                          <View style={styles.unreadDot} />
                        )}
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
        <Text style={styles.sectionTitle}>Offline & Sync Status</Text>

        <View style={styles.statusRow}>
          <Text style={styles.infoLabel}>Network Status</Text>
          <View style={[styles.networkPill, { backgroundColor: network.isConnected ? "#ecfdf5" : "#fef2f2" }]}>
            <Text style={[styles.networkPillText, { color: network.isConnected ? "#059669" : "#dc2626" }]}>
              {network.isConnected ? "● Online (Connected)" : "● Offline Mode"}
            </Text>
          </View>
        </View>

        <View style={styles.statusRow}>
          <Text style={styles.infoLabel}>Unsynced Local Queue</Text>
          <Text style={[styles.infoValue, { color: pendingCount > 0 ? "#d97706" : "#059669", fontWeight: "700" }]}>
            {pendingCount} item(s) pending
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.syncButton, (!network.isConnected || isSyncing) && styles.syncButtonDisabled]}
          onPress={handleSyncNow}
          disabled={!network.isConnected || isSyncing}
        >
          {isSyncing ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Text style={styles.syncButtonText}>🔄 Sync Now with Server</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.clearCacheButton} onPress={handleClearCache}>
          <Text style={styles.clearCacheText}>🧹 Clean Synced Local Storage</Text>
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
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Server Endpoint</Text>
          <Text style={[styles.infoValue, { fontSize: 12 }]} numberOfLines={1}>
            {API_URL}
          </Text>
        </View>
      </View>

      {/* App & Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Application</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>App Version</Text>
          <Text style={styles.infoValue}>1.0.0 (Production Release)</Text>
        </View>
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>🚪 Sign Out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc", paddingHorizontal: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },

header: {
    alignItems: "center",
    marginBottom: 20,
    backgroundColor: "#ffffff",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "#f1f5f9",
    shadowColor: "#0f172a",
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
  },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: "#2563eb",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
    shadowColor: "#2563eb",
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 4,
  },
  avatarText: { color: "#fff", fontSize: 26, fontWeight: "800" },
  name: { fontSize: 20, fontWeight: "800", color: "#0f172a" },
  email: { fontSize: 13.5, color: "#64748b", marginTop: 3 },
  rolesContainer: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6, marginTop: 12 },
  roleBadge: { backgroundColor: "#eff6ff", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  roleBadgeText: { color: "#2563eb", fontSize: 11.5, fontWeight: "700" },

  section: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#f1f5f9",
    shadowColor: "#0f172a",
    shadowOpacity: 0.03,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: "#334155",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f8fafc",
  },
  networkPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  networkPillText: { fontSize: 12, fontWeight: "700" },

  syncButton: {
    backgroundColor: "#2563eb",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 14,
  },
  syncButtonDisabled: { opacity: 0.6 },
  syncButtonText: { color: "#fff", fontWeight: "700", fontSize: 14.5 },

  clearCacheButton: {
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 6,
  },
  clearCacheText: { color: "#64748b", fontSize: 12.5, fontWeight: "600" },

  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: "#f8fafc",
  },
  infoLabel: { fontSize: 13.5, color: "#64748b" },
  infoValue: { fontSize: 13.5, fontWeight: "600", color: "#0f172a", textAlign: "right", flex: 1, marginLeft: 16 },

  logoutButton: {
    backgroundColor: "#fef2f2",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  logoutText: { color: "#dc2626", fontWeight: "700", fontSize: 15 },

  notifCard: {
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  notifCardRejected: {
    backgroundColor: "#fff1f2",
    borderColor: "#fecdd3",
  },
  notifCardRead: {
    opacity: 0.65,
  },
  notifTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#0f172a",
    flex: 1,
  },
  notifBody: {
    fontSize: 12,
    color: "#475569",
    marginTop: 3,
    lineHeight: 17,
  },
  notifAction: {
    fontSize: 11.5,
    fontWeight: "700",
    color: "#2563eb",
    marginTop: 6,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#ef4444",
    marginLeft: 6,
  },
});
