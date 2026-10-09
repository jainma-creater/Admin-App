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
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { useState, useEffect, useMemo, useRef } from "react";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../../lib/api";
import { useAuth } from "../../../stores/auth";
import { getPendingSyncCount, syncAll } from "../../../lib/offline";
import { useNetworkStatus } from "../../../lib/nativeNetwork";
import { useHeaderTop } from "../../../lib/safeArea";
import { useResponsive } from "../../../lib/theme";
import { colors, radius, spacing, type, shadows, typography } from "../../../lib/theme";

function greeting(firstName?: string) {
  const h = new Date().getHours();
  const word = h < 12 ? "Good Morning" : h < 17 ? "Good Afternoon" : "Good Evening";
  return `${word}${firstName ? `, ${firstName}` : ""}`;
}

const STAT_CARDS = [
  { key: "total_branches", label: "Branches", icon: "🏢", tint: colors.brand },
  { key: "total_checklists", label: "Total Visits", icon: "📋", tint: "#7C3AED" },
  { key: "completed_checklists", label: "Completed", icon: "✅", tint: colors.success },
  { key: "pending_checklists", label: "Pending", icon: "⏳", tint: colors.warning },
] as const;

export default function HomeScreen() {
  const { isSmall, isTablet } = useResponsive();
  const { user } = useAuth();
  const router = useRouter();
  const network = useNetworkStatus();
  const headerTop = useHeaderTop();
  const [pendingSync, setPendingSync] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const statCols = isTablet ? 4 : 2;
  const statBasis = isTablet ? "23%" : isSmall ? "47%" : "47%";

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
        <ActivityIndicator size="large" color={colors.brand} />
        <Text style={styles.loadingText}>Loading Dashboard...</Text>
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
      <StatusBar style="light" />
      <FlatList
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refreshAll} tintColor={colors.brand} />
        }
        data={filteredBranches}
        keyExtractor={(item: any) => item.id}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            <LinearGradient
              colors={["#1E40AF", "#2563EB", "#3B82F6"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.hero, headerTop]}
            >
              <View style={styles.topRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={styles.heroGreeting} numberOfLines={1}>
                    {greeting(user?.first_name)}
                  </Text>
                  <View style={styles.heroSubRow}>
                    <Text style={styles.heroSub}>Branch Inspection &amp; Compliance</Text>
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
                      colors={user?.first_name ? ["#3B82F6", "#38BDF8"] : ["#475569", "#64748B"]}
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
                  <Ionicons name={isSyncing ? "sync" : "cloud-upload-outline"} size={16} color="#fff" />
                  <Text style={styles.syncCardText}>
                    {isSyncing
                      ? "Syncing data with server..."
                      : `${pendingSync} item(s) pending sync · Open queue`}
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
                    Action Required: {unreadRejections.length} Photo Evidence Rejected
                  </Text>
                  <Text style={styles.rejectionAlertBody}>
                    {unreadRejections[0].body || "Reviewer reported a quality issue. Tap to review and retake."}
                  </Text>
                </TouchableOpacity>
              )}

              {/* Stat Cards Grid */}
              <View style={styles.statsGrid}>
                {STAT_CARDS.map((c) => (
                  <View key={c.key} style={[styles.statCard, { width: statBasis }]}>
                    <View style={styles.statTop}>
                      <Text style={styles.statIcon}>{c.icon}</Text>
                      <View style={[styles.statAccent, { backgroundColor: c.tint }]} />
                    </View>
                    <Text style={[styles.statValue, { color: c.tint }]}>{stats?.[c.key] ?? 0}</Text>
                    <Text style={styles.statLabel} numberOfLines={2}>{c.label}</Text>
                  </View>
                ))}
              </View>
            </LinearGradient>

            <View style={[styles.searchSection, isTablet && { paddingHorizontal: spacing.xxl }]}>
              <View style={styles.searchBox}>
                <Ionicons name="search" size={18} color={colors.textFaint} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search branch by name, code or city..."
                  placeholderTextColor={colors.textFaint}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  clearButtonMode="while-editing"
                />
                {searchQuery.length > 0 && Platform.OS !== "ios" && (
                  <TouchableOpacity onPress={() => setSearchQuery("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Ionicons name="close-circle" size={18} color={colors.textFaint} />
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.sectionRow}>
                <Text style={styles.sectionTitle}>All Branches</Text>
                <Text style={styles.sectionCount}>
                  {filteredBranches.length} branch{filteredBranches.length === 1 ? "" : "es"}
                </Text>
                <View style={{ flex: 1 }} />
                <TouchableOpacity
                  style={styles.addBranchButton}
                  onPress={() => router.push({ pathname: "/branch/add" })}
                  activeOpacity={0.85}
                >
                  <Ionicons name="add" size={16} color={colors.brandDark} />
                  <Text style={styles.addBranchText}>Add Branch</Text>
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
            <View style={styles.logoBox}>
              <Text style={styles.logoText}>🏢</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.branchName} numberOfLines={1}>{item.name}</Text>
              <View style={styles.metaRow}>
                {item.code ? <Text style={styles.codeChip}>{item.code}</Text> : null}
                <Text style={styles.branchMeta} numberOfLines={1}>
                  {[item.city, item.state].filter(Boolean).join(", ") || "Active Branch"}
                </Text>
              </View>
              {item.address ? (
                <View style={styles.addressRow}>
                  <Ionicons name="location-outline" size={12} color={colors.textFaint} />
                  <Text style={styles.addressText} numberOfLines={1}>{item.address}</Text>
                </View>
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={{ fontSize: 34, marginBottom: 8 }}>🏢</Text>
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
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: colors.bg },
  loadingText: { marginTop: 12, color: colors.textMuted, fontWeight: "600" },

  hero: {
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === "ios" ? 54 : 36,
    paddingBottom: spacing.xxl,
    borderBottomLeftRadius: radius.xxl,
    borderBottomRightRadius: radius.xxl,
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
  heroGreeting: { color: "#fff", fontSize: type.heading, fontWeight: "800", letterSpacing: 0.2 },
  heroSub: { color: "#DBEAFE", fontSize: type.label },
  headerRight: { alignItems: "flex-end", gap: 8 },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.45)",
    overflow: "hidden",
  },
  avatarInner: { flex: 1, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#fff", fontSize: 15, fontWeight: "800", textTransform: "uppercase" },
  heroRolePill: {
    backgroundColor: "rgba(255,255,255,0.22)",
    borderRadius: radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },
  heroRolePillText: { color: "#fff", fontSize: type.caption, fontWeight: "800", textTransform: "uppercase" },
  offlineBadge: {
    backgroundColor: colors.warning,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  offlineBadgeText: { color: "#fff", fontSize: type.small, fontWeight: "700" },

  syncCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  syncCardText: { color: "#fff", fontSize: type.label, fontWeight: "700", textAlign: "center" },

  rejectionAlertCard: {
    backgroundColor: colors.dangerSubtle,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 14,
    borderWidth: 1.5,
    borderColor: colors.danger,
  },
  rejectionAlertTitle: { color: "#9F1239", fontSize: type.label, fontWeight: "800" },
  rejectionAlertBody: { color: "#BE123C", fontSize: type.small, marginTop: 3, lineHeight: 16 },

  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: spacing.xl,
  },
  statCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.sm,
  },
  statTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  statIcon: { fontSize: 18 },
  statAccent: { width: 9, height: 9, borderRadius: 5 },
  statValue: { fontSize: 22, fontWeight: "800" },
  statLabel: { fontSize: type.caption, color: colors.textMuted, marginTop: 2, fontWeight: "600" },

  searchSection: { paddingHorizontal: spacing.lg, marginTop: spacing.xl },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "ios" ? 12 : 9,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.input,
  },
  searchInput: { flex: 1, fontSize: type.body, color: colors.text },

  sectionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
    paddingHorizontal: 4,
    gap: 8,
  },
  sectionTitle: { fontSize: type.subheading, fontWeight: "800", color: colors.text },
  sectionCount: { fontSize: type.small, fontWeight: "600", color: colors.textMuted },
  addBranchButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: colors.brandSubtle,
    borderColor: "#BFDBFE",
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  addBranchText: { color: colors.brandDark, fontSize: type.label, fontWeight: "700" },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.input,
  },
  logoBox: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandSubtle,
  },
  logoText: { fontSize: 22 },
  branchName: { fontSize: 15.5, fontWeight: "700", color: colors.text },
  metaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 4 },
  codeChip: {
    fontSize: type.small,
    fontWeight: "700",
    color: colors.brand,
    backgroundColor: colors.brandSubtle,
    borderRadius: radius.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: "hidden",
  },
  branchMeta: { fontSize: type.label, color: colors.textMuted },
  addressRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  addressText: { fontSize: type.small, color: colors.textFaint, flex: 1 },

  emptyState: { alignItems: "center", paddingVertical: 48 },
  emptyText: { color: colors.textMuted, fontSize: type.body, fontWeight: "600" },
  errorTitle: { fontSize: type.subheading, fontWeight: "700", color: colors.text },
  errorHint: { fontSize: type.label, color: colors.textMuted, marginTop: 4 },
  retryButton: {
    backgroundColor: colors.brand,
    borderRadius: radius.sm,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 16,
  },
  retryText: { color: "#fff", fontWeight: "700" },
});
