import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
  Modal,
} from "react-native";
import { api, getErrorMessage, getPhotoUrl } from "../../../lib/api";
import { statusLabel, statusColor, DONE_STATUSES, EDITABLE_STATUSES } from "../../../lib/status";
import { useState, useCallback, useEffect } from "react";
import { useHeaderTop } from "../../../lib/safeArea";



function photoUri(p: any): string | null {
  const raw = p?.thumbnail_url ?? p?.url ?? null;
  return getPhotoUrl(raw);
}
// Legacy states that behave as "not started yet" — collapsed into In Progress.
const PRE_START = ["DRAFT", "ASSIGNED", "SCHEDULED"];

export default function VisitDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const headerTop = useHeaderTop();
  const [previewPhoto, setPreviewPhoto] = useState<any>(null);

  const { data: visit, isLoading, isError, refetch } = useQuery({
    queryKey: ["visit", id],
    queryFn: async () => (await api.get(`/visits/${id}`)).data,
  });

  const { data: photos, refetch: refetchPhotos, isError: photosError } = useQuery({
    queryKey: ["visit-photos", id],
    queryFn: async () => (await api.get(`/visits/${id}/photos`)).data,
  });

  useFocusEffect(
    useCallback(() => {
      refetchPhotos();
      qc.invalidateQueries({ queryKey: ["visit", id] });
    }, [id])
  );

  const deletePhotoMut = useMutation({
    mutationFn: async (photoId: string) => api.delete(`/photos/${photoId}`),
    onSuccess: () => {
      setPreviewPhoto(null);
      refetchPhotos();
    },
    onError: async (e: any) => Alert.alert("Delete failed", await getErrorMessage(e)),
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

  const canEdit = EDITABLE_STATUSES.includes(visit.status);
  const isDonePhase = DONE_STATUSES.includes(visit.status);
  const photoList = photos ?? [];
  const vtype = visit.visit_type_name ?? "";
  const isFixed = vtype === "Fixed Asset Visit";
  const isIT = vtype === "IT Asset Visit";
  const isModule = isFixed || isIT;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={[styles.header, headerTop]}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{visit.branch_name ?? "Branch Visit"}</Text>
        <Text style={styles.subtitle}>{visit.visit_type_name ?? ""}</Text>
        <View style={[styles.badge, { backgroundColor: statusColor(visit.status) }]}>
          <Text style={styles.badgeText}>{statusLabel(visit.status)}</Text>
        </View>
      </View>

      <View style={styles.progressCard}>
        {isModule ? (
          <>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={styles.progressLabel}>
                {isFixed ? "Fixed asset module" : "IT asset module"}
              </Text>
              <Text style={styles.progressLabel}>{visit.photo_count ?? 0} photos</Text>
            </View>
            <Text style={[styles.progressText, { marginTop: 8 }]}>
              {isFixed
                ? "Add a photo of every fixed asset in the branch and mark its status."
                : "Verify each employee's device below, then review & submit."}
            </Text>
          </>
        ) : (
          <>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Text style={styles.progressLabel}>Checklist progress</Text>
              <Text style={styles.progressLabel}>
                {visit.total_items ? Math.round((visit.completed_items / visit.total_items) * 100) : 0}%
              </Text>
            </View>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${visit.total_items ? (visit.completed_items / visit.total_items) * 100 : 0}%`,
                  },
                ]}
              />
            </View>
            <Text style={styles.progressText}>
              {visit.total_items > 0
                ? `${visit.completed_items ?? 0} / ${visit.total_items} items · ${visit.photo_count ?? 0} photos`
                : `${visit.photo_count ?? 0} photo${(visit.photo_count ?? 0) === 1 ? "" : "s"} attached`}
            </Text>
          </>
        )}
      </View>

      {isDonePhase && (
        <View style={styles.doneCard}>
          <Text style={styles.doneTitle}>✅ Visit completed</Text>
          {visit.submitted_at && (
            <Text style={styles.doneRow}>
              🕒 Submitted on {new Date(visit.submitted_at).toLocaleString()}
            </Text>
          )}
          {visit.scheduled_date && (
            <Text style={styles.doneRow}>📅 Visit date: {visit.scheduled_date}</Text>
          )}
          {Array.isArray(visit.visitors) && visit.visitors.length > 0 && (
            <Text style={styles.doneRow}>
              👤 Done by: {visit.visitors.map((v: any) => v.name ?? v.id).join(", ")}
            </Text>
          )}
          {visit.compliance_percentage != null && (
            <Text style={styles.doneRow}>📊 Compliance: {visit.compliance_percentage}%</Text>
          )}
          {visit.visitor_notes ? (
            <Text style={styles.doneRow}>📝 Notes: {visit.visitor_notes}</Text>
          ) : null}
        </View>
      )}

      <View style={styles.infoCard}>
        {visit.scheduled_date && !isDonePhase && (
          <Text style={styles.infoRow}>📅 Scheduled: {visit.scheduled_date}</Text>
        )}
        <Text style={styles.infoRow}>🚦 Priority: {visit.priority}</Text>
        {visit.instructions ? <Text style={styles.infoRow}>📝 {visit.instructions}</Text> : null}
      </View>

      <Text style={styles.sectionTitle}>
        📷 Photos from this visit {photoList.length ? `(${photoList.length})` : ""}
      </Text>
      {photoList.length === 0 ? (
        <Text style={styles.noPhotos}>No photos yet.</Text>
      ) : (
        <View style={styles.photoGrid}>
          {photoList.map((p: any) => {
            const uri = photoUri(p);
            return uri ? (
              <TouchableOpacity key={p.id} onPress={() => setPreviewPhoto(p)}>
                <Image source={{ uri }} style={styles.photoThumb} />
              </TouchableOpacity>
            ) : null;
          })}
        </View>
      )}

      {canEdit && (
        <>
          {!isModule && (
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => router.push(`/checklist/${id}`)}
            >
              <Text style={styles.primaryButtonText}>📋 Open Checklist</Text>
            </TouchableOpacity>
          )}

          {isFixed && (
            <TouchableOpacity
              style={[styles.summaryButton, { backgroundColor: "#7c3aed", marginTop: isFixed ? 20 : 10 }]}
              onPress={() => router.push(`/visit/${id}/assets`)}
            >
              <Text style={styles.summaryButtonText}>🪑 Fixed Asset Checklist</Text>
            </TouchableOpacity>
          )}

          {isIT && (
            <TouchableOpacity
              style={[styles.summaryButton, { backgroundColor: "#0891b2", marginTop: isIT ? 20 : 10 }]}
              onPress={() => router.push(`/visit/${id}/it-assets`)}
            >
              <Text style={styles.summaryButtonText}>💻 IT Asset Verification</Text>
            </TouchableOpacity>
          )}

          {/* Auto-start: the user never has to think about states. A pre-start
              visit quietly moves to IN_PROGRESS the moment they open it. */}
          {PRE_START.includes(visit.status) && (
            <AutoStart visitId={id} onStarted={() => {
              qc.invalidateQueries({ queryKey: ["visit", id] });
              qc.invalidateQueries({ queryKey: ["visits"] });
            }} />
          )}

          {["IN_PROGRESS", "REWORK_REQUIRED", "RESUBMITTED"].includes(visit.status) && (
            <TouchableOpacity
              style={styles.summaryButton}
              onPress={() => router.push(`/visit/${id}/summary`)}
            >
              <Text style={styles.summaryButtonText}>📝 Review & Submit</Text>
            </TouchableOpacity>
          )}
        </>
      )}

      {/* Full-screen photo preview with delete */}
      <Modal visible={!!previewPhoto} transparent animationType="fade" onRequestClose={() => setPreviewPhoto(null)}>
        <View style={styles.previewOverlay}>
          <View style={styles.previewTop}>
            <TouchableOpacity onPress={() => setPreviewPhoto(null)}>
              <Text style={styles.previewClose}>✕ Close</Text>
            </TouchableOpacity>
            {previewPhoto && (
              <TouchableOpacity
                onPress={() =>
                  Alert.alert("Delete photo?", "This photo will be permanently removed.", [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Delete",
                      style: "destructive",
                      onPress: () => deletePhotoMut.mutate(previewPhoto.id),
                    },
                  ])
                }
              >
                <Text style={styles.previewDelete}>🗑 Delete</Text>
              </TouchableOpacity>
            )}
          </View>
          {previewPhoto && photoUri(previewPhoto) && (
            <Image
              source={{ uri: photoUri(previewPhoto)! }}
              style={styles.previewImage}
              resizeMode="contain"
            />
          )}
          {previewPhoto?.created_at && (
            <Text style={styles.previewCaption}>
              {new Date(previewPhoto.created_at).toLocaleString()}
            </Text>
          )}
        </View>
      </Modal>
    </ScrollView>
  );
}

// Silently moves a DRAFT/ASSIGNED/SCHEDULED visit into IN_PROGRESS so the
// user never sees a "Start Visit" button — opening the visit IS starting it.
function AutoStart({ visitId, onStarted }: { visitId: string; onStarted: () => void }) {
  useEffect(() => {
    let active = true;
    api
      .post(`/visits/${visitId}/start`)
      .then(() => {
        if (active) onStarted();
      })
      .catch(() => {
        /* keep current state if start is not allowed — editing still works */
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId]);
  return null;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { paddingHorizontal: 16, paddingTop: 14 },
  back: { color: "#2563eb", fontSize: 15, fontWeight: "600" },
  title: { fontSize: 22, fontWeight: "800", color: "#0f172a", marginTop: 8 },
  subtitle: { fontSize: 14, color: "#64748b", marginTop: 2 },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 8,
  },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  progressCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    marginTop: 14,
    marginHorizontal: 16,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  progressLabel: { fontSize: 13, fontWeight: "600", color: "#475569" },
  progressTrack: {
    height: 8,
    backgroundColor: "#e2e8f0",
    borderRadius: 4,
    marginTop: 8,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: "#10b981", borderRadius: 4 },
  progressText: { fontSize: 13, color: "#64748b", marginTop: 6 },
  doneCard: {
    backgroundColor: "#f0fdf4",
    borderColor: "#a7f3d0",
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    marginTop: 12,
    marginHorizontal: 16,
  },
  doneTitle: { fontSize: 16, fontWeight: "800", color: "#047857" },
  doneRow: { fontSize: 13, color: "#065f46", marginTop: 6 },
  infoCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 16,
    marginTop: 12,
    marginHorizontal: 16,
  },
  infoRow: { fontSize: 13, color: "#475569", marginTop: 4 },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#334155",
    marginTop: 18,
    marginHorizontal: 16,
  },
  noPhotos: { fontSize: 13, color: "#94a3b8", marginTop: 8, marginHorizontal: 16 },
  photoGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 16,
    marginTop: 10,
  },
  photoThumb: { width: 96, height: 96, borderRadius: 10, backgroundColor: "#e2e8f0" },
  primaryButton: {
    backgroundColor: "#2563eb",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 20,
    marginHorizontal: 16,
  },
  primaryButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  secondaryButton: {
    backgroundColor: "#fff",
    borderColor: "#cbd5e1",
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 10,
    marginHorizontal: 16,
  },
  secondaryButtonText: { color: "#334155", fontSize: 15, fontWeight: "600" },
  summaryButton: {
    backgroundColor: "#10b981",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 10,
    marginHorizontal: 16,
  },
  summaryButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  errorText: { color: "#ef4444", fontSize: 15, fontWeight: "600", textAlign: "center", paddingHorizontal: 24 },
  retryButton: {
    backgroundColor: "#2563eb",
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 10,
    marginTop: 14,
  },
  retryButtonText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  previewOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    paddingTop: 50,
    paddingBottom: 30,
  },
  previewTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  previewClose: { color: "#fff", fontSize: 16, fontWeight: "600" },
  previewDelete: { color: "#f87171", fontSize: 16, fontWeight: "600" },
  previewImage: { flex: 1 },
  previewCaption: { color: "#94a3b8", fontSize: 12, textAlign: "center", marginTop: 8 },
});
