import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Platform,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useState, useEffect, useMemo, useRef } from "react";
import { api } from "../../../lib/api";
import { useAuth } from "../../../stores/auth";
import { getPendingSyncCount, syncAll } from "../../../lib/offline";
import { useNetworkStatus } from "../../../lib/nativeNetwork";
import { useHeaderTop } from "../../../lib/safeArea";

function greeting(firstName?: string) {
  const h = new Date().getHours();
  const word = h < 12 ? "Good Morning" : h < 17 ? "Good Afternoon" : "Good Evening";
  return `${word}${firstName ? `, ${firstName}` : ""}`;
}

const STAT_CARDS = [
  { key: "total_branches", label: "Branches", icon: "🏢", tint: "#2563eb", bg: "#eff6ff" },
  { key: "total_checklists", label: "Total Visits", icon: "📋", tint: "#7c3aed", bg: "#f5f3ff" },
  { key: "completed_checklists", label: "Completed", icon: "✅", tint: "#059669", bg: "#ecfdf5" },
  { key: "pending_checklists", label: "Pending", icon: "⏳", tint: "#d97706", bg: "#fffbeb" },
] as const;

export default function HomeScreen() {
  const { width: SCREEN_WIDTH } = useWindowDimensions();
  // 2 columns if width >= 360, else 1 column (with comfortable min width ~150px)
  const cols = SCREEN_WIDTH >= 360 ? 2 : 1;
  const cardBasis = cols === 2 ? "48%" : "100%";
  const cardGap = 10;

  const { user } = useAuth();
  const router = useRouter();
  const network = useNetworkStatus();
  const headerTop = useHeaderTop();
  const [pendingSync, setPendingSync] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const {
    data: stats,
    isLoading: statsLoading,
    refetch: refetchStats,
  } = useQuery({
    queryKey: ["mobile-summary"],
    queryFn: async () => (await api.get("/dashboard/mobile-summary")).data,
  });

  const {
    data: branches,
    isLoading: branchesLoading,
    isError,
    refetch: refetchBranches,
    isRefetching,
  } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => (await api.get("/branches")).data,
  });

  const { data: notifications, refetch: refetchNotifications } = useQuery({
    queryKey: ["my-notifications"],
    queryFn: async () => (await api.get("/dashboard/notifications")).data,
  });

  const unreadRejections = (notifications ?? []).filter(
    (n: any) => !n.is_read && n.type === "PHOTO_REJECTED"
  );

  const refreshAll = () => {
    refetchBranches();
    refetchStats();
    refetchNotifications();
    getPendingSyncCount().then(setPendingSync).catch(() => {});
  };

  const handleQuickSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      await syncAll();
      refreshAll();
    } catch {
      // handled
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    getPendingSyncCount()
      .then(setPendingSync)
      .catch(() => setPendingSync(0));
  }, []);

  // Auto-sync whenever connectivity returns and items are pending
  const wasOffline = useRef(false);
  useEffect(() => {
    if (!network.isConnected) {
      wasOffline.current = true;
      return;
    }
    if (wasOffline.current && pendingSync > 0 && !isSyncing) {
      wasOffline.current = false;
      handleQuickSync();
    }
  }, [network.isConnected, pendingSync, isSyncing]);

  const filteredBranches = useMemo(() => {
    if (!branches) return [];
    if (!searchQuery.trim()) return branches;
    const q = searchQuery.toLowerCase();
    return branches.filter((b: any) =>
      b.name?.toLowerCase().includes(q) ||
      b.code?.toLowerCase().includes(q) ||
      b.city?.toLowerCase().includes(q) ||
      b.state?.toLowerCase().includes(q)
    );
  }, [branches, searchQuery]);

  const loading = statsLoading || branchesLoading;

  if (loading && !branches) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={{ marginTop: 12, color: "#64748b", fontWeight: "600" }}>Loading Dashboard...</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Could not load branches</Text>
        <Text style={styles.errorHint}>Check that the backend server is reachable.</Text>
        <TouchableOpacity style={styles.retryButton} onPress={refreshAll}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refreshAll} />}
        data={filteredBranches}
        keyExtractor={(item: any) => item.id}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            {/* Executive Gradient Header */}
            <LinearGradient
              colors={["#1e3a8a", "#2563eb", "#3b82f6"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.hero, headerTop]}
            >
              <View style={styles.topRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={styles.heroGreeting} numberOfLines={1}>{greeting(user?.first_name)}</Text>
                  <View style={styles.heroSubRow}>
                    <Text style={styles.heroSub}>Branch Inspection & Compliance</Text>
                    {user?.roles?.[0]?.name ? (
                      <View style={styles.heroRolePill}>
                        <Text style={styles.heroRolePillText}>{user.roles[0].name.replace("_", " ")}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                <View style={styles.headerRight}>
                  {!network.isConnected && (
                    <View style={styles.offlineBadge}>
                      <Text style={styles.offlineBadgeText}>⚠ Offline</Text>
                    </View>
                  )}
                  <View style={styles.avatarCircle}>
                    <LinearGradient
                      colors={user?.first_name ? ["#3b82f6", "#38bdf8"] : ["#475569", "#64748b"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.avatarInner}
                    >
                      <Text style={styles.avatarText}>
                        {user?.first_name?.[0]}{user?.last_name?.[0]}
                      </Text>
                    </LinearGradient>
                  </View>
                </View>
              </View>

              {pendingSync > 0 && (
                <TouchableOpacity
                  style={styles.syncCard}
                  activeOpacity={0.8}
                  onPress={() => router.push("/pending-sync")}
                  disabled={isSyncing}
                >
                  <Text style={styles.syncCardText}>
                    {isSyncing ? "🔄 Syncing data with server..." : `🔄 ${pendingSync} item(s) pending sync · Open queue`}
                  </Text>
                </TouchableOpacity>
              )}

              {unreadRejections.length > 0 && (
                <TouchableOpacity
                  style={styles.rejectionAlertCard}
                  activeOpacity={0.85}
                  onPress={() => {
                    if (unreadRejections[0].entity_id) {
                      router.push(`/visit/${unreadRejections[0].entity_id}`);
                    } else {
                      router.push("/(app)/(tabs)/profile");
                    }
                  }}
                >
                  <Text style={styles.rejectionAlertTitle}>
                    🚨 Action Required: {unreadRejections.length} Photo Evidence Rejected
                  </Text>
                  <Text style={styles.rejectionAlertBody}>
                    {unreadRejections[0].body || "Reviewer reported a quality issue. Tap to review and retake."}
                  </Text>
                </TouchableOpacity>
              )}

{/* Stat Cards Grid */}
            <View style={styles.statsGrid}>
              {STAT_CARDS.map((c) => (
                <View key={c.key} style={[styles.statCard, { flexBasis: cardBasis }]}>
                    <View style={[styles.statIconBox, { backgroundColor: c.bg }]}>
                      <Text style={styles.statIcon}>{c.icon}</Text>
                    </View>
                    <Text style={[styles.statValue, { color: c.tint }]}>
                      {stats?.[c.key] ?? 0}
                    </Text>
                    <Text style={styles.statLabel}>{c.label}</Text>
                  </View>
                ))}
              </View>
            </LinearGradient>

            {/* Search and Section Header */}
            <View style={styles.searchSection}>
              <View style={styles.searchBox}>
                <Text style={styles.searchIcon}>🔍</Text>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search branch by name, code or city..."
                  placeholderTextColor="#94a3b8"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  clearButtonMode="while-editing"
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchQuery("")}>
                    <Text style={{ color: "#94a3b8", paddingHorizontal: 6 }}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.sectionRow}>
                <Text style={styles.sectionTitle}>All Branches</Text>
                <Text style={styles.sectionCount}>{filteredBranches.length} branch{filteredBranches.length === 1 ? "" : "es"}</Text>
                <View style={{ flex: 1 }} />
                <TouchableOpacity
                  style={styles.addBranchButton}
                  onPress={() => router.push({ pathname: "/branch/add" })}
                >
                  <Text style={styles.addBranchText}>＋ Add Branch</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        }
        renderItem={({ item }: { item: any }) => (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.8}
            onPress={() => router.push({ pathname: "/branch/[id]", params: { id: item.id } })}
          >
            <LinearGradient
              colors={["#eff6ff", "#dbeafe"]}
              style={styles.logoBox}
            >
              <Text style={styles.logoText}>🏢</Text>
            </LinearGradient>
            <View style={{ flex: 1 }}>
              <Text style={styles.branchName}>{item.name}</Text>
              <View style={styles.metaRow}>
                {item.code ? <Text style={styles.codeChip}>{item.code}</Text> : null}
                <Text style={styles.branchMeta}>
                  {[item.city, item.state].filter(Boolean).join(", ") || "Active Branch"}
                </Text>
              </View>
              {item.address ? (
                <Text style={styles.addressText} numberOfLines={1}>
                  📍 {item.address}
                </Text>
              ) : null}
            </View>
            <View style={styles.chevronCircle}>
              <Text style={styles.chevron}>›</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={{ fontSize: 32, marginBottom: 8 }}>🏢</Text>
            <Text style={styles.emptyText}>
              {searchQuery ? `No branches match "${searchQuery}"` : "No branches available."}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },

  hero: {
    paddingHorizontal: 18,
    paddingTop: Platform.OS === "ios" ? 54 : 36,
    paddingBottom: 28,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  heroSubRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 3,
  },
  heroGreeting: { color: "#fff", fontSize: 22, fontWeight: "800", letterSpacing: 0.2 },
  heroSub: { color: "#bfdbfe", fontSize: 13 },
  headerRight: { alignItems: "flex-end", gap: 8 },
  avatarCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.4)",
    overflow: "hidden",
  },
  avatarInner: { flex: 1, alignItems: "center", justifyContent: "center" },
  avatarText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  heroRolePill: {
    backgroundColor: "rgba(255,255,255,0.25)",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  heroRolePillText: { color: "#fff", fontSize: 10.5, fontWeight: "800", textTransform: "uppercase" },
  offlineBadge: {
    backgroundColor: "#f59e0b",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  offlineBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },

  syncCard: {
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  syncCardText: {
    color: "#fff",
    fontSize: 12.5,
    fontWeight: "700",
    textAlign: "center",
  },

  rejectionAlertCard: {
    backgroundColor: "#fff1f2",
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 14,
    borderWidth: 1.5,
    borderColor: "#f43f5e",
    shadowColor: "#f43f5e",
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 3,
  },
  rejectionAlertTitle: {
    color: "#9f1239",
    fontSize: 13,
    fontWeight: "800",
  },
  rejectionAlertBody: {
    color: "#be123c",
    fontSize: 11.5,
    marginTop: 3,
    lineHeight: 16,
  },

  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 18,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: "46%",
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 12,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 6,
    elevation: 3,
  },
  statIconBox: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  statIcon: { fontSize: 16 },
  statValue: { fontSize: 18, fontWeight: "800" },
  statLabel: { fontSize: 10.5, color: "#64748b", marginTop: 2, fontWeight: "600", textAlign: "center" },

  searchSection: {
    paddingHorizontal: 16,
    marginTop: 18,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#ffffff",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    shadowColor: "#000",
    shadowOpacity: 0.03,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 1,
  },
  searchIcon: { fontSize: 15, marginRight: 8 },
  searchInput: { flex: 1, fontSize: 14, color: "#0f172a" },

  sectionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 18,
    marginBottom: 8,
    paddingHorizontal: 4,
    gap: 8,
  },
  sectionTitle: { fontSize: 16, fontWeight: "800", color: "#0f172a" },
  sectionCount: { fontSize: 12, fontWeight: "600", color: "#64748b" },
  addBranchButton: {
    backgroundColor: "#eff6ff",
    borderColor: "#bfdbfe",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  addBranchText: { color: "#1d4ed8", fontSize: 13, fontWeight: "700" },

  card: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: "#f1f5f9",
    shadowColor: "#0f172a",
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  logoBox: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  logoText: { fontSize: 22 },
  branchName: { fontSize: 15.5, fontWeight: "700", color: "#0f172a" },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 4 },
  codeChip: {
    fontSize: 11,
    fontWeight: "700",
    color: "#2563eb",
    backgroundColor: "#eff6ff",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: "hidden",
  },
  branchMeta: { fontSize: 12.5, color: "#64748b" },
  addressText: { fontSize: 11.5, color: "#94a3b8", marginTop: 4 },
  chevronCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#f8fafc",
    alignItems: "center",
    justifyContent: "center",
  },
  chevron: { fontSize: 18, color: "#94a3b8", fontWeight: "700" },

  emptyState: { alignItems: "center", paddingVertical: 48 },
  emptyText: { color: "#64748b", fontSize: 14, fontWeight: "600" },
  errorTitle: { fontSize: 18, fontWeight: "700", color: "#0f172a" },
  errorHint: { fontSize: 13, color: "#64748b", marginTop: 4 },
  retryButton: {
    backgroundColor: "#2563eb",
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 16,
  },
  retryText: { color: "#fff", fontWeight: "700" },
});
