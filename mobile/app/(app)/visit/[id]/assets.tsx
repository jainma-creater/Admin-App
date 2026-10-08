import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Image,
  TextInput,
  Platform,
} from "react-native";
import { api, getErrorMessage, getPhotoUrl } from "../../../../lib/api";
import { useState } from "react";
import { useHeaderTop } from "../../../../lib/safeArea";

const PRESETS = ["Fan", "Chair", "Table", "Locker", "Almirah", "Fire Extinguisher", "Signboard"];

export default function VisitAssetsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const headerTop = useHeaderTop();
  const [adding, setAdding] = useState(false);
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [editCodeId, setEditCodeId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState("");

  const { data: assets, isLoading, refetch } = useQuery({
    queryKey: ["visit-assets", id],
    queryFn: async () => (await api.get(`/visits/${id}/assets`)).data,
  });

  const addMut = useMutation({
    mutationFn: async (categoryOverride?: string) =>
      (
        await api.post(`/visits/${id}/assets`, {
          category: categoryOverride ?? category,
          name: name.trim() || null,
        })
      ).data,
    onSuccess: () => {
      setAdding(false);
      setCategory("");
      setName("");
      refetch();
    },
    onError: async (e: any) => Alert.alert("Add failed", await getErrorMessage(e)),
  });

  const deleteMut = useMutation({
    mutationFn: async (assetId: string) => api.delete(`/visits/${id}/assets/${assetId}`),
    onSuccess: () => refetch(),
    onError: async (e: any) => Alert.alert("Delete failed", await getErrorMessage(e)),
  });

  const deletePhotoMut = useMutation({
    mutationFn: async (photoId: string) => api.delete(`/photos/${photoId}`),
    onSuccess: () => refetch(),
    onError: async (e: any) => Alert.alert("Delete photo failed", await getErrorMessage(e)),
  });

  const saveCodeMut = useMutation({
    mutationFn: async ({ assetId, code }: { assetId: string; code: string }) =>
      (
        await api.patch(`/visits/${id}/assets/${assetId}`, {
          code: code.trim() || null,
          ocr_confirmed: !!code.trim(),
        })
      ).data,
    onSuccess: () => {
      setEditCodeId(null);
      setEditCode("");
      refetch();
      qc.invalidateQueries({ queryKey: ["visit-assets", id] });
    },
    onError: async (e: any) => Alert.alert("Save failed", await getErrorMessage(e)),
  });

  const list = assets ?? [];
  const totalCount = list.length;
  const withCodeCount = list.filter((a: any) => a.code && a.code.trim()).length;
  const withPhotoCount = list.filter((a: any) => (a.photos && a.photos.length > 0) || a.photo_url).length;
  const pendingCount = list.filter((a: any) => (!a.code || !a.code.trim()) && (!a.photos || a.photos.length === 0)).length;

  return (
    <View style={styles.container}>
      <View style={[styles.header, headerTop]}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Fixed Asset Checklist</Text>
        <Text style={styles.subtitle}>
          {totalCount} asset{totalCount === 1 ? "" : "s"} · photo + optional code
        </Text>
      </View>

      {/* Fixed-size, non-shrinking 2x2 KPI Summary Grid */}
      <View style={styles.kpiGrid}>
        <View style={[styles.kpiCard, { borderColor: "#bfdbfe" }]}>
          <Text style={[styles.kpiValue, { color: "#2563eb" }]}>{totalCount}</Text>
          <Text style={styles.kpiLabel}>Total Assets</Text>
        </View>
        <View style={[styles.kpiCard, { borderColor: "#bbf7d0" }]}>
          <Text style={[styles.kpiValue, { color: "#16a34a" }]}>{withCodeCount}</Text>
          <Text style={styles.kpiLabel}>Code / OCR</Text>
        </View>
        <View style={[styles.kpiCard, { borderColor: "#ddd6fe" }]}>
          <Text style={[styles.kpiValue, { color: "#7c3aed" }]}>{withPhotoCount}</Text>
          <Text style={styles.kpiLabel}>With Photos</Text>
        </View>
        <View style={[styles.kpiCard, { borderColor: "#fed7aa" }]}>
          <Text style={[styles.kpiValue, { color: "#ea580c" }]}>{pendingCount}</Text>
          <Text style={styles.kpiLabel}>Pending</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.addButton} onPress={() => setAdding((v) => !v)}>
        <Text style={styles.addButtonText}>＋ {adding ? "Cancel" : "Add Custom Asset"}</Text>
      </TouchableOpacity>

      {!adding && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.presetRow}
          contentContainerStyle={styles.presetRowContent}
        >
          {PRESETS.map((p) => (
            <TouchableOpacity
              key={p}
              style={styles.presetChip}
              disabled={addMut.isPending}
              onPress={() => addMut.mutate(p)}
            >
              <Text style={styles.presetChipText}>{addMut.isPending ? "…" : p}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {adding && (
        <View style={styles.addForm}>
          <TextInput
            style={styles.input}
            placeholder="Category — Fan / Chair / Table…"
            placeholderTextColor="#94a3b8"
            value={category}
            onChangeText={setCategory}
          />
          <TextInput
            style={styles.input}
            placeholder="Name (optional) — e.g. Ceiling fan near counter"
            placeholderTextColor="#94a3b8"
            value={name}
            onChangeText={setName}
          />
          <TouchableOpacity
            style={[styles.saveBtn, (!category.trim() || addMut.isPending) && styles.disabled]}
            disabled={!category.trim() || addMut.isPending}
            onPress={() => addMut.mutate()}
          >
            <Text style={styles.saveBtnText}>{addMut.isPending ? "Saving…" : "Add Asset"}</Text>
          </TouchableOpacity>
        </View>
      )}

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      ) : list.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ fontSize: 34, marginBottom: 10 }}>🪑</Text>
          <Text style={styles.emptyTitle}>No fixed assets yet</Text>
          <Text style={styles.emptyText}>
            Add assets found at the branch, then tap "📷 Photo & Code" to capture the plate and
            verify its code.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {list.map((a: any) => {
            const thumb = getPhotoUrl(a.photo_thumbnail_url ?? a.photo_url);
            const editing = editCodeId === a.id;
            const photos: any[] = a.photos ?? [];
            return (
              <View key={a.id} style={styles.card}>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.titleRow}>
                      <Text style={styles.cardTitle}>{a.category}</Text>
                      {a.ocr_confirmed && <Text style={styles.verifiedTag}>✓ OCR</Text>}
                    </View>
                    {a.name ? <Text style={styles.cardSub}>{a.name}</Text> : null}
                    {photos.length > 0 && (
                      <Text style={styles.photosCount}>
                        {photos.length} photo{photos.length === 1 ? "" : "s"}
                      </Text>
                    )}
                  </View>
                  {thumb && <Image source={{ uri: thumb }} style={styles.thumb} />}
                </View>

                {photos.length > 0 && (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.photoStrip}
                    contentContainerStyle={styles.photoStripContent}
                  >
                    {photos.map((p: any) => {
                      const t = getPhotoUrl(p.photo_thumbnail_url ?? p.photo_url);
                      return (
                        <View key={p.id} style={styles.photoTile}>
                          {t && <Image source={{ uri: t }} style={styles.photoImg} />}
                          <TouchableOpacity
                            style={styles.photoDel}
                            onPress={() =>
                              Alert.alert("Remove photo?", "Remove this photo from the asset? (photo is deleted)", [
                                { text: "Cancel", style: "cancel" },
                                {
                                  text: "Remove",
                                  style: "destructive",
                                  onPress: () => deletePhotoMut.mutate(p.id),
                                },
                              ])
                            }
                          >
                            <Text style={styles.photoDelText}>✕</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </ScrollView>
                )}

                <TouchableOpacity
                  style={styles.photoAdd}
                  onPress={() =>
                    router.push({
                      pathname: "/camera",
                      params: { visitId: id, scanKind: "asset", scanTargetId: a.id, plain: "1" },
                    })
                  }
                >
                  <Text style={styles.photoAddText}>＋ Add Photo</Text>
                </TouchableOpacity>

                <View style={styles.codeRow}>
                  {a.code ? (
                    <View style={styles.codeChip}>
                      <Text style={styles.codeText}>{a.code}</Text>
                    </View>
                  ) : (
                    <Text style={styles.pending}>— No code captured yet —</Text>
                  )}
                </View>

                {editing && (
                  <View style={styles.editBox}>
                    <TextInput
                      style={styles.editInput}
                      placeholder="Asset code (optional)"
                      placeholderTextColor="#94a3b8"
                      autoCapitalize="characters"
                      autoCorrect={false}
                      value={editCode}
                      onChangeText={setEditCode}
                      maxLength={120}
                    />
                    <View style={styles.editActions}>
                      <TouchableOpacity
                        style={styles.editCancelBtn}
                        onPress={() => {
                          setEditCodeId(null);
                          setEditCode("");
                        }}
                      >
                        <Text style={styles.editCancelText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.editSaveBtn, saveCodeMut.isPending && styles.disabled]}
                        disabled={saveCodeMut.isPending}
                        onPress={() => saveCodeMut.mutate({ assetId: a.id, code: editCode })}
                      >
                        <Text style={styles.editSaveText}>
                          {saveCodeMut.isPending ? "Saving…" : editCode.trim() ? "Save Code" : "No Code"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                <View style={styles.actions}>
                  <TouchableOpacity
                    style={styles.scanBtn}
                    onPress={() =>
                      router.push({
                        pathname: "/camera",
                        params: { visitId: id, scanKind: "asset", scanTargetId: a.id },
                      })
                    }
                  >
                    <Text style={styles.scanBtnText}>
                      {a.photo_url ? "📷 Re-photo" : "📷 Photo & Code"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.editBtn}
                    onPress={() => {
                      setEditCodeId(editing ? null : a.id);
                      setEditCode(a.code ?? "");
                    }}
                  >
                    <Text style={styles.editBtnText}>✏️ Code</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() =>
                      Alert.alert("Delete asset?", `Remove "${a.category}" from this visit?`, [
                        { text: "Cancel", style: "cancel" },
                        { text: "Delete", style: "destructive", onPress: () => deleteMut.mutate(a.id) },
                      ])
                    }
                  >
                    <Text style={styles.deleteBtnText}>🗑</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      {list.length > 0 && (
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={styles.submitReviewBtn}
            activeOpacity={0.85}
            onPress={() => router.push(`/visit/${id}/summary`)}
          >
            <Text style={styles.submitReviewText}>📝 Review & Submit Fixed Assets ›</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  header: { paddingHorizontal: 16, paddingTop: Platform.OS === "ios" ? 54 : 36, paddingBottom: 6 },
  back: { color: "#2563eb", fontSize: 15, fontWeight: "600" },
  title: { fontSize: 22, fontWeight: "800", color: "#0f172a", marginTop: 8 },
  subtitle: { fontSize: 13, color: "#64748b", marginTop: 4 },

  // Fixed-size, non-shrinking 2x2 KPI Summary Grid
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingHorizontal: 16,
    marginTop: 10,
    marginBottom: 4,
  },
  kpiCard: {
    flexGrow: 1,
    flexBasis: "46%",
    minWidth: 135,
    backgroundColor: "#ffffff",
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1.5,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  kpiValue: { fontSize: 20, fontWeight: "800" },
  kpiLabel: { fontSize: 11, fontWeight: "600", color: "#64748b", marginTop: 2, textAlign: "center" },

  addButton: {
    backgroundColor: "#eff6ff",
    borderColor: "#bfdbfe",
    borderWidth: 1,
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  addButtonText: { color: "#1d4ed8", fontSize: 14, fontWeight: "700" },
  presetRow: { marginTop: 10 },
  presetRowContent: { gap: 8, paddingHorizontal: 16 },
  presetChip: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#bfdbfe",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    minWidth: 62,
    alignItems: "center",
  },
  presetChipText: { color: "#1d4ed8", fontSize: 14, fontWeight: "700" },
  addForm: {
    backgroundColor: "#fff",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    padding: 14,
    marginHorizontal: 16,
    marginTop: 10,
  },
  input: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#0f172a",
    backgroundColor: "#f8fafc",
    marginBottom: 10,
  },
  saveBtn: { backgroundColor: "#2563eb", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  saveBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  disabled: { opacity: 0.6 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#f1f5f9",
    padding: 14,
    marginHorizontal: 16,
    marginTop: 12,
    shadowColor: "#0f172a",
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  cardTitle: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  cardSub: { fontSize: 12.5, color: "#64748b", marginTop: 2 },
  thumb: { width: 52, height: 52, borderRadius: 10, backgroundColor: "#e2e8f0" },
  photosCount: { fontSize: 12, color: "#2563eb", fontWeight: "700", marginTop: 4 },
  photoStrip: { marginTop: 10 },
  photoStripContent: { gap: 8 },
  photoTile: {
    width: 64,
    height: 64,
    borderRadius: 10,
    backgroundColor: "#e2e8f0",
    overflow: "hidden",
  },
  photoImg: { width: 64, height: 64 },
  photoDel: {
    position: "absolute",
    top: 2,
    right: 2,
    backgroundColor: "rgba(15,23,42,0.75)",
    borderRadius: 10,
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  photoDelText: { color: "#fff", fontSize: 11, fontWeight: "800", lineHeight: 16 },
  photoAdd: {
    marginTop: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#93c5fd",
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: "center",
    backgroundColor: "#eff6ff",
  },
  photoAddText: { color: "#1d4ed8", fontSize: 13, fontWeight: "700" },
  codeRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  codeChip: {
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexShrink: 1,
  },
  codeText: { fontFamily: "monospace", fontSize: 13, color: "#0f172a", fontWeight: "600" },
  verifiedTag: { color: "#059669", fontSize: 12, fontWeight: "800" },
  pending: { color: "#94a3b8", fontSize: 13 },
  editBox: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
  },
  editInput: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#0f172a",
    backgroundColor: "#fff",
    marginBottom: 10,
  },
  editActions: { flexDirection: "row", gap: 10 },
  editCancelBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
    backgroundColor: "#fff",
  },
  editCancelText: { color: "#64748b", fontSize: 14, fontWeight: "700" },
  editSaveBtn: {
    flex: 1,
    backgroundColor: "#2563eb",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  editSaveText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  actions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  scanBtn: {
    flex: 1,
    backgroundColor: "#2563eb",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  scanBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  editBtn: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    backgroundColor: "#f8fafc",
  },
  editBtnText: { color: "#1d4ed8", fontSize: 14, fontWeight: "700" },
  deleteBtn: {
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    backgroundColor: "#fef2f2",
  },
  deleteBtnText: { fontSize: 16 },
  emptyTitle: { fontSize: 17, fontWeight: "800", color: "#0f172a" },
  emptyText: { fontSize: 13, color: "#64748b", textAlign: "center", marginTop: 6, lineHeight: 20 },

  bottomBar: {
    padding: 14,
    backgroundColor: "#ffffff",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
  submitReviewBtn: {
    backgroundColor: "#10b981",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    shadowColor: "#10b981",
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 3,
  },
  submitReviewText: { color: "#ffffff", fontSize: 15, fontWeight: "800" },
});