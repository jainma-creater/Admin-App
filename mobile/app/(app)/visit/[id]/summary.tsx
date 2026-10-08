import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  FlatList,
} from "react-native";
import { useState, useCallback } from "react";
import { useFocusEffect } from "expo-router";
import { api, getErrorMessage, getPhotoUrl } from "../../../../lib/api";
import { getOfflinePhotos } from "../../../../lib/offline";

export default function VisitSummary() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();

  const { data: visit, isLoading, isError, refetch } = useQuery({
    queryKey: ["visit", id],
    queryFn: async () => (await api.get(`/visits/${id}`)).data,
  });

  const { data: checklist } = useQuery({
    queryKey: ["checklist", id],
    queryFn: async () => (await api.get(`/visits/${id}/checklist`)).data,
    enabled: !!visit?.visit_type_name && visit.visit_type_name !== "Fixed Asset Visit" && visit.visit_type_name !== "IT Asset Visit",
  });

  const isFixed = visit?.visit_type_name === "Fixed Asset Visit";
  const isIT = visit?.visit_type_name === "IT Asset Visit";

  const { data: moduleRows } = useQuery({
    queryKey: ["summary-module", id],
    queryFn: async () =>
      (await api.get(isIT ? `/visits/${id}/it-assets` : `/visits/${id}/assets`)).data,
    enabled: !!isFixed || !!isIT,
  });

  // Same cache key the checklist and camera screens use — after this unification
  // the summary sees photos uploaded during the visit without any extra fetch,
  // so "can submit" matches what the user actually did.
  const { data: photos } = useQuery({
    queryKey: ["visit-photos", id],
    queryFn: async () => (await api.get(`/visits/${id}/photos`)).data,
  });

  // Offline-queued photos count as evidence too (they'll auto-sync).
  const [offlinePhotos, setOfflinePhotos] = useState<any[]>([]);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      getOfflinePhotos(String(id))
        .then((rows) => {
          if (active)
            setOfflinePhotos(
              rows
                .filter((r) => !r.synced_at)
                .map((r) => ({ id: r.id, checklist_item_id: r.checklist_item_id, offline: true }))
            );
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }, [id])
  );

  const submitMut = useMutation({
    mutationFn: async () => (await api.post(`/visits/${id}/submit`)).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["visit", id] });
      qc.invalidateQueries({ queryKey: ["visits"] });
      // Stay in the visit flow: swap this summary screen for the visit page,
      // which now shows the ✅ completed card (who/when/photos).
      Alert.alert(
        "Visit submitted ✅",
        "Admin can now see this completed visit with all its photos."
      );
      // Pop the summary and any checklist screens below it, landing on the
      // visit detail page (not Home).
      router.dismissAll();
      router.navigate(`/visit/${id}`);
    },
    onError: async (e: any) => Alert.alert("Error", await getErrorMessage(e)),
  });

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (isError || !visit) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Could not load this visit.</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const items = checklist?.items ?? [];
  const photoList: any[] = [...(photos ?? []), ...offlinePhotos];
  const notOkItems = items.filter((i: any) => i.status === "NOT_OK");
  const incompleteItems = items.filter((i: any) => !i.status);
  const totalPhotos = photoList.length;

  const isModule = isFixed || isIT;
  const moduleList: any[] = moduleRows ?? [];
  const moduleAnswered = isIT
    ? moduleList.filter((r: any) => r.status === "VERIFIED" || r.status === "NOT_FOUND" || r.code).length
    : moduleList.length;
  const moduleTotal = moduleList.length;
  const itPending = isIT ? moduleList.filter((r: any) => r.status !== "VERIFIED" && r.status !== "NOT_FOUND").length : 0;

  const canSubmit = !submitMut.isPending;

  const getPhotosForItem = (itemId: string) =>
    photoList.filter((p: any) => p.checklist_item_id === itemId);

  const notOkWithPhotos = notOkItems.filter((i: any) => getPhotosForItem(i.id).length > 0).length;
  const notOkWithoutPhotos = notOkItems.length - notOkWithPhotos;

  // Submitted visits lock the summary. Rework/rejected visits stay submittable
  // so the inspector can fix the findings and resend for review.
  const alreadySubmitted = ["SUBMITTED", "UNDER_REVIEW", "RESUBMITTED", "APPROVED", "CLOSED"].includes(visit.status);

  return (
    <View style={styles.container}>
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 24 }} style={{ flex: 1 }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>← Back to Visit</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Visit Summary & Review</Text>
        <Text style={styles.subtitle}>{visit.branch_name ?? "Branch"}</Text>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{visit.visit_type_name ?? "Inspection"}</Text>
        </View>
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.cardTitle}>Completion Status</Text>
        {isModule ? (
          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{moduleAnswered}</Text>
              <Text style={styles.statLabel}>{isIT ? "Verified" : "Added"}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={{ ...styles.statValue, color: moduleTotal - moduleAnswered ? "#ef4444" : "#10b981" }}>
                {moduleTotal - moduleAnswered}
              </Text>
              <Text style={styles.statLabel}>{isIT ? "Pending" : "Remaining"}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{moduleTotal}</Text>
              <Text style={styles.statLabel}>Total</Text>
            </View>
          </View>
        ) : (
          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={styles.statValue}>{items.filter((i: any) => i.status).length}</Text>
              <Text style={styles.statLabel}>Answered</Text>
            </View>
            <View style={styles.stat}>
              <Text style={{ ...styles.statValue, color: incompleteItems.length ? "#ef4444" : "#10b981" }}>
                {incompleteItems.length}
              </Text>
              <Text style={styles.statLabel}>Remaining</Text>
            </View>
            <View style={styles.stat}>
              <Text style={{ ...styles.statValue, color: notOkItems.length ? "#f59e0b" : "#10b981" }}>
                {notOkItems.length}
              </Text>
              <Text style={styles.statLabel}>NOT OK</Text>
            </View>
          </View>
        )}
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.cardTitle}>📷 Photo Evidence</Text>
        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{totalPhotos}</Text>
            <Text style={styles.statLabel}>Total Photos</Text>
          </View>
          <View style={styles.stat}>
            <Text style={{ ...styles.statValue, color: notOkWithoutPhotos > 0 ? "#ef4444" : "#10b981" }}>
              {notOkWithPhotos} / {notOkItems.length}
            </Text>
            <Text style={styles.statLabel}>NOT OK Evidence</Text>
          </View>
        </View>
      </View>

      {notOkItems.length > 0 && (
        <View style={styles.summaryCard}>
          <Text style={styles.cardTitle}>⚠ NOT OK Items ({notOkItems.length})</Text>
          {notOkWithoutPhotos > 0 ? (
            <View style={styles.warningBanner}>
              <Text style={styles.warningText}>
                ⚠️ {notOkWithoutPhotos} NOT OK item{notOkWithoutPhotos > 1 ? "s" : ""} ha{notOkWithoutPhotos > 1 ? "ve" : "s"} no photo evidence (recommended, not mandatory).
              </Text>
            </View>
          ) : (
            <View style={styles.successBanner}>
              <Text style={styles.successText}>✓ All NOT OK items have required photo evidence attached.</Text>
            </View>
          )}
          {notOkItems.map((item: any) => {
            const itemPhotos = getPhotosForItem(item.id);
            const hasPhoto = itemPhotos.length > 0;
            return (
              <View key={item.id} style={styles.notOkItem}>
                <Text style={styles.notOkItemName}>{item.item_name}</Text>
                <View style={styles.notOkItemMeta}>
                  <Text
                    style={[
                      styles.notOkItemBadge,
                      { backgroundColor: hasPhoto ? "#10b981" : "#ef4444" },
                    ]}
                  >
                    {hasPhoto ? `✓ ${itemPhotos.length} photo(s)` : "✗ Missing photo"}
                  </Text>
                </View>
                {item.observation ? (
                  <Text style={styles.notOkObservation}>Observation: {item.observation}</Text>
                ) : null}
                {item.action_required ? (
                  <Text style={styles.notOkAction}>Action: {item.action_required}</Text>
                ) : null}
              </View>
            );
          })}
        </View>
      )}

      {isModule && moduleTotal > 0 && moduleTotal - moduleAnswered > 0 && (
        <View style={styles.summaryCard}>
          <Text style={styles.cardTitle}>{isIT ? `Pending Devices (${itPending})` : "Remaining Assets"}</Text>
          <TouchableOpacity
            style={styles.openChecklistBtn}
            onPress={() => router.push(isIT ? `/visit/${id}/it-assets` : `/visit/${id}/assets`)}
          >
            <Text style={styles.openChecklistText}>
              {isIT ? "💻 Go to IT Asset Verification" : "🪑 Go to Fixed Asset Checklist"}
            </Text>
          </TouchableOpacity>
          {isIT ? (
            <Text style={{ color: "#64748b", fontSize: 12, marginTop: 4, textAlign: "center" }}>
              Every employee's device must be marked Verified or Not there before submitting.
            </Text>
          ) : (
            <Text style={{ color: "#64748b", fontSize: 12, marginTop: 4, textAlign: "center" }}>
              Add at least one fixed asset photo before submitting.
            </Text>
          )}
        </View>
      )}

      {incompleteItems.length > 0 && (
        <View style={styles.summaryCard}>
          <Text style={styles.cardTitle}>Incomplete Items ({incompleteItems.length})</Text>
          <TouchableOpacity
            style={styles.openChecklistBtn}
            onPress={() => router.push(`/checklist/${id}`)}
          >
            <Text style={styles.openChecklistText}>📋 Go to Checklist to Answer Remaining Items</Text>
          </TouchableOpacity>
          {incompleteItems.slice(0, 5).map((item: any) => (
            <View key={item.id} style={styles.incompleteItem}>
              <Text style={styles.incompleteItemName}>{item.item_name}</Text>
              <Text style={styles.incompleteItemMeta}>Section: {item.section_name ?? "General"}</Text>
            </View>
          ))}
          {incompleteItems.length > 5 && (
            <Text style={{ color: "#64748b", fontSize: 12, marginTop: 4, textAlign: "center" }}>
              + {incompleteItems.length - 5} more items
            </Text>
          )}
        </View>
      )}

    </ScrollView>

      {/* Fixed bottom submit bar — always visible, never scrolls out of view */}
      {alreadySubmitted ? (
        <View style={styles.submitBar}>
          <View style={styles.submittedStatus}>
            <Text style={styles.submittedStatusText}>
              ✅ Visit submitted · status: {visit.status.replace("_", " ")}
            </Text>
          </View>
        </View>
      ) : (
      <View style={styles.submitBar}>
        <TouchableOpacity
          style={[
            styles.submitButton,
            styles.submitButtonEnabled,
          ]}
          onPress={() => {
            if (incompleteItems.length > 0 || (isIT && itPending > 0)) {
              const unans = isIT ? `${itPending} pending device(s)` : `${incompleteItems.length} unanswered item(s)`;
              Alert.alert(
                "Submit for Review?",
                `This visit has ${unans}.\n\nYou can submit now and the reviewer will see all your recorded findings and attached photos.`,
                [
                  { text: "Keep Editing", style: "cancel" },
                  { text: "Submit Now", onPress: () => submitMut.mutate() },
                ]
              );
              return;
            }
            if (notOkWithoutPhotos > 0) {
              Alert.alert(
                "Missing photos",
                `${notOkWithoutPhotos} NOT OK item(s) have no photo evidence.\n\nDo you want to submit for review now?`,
                [
                  { text: "Cancel", style: "cancel" },
                  { text: "Submit anyway", onPress: () => submitMut.mutate() },
                ]
              );
              return;
            }
            submitMut.mutate();
          }}
          disabled={submitMut.isPending}
        >
          <Text style={styles.submitButtonText}>
            {submitMut.isPending
              ? "Submitting..."
              : visit.status === "REWORK_REQUIRED" || visit.status === "REJECTED"
                ? "📤 Resubmit for Review"
                : "📤 Submit for Review"}
          </Text>
        </TouchableOpacity>
        {notOkWithoutPhotos > 0 && (
          <Text style={styles.submitNote}>
            ⚠️ {notOkWithoutPhotos} NOT OK item{notOkWithoutPhotos > 1 ? "s have" : " has"} no photo — submit anyway?
          </Text>
        )}
      </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorText: { color: "#ef4444", fontSize: 15, fontWeight: "600", textAlign: "center", paddingHorizontal: 24 },
  retryButton: {
    backgroundColor: "#2563eb",
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 10,
    marginTop: 14,
  },
  retryButtonText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  header: { marginTop: 20, marginBottom: 20 },
  back: { color: "#2563eb", fontSize: 15, marginBottom: 8 },
  title: { fontSize: 22, fontWeight: "700", color: "#0f172a" },
  subtitle: { fontSize: 14, color: "#64748b", marginTop: 2 },
  badge: { alignSelf: "flex-start", backgroundColor: "#e2e8f0", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4, marginTop: 10 },
  badgeText: { color: "#2563eb", fontSize: 12, fontWeight: "600" },
  summaryCard: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 16 },
  cardTitle: { fontSize: 16, fontWeight: "700", color: "#0f172a", marginBottom: 12 },
  statRow: { flexDirection: "row", gap: 16 },
  stat: { flex: 1, alignItems: "center" },
  statValue: { fontSize: 28, fontWeight: "700", color: "#0f172a" },
  statLabel: { fontSize: 12, color: "#64748b", marginTop: 2 },
  warningBanner: {
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  warningText: { color: "#dc2626", fontSize: 13, fontWeight: "600" },
  successBanner: {
    backgroundColor: "#f0fdf4",
    borderWidth: 1,
    borderColor: "#bbf7d0",
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  successText: { color: "#15803d", fontSize: 13, fontWeight: "600" },
  openChecklistBtn: {
    backgroundColor: "#eff6ff",
    borderRadius: 8,
    padding: 12,
    alignItems: "center",
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#bfdbfe",
  },
  openChecklistText: { color: "#2563eb", fontSize: 13, fontWeight: "700" },
  notOkItem: { backgroundColor: "#fef2f2", borderRadius: 8, padding: 12, marginBottom: 8 },
  notOkItemName: { fontSize: 14, fontWeight: "600", color: "#0f172a" },
  notOkItemMeta: { flexDirection: "row", alignItems: "center", marginTop: 6 },
  notOkItemBadge: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  notOkObservation: { fontSize: 12, color: "#334155", marginTop: 6, fontStyle: "italic" },
  notOkAction: { fontSize: 12, color: "#f59e0b", marginTop: 4 },
  incompleteItem: { backgroundColor: "#fffbeb", borderRadius: 8, padding: 12, marginBottom: 8 },
  incompleteItemName: { fontSize: 14, fontWeight: "500", color: "#0f172a" },
  incompleteItemMeta: { fontSize: 12, color: "#64748b", marginTop: 2 },
  submitBar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
    backgroundColor: "#fff",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e2e8f0",
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: -2 },
    shadowRadius: 6,
    elevation: 8,
  },
  submitButton: { borderRadius: 10, padding: 18, alignItems: "center" },
  submitButtonEnabled: { backgroundColor: "#10b981" },
  submitButtonDisabled: { backgroundColor: "#9ca3af" },
  submitButtonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  submittedStatus: { padding: 14, alignItems: "center" },
  submittedStatusText: { fontSize: 14, fontWeight: "700", color: "#10b981", textAlign: "center" },
  submitNote: { textAlign: "center", fontSize: 13, color: "#64748b", marginTop: 8 },
});