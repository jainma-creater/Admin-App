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
import { useState, useMemo } from "react";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../../lib/api";
import { statusLabel, statusColor, DONE_STATUSES, EDITABLE_STATUSES } from "../../../lib/status";
import { useHeaderTop } from "../../../lib/safeArea";
import { useResponsive } from "../../../lib/theme";
import { colors, radius, spacing, type, shadows, typography } from "../../../lib/theme";

// Simple 3-bucket filter: everything is In Progress, Submitted or Completed.
const FILTER_TABS = ["ALL", "IN_PROGRESS", "SUBMITTED", "DONE"] as const;

const TAB_LABELS: Record<string, string> = {
  ALL: "All",
  IN_PROGRESS: "In Progress",
  SUBMITTED: "Submitted",
  DONE: "Completed",
};

export default function VisitsScreen() {
  const router = useRouter();
  const headerTop = useHeaderTop();
  const { isTablet } = useResponsive();
  const [selectedFilter, setSelectedFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ["visits"],
    queryFn: async () => (await api.get("/visits/my")).data,
  });

  const filteredVisits = useMemo(() => {
    let list = [...(data ?? [])];

    if (selectedFilter !== "ALL") {
      if (selectedFilter === "DONE") {
        list = list.filter((v: any) => DONE_STATUSES.includes(v.status) || v.status === "REJECTED");
      } else if (selectedFilter === "IN_PROGRESS") {
        list = list.filter((v: any) => EDITABLE_STATUSES.includes(v.status));
      } else {
        list = list.filter((v: any) => v.status === selectedFilter);
      }
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((v: any) =>
        v.branch_name?.toLowerCase().includes(q) ||
        v.visit_type_name?.toLowerCase().includes(q) ||
        v.scheduled_date?.includes(q)
      );
    }

    return list.sort((a: any, b: any) => {
      if (a.status === "IN_PROGRESS" && b.status !== "IN_PROGRESS") return -1;
      if (b.status === "IN_PROGRESS" && a.status !== "IN_PROGRESS") return 1;
      return String(b.scheduled_date ?? "").localeCompare(String(a.scheduled_date ?? ""));
    });
  }, [data, selectedFilter, search]);

  if (isLoading && !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.brand} />
        <Text style={styles.loadingText}>Loading Visits...</Text>
      </View>
    );
  }

  if (isError && !data) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Could not load your visits.</Text>
        <Text style={styles.errorHint}>Check that the backend is running and reachable.</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={["#1E40AF", "#2563EB", "#3B82F6"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.header, headerTop]}
      >
        <Text style={styles.heading}>Inspection Visits</Text>
        <Text style={styles.subheading}>
          Track your assigned inspections, progress and audit reports
        </Text>

        <View style={styles.searchBox}>
          <Ionicons name="search" size={17} color={colors.textFaint} />
          <TextInput
            style={styles.searchInput}
            placeholder="Filter by branch name or date..."
            placeholderTextColor={colors.textFaint}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={17} color={colors.textFaint} />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.tabsRow}>
          {FILTER_TABS.map((tab) => {
            const active = selectedFilter === tab;
            return (
              <TouchableOpacity
                key={tab}
                style={[styles.tabButton, active && styles.tabButtonActive]}
                onPress={() => setSelectedFilter(tab)}
                activeOpacity={0.85}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {TAB_LABELS[tab]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </LinearGradient>

      <FlatList
        contentContainerStyle={{
          paddingBottom: 32,
          paddingHorizontal: isTablet ? spacing.xxl : spacing.lg,
        }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.brand} />
        }
        data={filteredVisits}
        keyExtractor={(item: any) => item.id}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }: { item: any }) => {
          const isDone = DONE_STATUSES.includes(item.status);
          const total = item.total_items ?? 0;
          const completed = item.completed_items ?? 0;
          const pct = total ? Math.round((completed / total) * 100) : 0;
          const tone = statusColor(item.status);

          return (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.85}
              onPress={() => router.push({ pathname: "/visit/[id]", params: { id: item.id } })}
            >
              <View style={styles.cardHeader}>
                <View style={styles.branchIcon}>
                  <Text style={{ fontSize: 18 }}>🏢</Text>
                </View>
                <Text style={styles.branchName} numberOfLines={1}>
                  {item.branch_name ?? "Branch"}
                </Text>
                <View style={[styles.badge, { backgroundColor: tone + "22" }]}>
                  <View style={[styles.badgeDot, { backgroundColor: tone }]} />
                  <Text style={[styles.badgeText, { color: tone }]}>
                    {statusLabel(item.status)}
                  </Text>
                </View>
              </View>

              <Text style={styles.meta}>
                {isDone
                  ? `Completed · ${
                      item.submitted_at
                        ? new Date(item.submitted_at).toLocaleDateString()
                        : item.scheduled_date ?? "—"
                    }`
                  : `Visit date: ${item.scheduled_date ?? "No date"}`}
                {total > 0
                  ? ` · ${completed}/${total} items`
                  : item.photo_count
                  ? ` · ${item.photo_count} photos`
                  : ""}
              </Text>

              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    { width: `${pct}%`, backgroundColor: isDone ? colors.success : colors.brand },
                  ]}
                />
              </View>

              <View style={styles.metaRow}>
                {item.compliance_percentage != null && (
                  <View style={styles.chipGreen}>
                    <Text style={styles.chipGreenText}>📊 {item.compliance_percentage}% Score</Text>
                  </View>
                )}
                <View style={styles.chip}>
                  <Text style={styles.chipText}>📷 {item.photo_count ?? 0} photos</Text>
                </View>
                {item.visit_type_name ? (
                  <View style={styles.chip}>
                    <Text style={styles.chipText}>{item.visit_type_name}</Text>
                  </View>
                ) : null}
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={{ fontSize: 34, marginBottom: 8 }}>📋</Text>
            <Text style={styles.emptyText}>No visits found.</Text>
            <Text style={styles.emptyHint}>
              {search || selectedFilter !== "ALL"
                ? "Try clearing the filter or search."
                : "Start a new visit from the Home screen."}
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
  errorText: { color: colors.danger, fontSize: type.body, fontWeight: "700", textAlign: "center" },
  errorHint: { color: colors.textFaint, fontSize: type.label, marginTop: 4, textAlign: "center" },
  retryButton: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingHorizontal: 28,
    paddingVertical: 10,
    marginTop: 14,
  },
  retryText: { color: "#fff", fontSize: type.body, fontWeight: "700" },

  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: Platform.OS === "ios" ? 54 : 36,
    paddingBottom: spacing.lg,
    borderBottomLeftRadius: radius.xxl,
    borderBottomRightRadius: radius.xxl,
  },
  heading: { fontSize: type.heading, fontWeight: "800", color: "#fff" },
  subheading: { fontSize: type.label, color: "#DBEAFE", marginTop: 3, marginBottom: 14 },

  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 11 : 8,
    marginBottom: 12,
  },
  searchInput: { flex: 1, fontSize: type.label, color: colors.text },

  tabsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tabButton: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  tabButtonActive: {
    backgroundColor: "#fff",
    borderColor: "#fff",
  },
  tabText: { fontSize: type.label, fontWeight: "700", color: "#fff" },
  tabTextActive: { color: colors.brandDark },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  branchIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.sm,
    backgroundColor: colors.brandSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  branchName: { fontSize: 15.5, fontWeight: "700", color: colors.text, flex: 1 },
  badge: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 4 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: type.small, fontWeight: "800" },
  meta: { fontSize: type.label, color: colors.textMuted, marginTop: 8 },

  progressTrack: {
    height: 6,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 3,
    marginTop: 10,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 3 },

  metaRow: { flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" },
  chip: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.xs,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  chipText: { fontSize: type.small, fontWeight: "600", color: "#475569" },
  chipGreen: {
    backgroundColor: colors.successSubtle,
    borderRadius: radius.xs,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  chipGreenText: { fontSize: type.small, fontWeight: "700", color: "#047857" },

  emptyState: { alignItems: "center", paddingVertical: 48 },
  emptyText: { color: "#334155", fontWeight: "700", fontSize: type.body },
  emptyHint: { color: colors.textFaint, fontSize: type.label, marginTop: 4, textAlign: "center" },
});
