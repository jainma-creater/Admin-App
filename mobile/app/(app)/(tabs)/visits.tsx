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
import { api } from "../../../lib/api";
import { statusLabel, statusColor, DONE_STATUSES, EDITABLE_STATUSES } from "../../../lib/status";
import { useHeaderTop } from "../../../lib/safeArea";

// Simple 3-bucket filter: everything is In Progress, Submitted or Completed.
const FILTER_TABS = ["ALL", "IN_PROGRESS", "SUBMITTED", "DONE"] as const;

export default function VisitsScreen() {
  const router = useRouter();
  const headerTop = useHeaderTop();
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
        // Completed bucket also includes rejected visits so nothing disappears.
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
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={{ marginTop: 12, color: "#64748b", fontWeight: "600" }}>Loading Visits...</Text>
      </View>
    );
  }

  if (isError && !data) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Could not load your visits.</Text>
        <Text style={styles.emptyHint}>Check that the backend is running and reachable.</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, headerTop]}>
        <Text style={styles.heading}>Inspection Visits</Text>
        <Text style={styles.subheading}>
          Track your assigned inspections, progress and audit reports
        </Text>

        {/* Search */}
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Filter by branch name or date..."
            placeholderTextColor="#94a3b8"
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch("")}>
              <Text style={{ color: "#94a3b8", paddingHorizontal: 6 }}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Filter Tabs */}
        <View style={styles.tabsRow}>
          {FILTER_TABS.map((tab) => {
            const active = selectedFilter === tab;
            const label = tab === "ALL" ? "All" : tab === "IN_PROGRESS" ? "In Progress" : tab === "SUBMITTED" ? "Submitted" : "Completed";
            return (
              <TouchableOpacity
                key={tab}
                style={[styles.tabButton, active && styles.tabButtonActive]}
                onPress={() => setSelectedFilter(tab)}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <FlatList
        contentContainerStyle={{ paddingBottom: 32, paddingHorizontal: 16 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        data={filteredVisits}
        keyExtractor={(item: any) => item.id}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }: { item: any }) => {
          const isDone = DONE_STATUSES.includes(item.status);
          const total = item.total_items ?? 0;
          const completed = item.completed_items ?? 0;
          const pct = total ? Math.round((completed / total) * 100) : 0;

          return (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.8}
              onPress={() => router.push({ pathname: "/visit/[id]", params: { id: item.id } })}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.branchName}>{item.branch_name ?? "Branch"}</Text>
                <View
                  style={[
                    styles.badge,
                    { backgroundColor: statusColor(item.status) },
                  ]}
                >
                  <Text style={styles.badgeText}>{statusLabel(item.status)}</Text>
                </View>
              </View>

              <Text style={styles.meta}>
                {isDone
                  ? `Completed · ${item.submitted_at ? new Date(item.submitted_at).toLocaleDateString() : item.scheduled_date ?? "—"}`
                  : `📅 Visit date: ${item.scheduled_date ?? "No date"}`}
                {total > 0
                  ? ` · ${completed}/${total} items`
                  : item.photo_count
                  ? ` · 📷 ${item.photo_count} photos`
                  : ""}
              </Text>

              {/* Progress bar */}
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${pct}%`,
                      backgroundColor: isDone ? "#10b981" : "#3b82f6",
                    },
                  ]}
                />
              </View>

              <View style={styles.metaRow}>
                {item.compliance_percentage != null && (
                  <Text style={styles.chipGreen}>📊 {item.compliance_percentage}% Score</Text>
                )}
                <Text style={styles.chip}>📷 {item.photo_count ?? 0} photos</Text>
                {item.visit_type_name ? (
                  <Text style={styles.chip}>{item.visit_type_name}</Text>
                ) : null}
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={{ fontSize: 32, marginBottom: 8 }}>📋</Text>
            <Text style={styles.emptyText}>No visits found.</Text>
            <Text style={styles.emptyHint}>Start a new visit from the Home screen.</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  errorText: { color: "#ef4444", fontSize: 15, fontWeight: "700", textAlign: "center" },
  retryButton: {
    backgroundColor: "#2563eb",
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 10,
    marginTop: 14,
  },
  retryText: { color: "#fff", fontSize: 15, fontWeight: "700" },

  header: {
    paddingHorizontal: 16,
    paddingTop: Platform.OS === "ios" ? 54 : 36,
    paddingBottom: 14,
    backgroundColor: "#ffffff",
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  heading: { fontSize: 22, fontWeight: "800", color: "#0f172a" },
  subheading: { fontSize: 13, color: "#64748b", marginTop: 3, marginBottom: 12 },

  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f1f5f9",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 10 : 6,
    marginBottom: 12,
  },
  searchIcon: { fontSize: 14, marginRight: 6 },
  searchInput: { flex: 1, fontSize: 13.5, color: "#0f172a" },

  tabsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  tabButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: "#f1f5f9",
  },
  tabButtonActive: {
    backgroundColor: "#2563eb",
  },
  tabText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748b",
  },
  tabTextActive: {
    color: "#ffffff",
  },

  card: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#f1f5f9",
    shadowColor: "#0f172a",
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 5,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  branchName: { fontSize: 16, fontWeight: "700", color: "#0f172a", flex: 1 },
  badge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  meta: { fontSize: 13, color: "#64748b", marginTop: 6 },

  progressTrack: {
    height: 6,
    backgroundColor: "#f1f5f9",
    borderRadius: 3,
    marginTop: 10,
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 3 },

  metaRow: { flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" },
  chip: {
    fontSize: 11.5,
    fontWeight: "600",
    color: "#475569",
    backgroundColor: "#f1f5f9",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: "hidden",
  },
  chipGreen: {
    fontSize: 11.5,
    fontWeight: "700",
    color: "#047857",
    backgroundColor: "#ecfdf5",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: "hidden",
  },

  emptyState: { alignItems: "center", paddingVertical: 48 },
  emptyText: { color: "#334155", fontWeight: "700", fontSize: 15 },
  emptyHint: { color: "#94a3b8", fontSize: 13, marginTop: 4 },
});
