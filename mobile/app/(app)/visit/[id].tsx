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
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api, getErrorMessage, getPhotoUrl } from "../../../lib/api";
import { statusLabel, statusColor, DONE_STATUSES, EDITABLE_STATUSES } from "../../../lib/status";
import { useState, useCallback, useEffect } from "react";
import { useHeaderTop } from "../../../lib/safeArea";
import { useResponsive } from "../../../lib/theme";
import { colors, radius, spacing, type, shadows } from "../../../lib/theme";

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
  const { isTablet, width } = useResponsive();
  const pad = isTablet ? spacing.xxl : spacing.lg;
  const [previewPhoto, setPreviewPhoto] = useState<any>(null);

  const { data: visit, isLoading, isError, refetch } = useQuery({
    queryKey: ["visit", id],
    queryFn: async () => (await api.get(`/visits/${id}`)).data,
  });

  const { data: photos, refetch: refetchPhotos } = useQuery({
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
        <ActivityIndicator size="large" color={colors.brand} />
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
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ paddingBottom: 40, paddingHorizontal: pad, maxWidth: 720, width: "100%", alignSelf: "center" }}
      showsVerticalScrollIndicator={false}
    >
      <View style={[styles.header, headerTop]}>
        <TouchableOpacity style={styles.backRow} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={20} color={colors.brand} />
          <Text style={styles.back}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{visit.branch_name ?? "Branch Visit"}</Text>
        <View style={styles.titleRow}>
          <Text style={styles.subtitle}>{visit.visit_type_name ?? ""}</Text>
          <View style={[styles.badge, { backgroundColor: statusColor(visit.status) }]}>
            <Text style={styles.badgeText}>{statusLabel(visit.status)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.progressCard}>
        {isModule ? (
          <>
            <View style={styles.rowBetween}>
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
            <View style={styles.rowBetween}>
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
          <Text style={styles.doneTitle}>Visit completed</Text>
          {visit.submitted_at && (
            <Text style={styles.doneRow}>🕒 Submitted on {new Date(visit.submitted_at).toLocaleString()}</Text>
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
        Photos from this visit {photoList.length ? `(${photoList.length})` : ""}
      </Text>
      {photoList.length === 0 ? (
        <Text style={styles.noPhotos}>No photos yet.</Text>
      ) : (
        <View style={styles.photoGrid}>
          {photoList.map((p: any) => {
            const uri = photoUri(p);
            return uri ? (
              <TouchableOpacity key={p.id} onPress={() => setPreviewPhoto(p)} activeOpacity={0.85}>
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
              activeOpacity={0.9}
            >
              <Ionicons name="list-outline" size={19} color="#fff" />
              <Text style={styles.primaryButtonText}>Open Checklist</Text>
            </TouchableOpacity>
          )}

          {isFixed && (
            <TouchableOpacity
              style={[styles.summaryButton, { backgroundColor: "#7C3AED", marginTop: 20 }]}
              onPress={() => router.push(`/visit/${id}/assets`)}
              activeOpacity={0.9}
            >
              <Ionicons name="cube-outline" size={19} color="#fff" />
              <Text style={styles.summaryButtonText}>Fixed Asset Checklist</Text>
            </TouchableOpacity>
          )}

          {isIT && (
            <TouchableOpacity
              style={[styles.summaryButton, { backgroundColor: "#0891B2", marginTop: 20 }]}
              onPress={() => router.push(`/visit/${id}/it-assets`)}
              activeOpacity={0.9}
            >
              <Ionicons name="laptop-outline" size={19} color="#fff" />
              <Text style={styles.summaryButtonText}>IT Asset Verification</Text>
            </TouchableOpacity>
          )}

          {/* Auto-start: the user never has to think about states. A pre-start
              visit quietly moves to IN_PROGRESS the moment they open it. */}
          {PRE_START.includes(visit.status) && (
            <AutoStart
              visitId={id}
              onStarted={() => {
                qc.invalidateQueries({ queryKey: ["visit", id] });
                qc.invalidateQueries({ queryKey: ["visits"] });
              }}
            />
          )}

          {["IN_PROGRESS", "REWORK_REQUIRED", "RESUBMITTED"].includes(visit.status) && (
            <TouchableOpacity
              style={styles.summaryButton}
              onPress={() => router.push(`/visit/${id}/summary`)}
              activeOpacity={0.9}
            >
              <Ionicons name="checkmark-done-outline" size={19} color="#fff" />
              <Text style={styles.summaryButtonText}>Review &amp; Submit</Text>
            </TouchableOpacity>
          )}
        </>
      )}

      {/* Full-screen photo preview with delete */}
      <Modal visible={!!previewPhoto} transparent animationType="fade" onRequestClose={() => setPreviewPhoto(null)}>
        <View style={styles.previewOverlay}>
          <View style={styles.previewTop}>
            <TouchableOpacity onPress={() => setPreviewPhoto(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
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
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.previewDelete}>🗑 Delete</Text>
              </TouchableOpacity>
            )}
          </View>
          {previewPhoto && photoUri(previewPhoto) && (
            <Image source={{ uri: photoUri(previewPhoto)! }} style={styles.previewImage} resizeMode="contain" />
          )}
          {previewPhoto?.created_at && (
            <Text style={styles.previewCaption}>{new Date(previewPhoto.created_at).toLocaleString()}</Text>
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
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  header: { paddingTop: 14 },
  backRow: { flexDirection: "row", alignItems: "center", marginLeft: -4 },
  back: { color: colors.brand, fontSize: type.body, fontWeight: "600" },
  title: { fontSize: type.heading, fontWeight: "800", color: colors.text, marginTop: 8 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" },
  subtitle: { fontSize: type.label, color: colors.textMuted },
  badge: { borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { color: "#fff", fontSize: type.small, fontWeight: "700" },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: 14,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  progressLabel: { fontSize: type.label, fontWeight: "600", color: "#475569" },
  progressTrack: { height: 8, backgroundColor: colors.surfaceAlt, borderRadius: 4, marginTop: 8, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: colors.success, borderRadius: 4 },
  progressText: { fontSize: type.label, color: colors.textMuted, marginTop: 6 },
  doneCard: {
    backgroundColor: colors.successSubtle,
    borderColor: "#A7F3D0",
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: 12,
  },
  doneTitle: { fontSize: type.subheading, fontWeight: "800", color: "#047857" },
  doneRow: { fontSize: type.label, color: "#065F46", marginTop: 6 },
  infoCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoRow: { fontSize: type.label, color: "#475569", marginTop: 4 },
  sectionTitle: { fontSize: type.subheading, fontWeight: "700", color: "#334155", marginTop: 18 },
  noPhotos: { fontSize: type.label, color: colors.textFaint, marginTop: 8 },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  photoThumb: {
    width: Math.min(96, Math.round((720 - spacing.lg * 2 - spacing.sm * 2) / 3)),
    height: Math.min(96, Math.round((720 - spacing.lg * 2 - spacing.sm * 2) / 3)),
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
  },
  primaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.brand,
    borderRadius: radius.lg,
    paddingVertical: 16,
    marginTop: 20,
    ...shadows.glow,
  },
  primaryButtonText: { color: "#fff", fontSize: type.subheading, fontWeight: "700" },
  summaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.success,
    borderRadius: radius.lg,
    paddingVertical: 16,
    marginTop: 10,
  },
  summaryButtonText: { color: "#fff", fontSize: type.subheading, fontWeight: "700" },
  errorText: { color: colors.danger, fontSize: type.body, fontWeight: "600", textAlign: "center", paddingHorizontal: 24 },
  retryButton: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingHorizontal: 28,
    paddingVertical: 10,
    marginTop: 14,
  },
  retryButtonText: { color: "#fff", fontSize: type.body, fontWeight: "700" },
  previewOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.94)", paddingTop: 54, paddingBottom: 30 },
  previewTop: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 20, marginBottom: 10 },
  previewClose: { color: "#fff", fontSize: type.body, fontWeight: "600" },
  previewDelete: { color: colors.dangerLight, fontSize: type.body, fontWeight: "600" },
  previewImage: { flex: 1 },
  previewCaption: { color: colors.textMuted, fontSize: type.small, textAlign: "center", marginTop: 8 },
});
