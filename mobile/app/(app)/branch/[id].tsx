import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useState } from "react";
import { api, getErrorMessage } from "../../../lib/api";
import { statusLabel, statusColor, EDITABLE_STATUSES, PRE_START_STATUSES } from "../../../lib/status";
import { useAuth } from "../../../stores/auth";
import { useHeaderTop } from "../../../lib/safeArea";

const TYPE_ICONS: Record<string, string> = {
  "Branch Visit": "📋",
  "Regional Admin Visit": "🧾",
  "HR Visit": "👥",
  "HO Audit Visit": "🏦",
  "Compliance Audit Visit": "🛡️",
  "Fixed Asset Visit": "🛋️",
  "IT Asset Visit": "💻",
};

export default function BranchDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const headerTop = useHeaderTop();
  const [pickerOpen, setPickerOpen] = useState(false);

  const { data: branch, isLoading: branchLoading } = useQuery({
    queryKey: ["branch", id],
    queryFn: async () => (await api.get(`/branches/${id}`)).data,
  });

  const { data: visitTypes } = useQuery({
    queryKey: ["visit-types"],
    queryFn: async () => (await api.get("/checklists/visit-types")).data,
    enabled: pickerOpen || true,
  });

  const {
    data: myVisits,
    isLoading: visitsLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["branch-my-visits", id],
    queryFn: async () => {
      const all = (await api.get("/visits/my")).data;
      return (all ?? []).filter((v: any) => v.branch_id === id);
    },
  });

  const startMut = useMutation({
    mutationFn: async (visitTypeId: string) => {
      const payload = {
        branch_id: id,
        visit_type_id: visitTypeId,
        visitor_ids: [user?.id],
        scheduled_date: new Date().toISOString().slice(0, 10),
      };
      const created = (await api.post("/visits", payload)).data;
      if (PRE_START_STATUSES.includes(created.status)) {
        try {
          await api.post(`/visits/${created.id}/start`);
        } catch {
          /* keep created state if start not allowed */
        }
      }
      return created;
    },
    onSuccess: (created: any) => {
      setPickerOpen(false);
      qc.invalidateQueries({ queryKey: ["branch-my-visits", id] });
      qc.invalidateQueries({ queryKey: ["visits"] });
      qc.invalidateQueries({ queryKey: ["mobile-summary"] });
      // Replace (not push): the branch screen stays one step below, so Back
      // from the visit returns here — never to Home unexpectedly.
      router.replace({ pathname: "/visit/[id]", params: { id: created.id } });
    },
    onError: async (e: any) =>
      Alert.alert("Could not start visit", await getErrorMessage(e)),
  });

  if (branchLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        data={myVisits ?? []}
        keyExtractor={(item: any) => item.id}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <>
            <TouchableOpacity style={[styles.backRow, headerTop]} onPress={() => router.back()}>
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>

            {/* Gradient branch header */}
            <LinearGradient
              colors={["#1e3a8a", "#2563eb"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.headerCard}
            >
              <View style={styles.headerLogoBox}>
                <Text style={{ fontSize: 28 }}>🏢</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.branchName}>{branch?.name ?? "Branch"}</Text>
                <Text style={styles.branchMeta}>
                  {branch?.code ? `${branch.code} · ` : ""}
                  {[branch?.city, branch?.state].filter(Boolean).join(", ")}
                </Text>
                {branch?.address ? (
                  <Text style={styles.branchAddr} numberOfLines={1}>
                    📍 {branch.address}
                  </Text>
                ) : null}
              </View>
            </LinearGradient>

            <TouchableOpacity
              style={styles.startButton}
              activeOpacity={0.85}
              onPress={() => setPickerOpen(true)}
            >
              <Text style={styles.startButtonText}>＋ Start New Visit</Text>
              <Text style={styles.startButtonHint}>
                Choose the checklist that matches your role
              </Text>
            </TouchableOpacity>

            <Text style={styles.sectionTitle}>Your visits at this branch</Text>
          </>
        }
        renderItem={({ item }: { item: any }) => {
          const pct = item.total_items
            ? Math.round((item.completed_items / item.total_items) * 100)
            : 0;
          return (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.8}
              onPress={() => router.push(`/visit/${item.id}`)}
            >
              <View style={{ flex: 1 }}>
                <View style={styles.cardTopRow}>
                  <Text style={styles.cardTitle}>
                    {item.visit_type_name ?? "Visit"}
                  </Text>
                  <View
                    style={[
                      styles.badge,
                      { backgroundColor: statusColor(item.status) },
                    ]}
                  >
                    <Text style={styles.badgeText}>{statusLabel(item.status)}</Text>
                  </View>
                </View>
                <Text style={styles.cardMeta}>
                  {item.scheduled_date ?? "No date"}
                  {item.total_items > 0 ? ` · ${item.completed_items}/${item.total_items} items` : ""}
                  {item.photo_count ? ` · 📷 ${item.photo_count}` : ""}
                </Text>
                <View style={styles.miniTrack}>
                  <View style={[styles.miniFill, { width: `${pct}%` }]} />
                </View>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          visitsLoading ? (
            <ActivityIndicator color="#2563eb" style={{ marginTop: 24 }} />
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>
                No visits at this branch yet —{"\n"}tap “Start New Visit” above.
              </Text>
            </View>
          )
        }
      />

      {/* Role checklist picker */}
      <Modal visible={pickerOpen} transparent animationType="slide">
        <View style={styles.pickerOverlay}>
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHandle} />
            <Text style={styles.pickerTitle}>Select checklist type</Text>
            <Text style={styles.pickerSub}>Which inspection are you doing today?</Text>

            {(visitTypes ?? [])
              .filter((vt: any) => vt.allowed !== false)
              .map((vt: any) => (
              <TouchableOpacity
                key={vt.id}
                style={styles.typeCard}
                activeOpacity={0.8}
                disabled={startMut.isPending}
                onPress={() => startMut.mutate(vt.id)}
              >
                <View style={styles.typeIconBox}>
                  <Text style={{ fontSize: 20 }}>{TYPE_ICONS[vt.name] ?? "📋"}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.typeName}>
                    {vt.name.replace(" Visit", "")} Checklist
                  </Text>
                  <Text style={styles.typeSub} numberOfLines={1}>
                    Start inspection now
                  </Text>
                </View>
                <Text style={styles.typeChevron}>›</Text>
              </TouchableOpacity>
            ))}

            {startMut.isPending && (
              <View style={{ alignItems: "center", marginTop: 12 }}>
                <ActivityIndicator color="#2563eb" />
                <Text style={styles.creatingText}>Creating visit…</Text>
              </View>
            )}

            <TouchableOpacity style={styles.pickerCancel} onPress={() => setPickerOpen(false)}>
              <Text style={styles.pickerCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f1f5f9" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  backRow: { paddingTop: 12, paddingHorizontal: 16 },
  backText: { color: "#2563eb", fontSize: 15, fontWeight: "600" },

  headerCard: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 20,
    padding: 18,
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
  },
  headerLogoBox: {
    width: 54,
    height: 54,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  branchName: { color: "#fff", fontSize: 20, fontWeight: "800" },
  branchMeta: { color: "#bfdbfe", fontSize: 13, marginTop: 2 },
  branchAddr: { color: "#93c5fd", fontSize: 12, marginTop: 2 },

  startButton: {
    backgroundColor: "#10b981",
    borderRadius: 16,
    paddingVertical: 16,
    marginTop: 14,
    marginHorizontal: 16,
    alignItems: "center",
    shadowColor: "#10b981",
    shadowOpacity: 0.35,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    elevation: 5,
  },
  startButtonText: { color: "#fff", fontSize: 17, fontWeight: "800" },
  startButtonHint: { color: "#d1fae5", fontSize: 12, marginTop: 2 },

  sectionTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#334155",
    marginTop: 24,
    marginBottom: 4,
    paddingHorizontal: 16,
  },

  card: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    marginTop: 10,
    marginHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    shadowColor: "#0f172a",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 5,
    elevation: 2,
  },
  cardTopRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: "700", color: "#0f172a", flex: 1 },
  cardMeta: { fontSize: 12.5, color: "#64748b", marginTop: 3 },
  miniTrack: {
    height: 5,
    backgroundColor: "#e2e8f0",
    borderRadius: 3,
    marginTop: 8,
    overflow: "hidden",
  },
  miniFill: { height: "100%", backgroundColor: "#10b981", borderRadius: 3 },
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  badgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  chevron: { fontSize: 20, color: "#cbd5e1", fontWeight: "700" },

  emptyState: { alignItems: "center", paddingVertical: 30 },
  emptyText: { color: "#64748b", textAlign: "center", fontSize: 13.5, lineHeight: 20 },

  // Picker
  pickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.5)",
    justifyContent: "flex-end",
  },
  pickerSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 28,
  },
  pickerHandle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#e2e8f0",
    marginBottom: 14,
  },
  pickerTitle: { fontSize: 18, fontWeight: "800", color: "#0f172a" },
  pickerSub: { fontSize: 13, color: "#64748b", marginTop: 2, marginBottom: 14 },
  typeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#f8fafc",
    borderRadius: 14,
    padding: 14,
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#eef2f7",
  },
  typeIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#eff6ff",
    alignItems: "center",
    justifyContent: "center",
  },
  typeName: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
  typeSub: { fontSize: 12, color: "#94a3b8", marginTop: 2 },
  typeChevron: { fontSize: 20, color: "#cbd5e1", fontWeight: "700" },
  creatingText: { color: "#64748b", fontSize: 12, marginTop: 6 },
  pickerCancel: {
    marginTop: 14,
    paddingVertical: 12,
    alignItems: "center",
  },
  pickerCancelText: { color: "#64748b", fontWeight: "600", fontSize: 15 },
});
