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

export default function VisitItAssetsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const headerTop = useHeaderTop();
  const [search, setSearch] = useState("");
  const [editCodeId, setEditCodeId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState("");
  const [notThereId, setNotThereId] = useState<string | null>(null);
  const [notThereRemark, setNotThereRemark] = useState("");

  const { data: rows, isLoading, refetch } = useQuery({
    queryKey: ["visit-it-assets", id],
    queryFn: async () => (await api.get(`/visits/${id}/it-assets`)).data,
  });

  const saveCodeMut = useMutation({
    mutationFn: async ({ rowId, code }: { rowId: string; code: string }) =>
      (
        await api.patch(`/visits/${id}/it-assets/${rowId}`, {
          code: code.trim() || null,
          ocr_confirmed: !!code.trim(),
        })
      ).data,
    onSuccess: () => {
      setEditCodeId(null);
      setEditCode("");
      refetch();
      qc.invalidateQueries({ queryKey: ["visit-it-assets", id] });
    },
    onError: async (e: any) => Alert.alert("Save failed", await getErrorMessage(e)),
  });

  const saveNotThereMut = useMutation({
    mutationFn: async ({ rowId, remark }: { rowId: string; remark: string }) =>
      (
        await api.patch(`/visits/${id}/it-assets/${rowId}`, {
          status: "NOT_FOUND",
          remark: remark.trim(),
          code: null,
          ocr_confirmed: false,
        })
      ).data,
    onSuccess: () => {
      setNotThereId(null);
      setNotThereRemark("");
      refetch();
      qc.invalidateQueries({ queryKey: ["visit-it-assets", id] });
    },
    onError: async (e: any) => Alert.alert("Save failed", await getErrorMessage(e)),
  });

  const markPresentMut = useMutation({
    mutationFn: async (rowId: string) =>
      (
        await api.patch(`/visits/${id}/it-assets/${rowId}`, {
          status: "PENDING",
          remark: null,
          code: null,
          ocr_confirmed: false,
        })
      ).data,
    onSuccess: () => refetch(),
    onError: async (e: any) => Alert.alert("Save failed", await getErrorMessage(e)),
  });

  const deletePhotoMut = useMutation({
    mutationFn: async (photoId: string) => api.delete(`/photos/${photoId}`),
    onSuccess: () => refetch(),
    onError: async (e: any) => Alert.alert("Delete photo failed", await getErrorMessage(e)),
  });

  const list = rows ?? [];
  const verified = list.filter((r: any) => r.status === "VERIFIED" || r.code).length;
  const notThereCount = list.filter((r: any) => r.status === "NOT_FOUND").length;

  const grouped = list.reduce((acc: any, r: any) => {
    const key = `${r.employee_id}-${r.employee_code ?? ""}`;
    if (!acc[key]) acc[key] = { name: r.employee_name, code: r.employee_code, department: r.department, rows: [] };
    acc[key].rows.push(r);
    return acc;
  }, {} as Record<string, any>);

  const q = search.trim().toLowerCase();
  const matchedGroups = q
    ? Object.entries(grouped).filter(([, g]: any) => {
        const empMatch =
          (g.name ?? "").toLowerCase().includes(q) || (g.code ?? "").toLowerCase().includes(q);
        const rowMatch = g.rows.some(
          (r: any) =>
            (r.code ?? "").toLowerCase().includes(q) ||
            (r.asset_type_name ?? "").toLowerCase().includes(q)
        );
        return empMatch || rowMatch;
      })
    : Object.entries(grouped);

  const visible = matchedGroups.map(([, g]: any) => g);

  return (
    <View style={styles.container}>
      <View style={[styles.header, headerTop]}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>IT Asset Verification</Text>
        <Text style={styles.subtitle}>
          {verified}/{list.length} codes captured for this branch's employees{notThereCount > 0 ? ` · ${notThereCount} not there` : ""}
        </Text>
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search employee, code or device…"
          placeholderTextColor="#94a3b8"
          autoCapitalize="none"
          autoCorrect={false}
          value={search}
          onChangeText={setSearch}
        />
        {search ? (
          <TouchableOpacity style={styles.searchClear} onPress={() => setSearch("")}>
            <Text style={styles.searchClearText}>✕</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      ) : list.length === 0 ? (
        <View style={styles.center}>
          <Text style={{ fontSize: 34, marginBottom: 10 }}>💻</Text>
          <Text style={styles.emptyTitle}>No employees on record</Text>
          <Text style={styles.emptyText}>
            Employees for this branch are added from the employee master (web). Every employee is
            then pre-assigned Laptop / Mobile etc. for verification.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
          {visible.length === 0 ? (
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>No matches</Text>
              <Text style={styles.emptyText}>No employee or device matches "{search.trim()}".</Text>
            </View>
          ) : (
          visible.map((g: any) => (
            <View key={g.code ?? g.name} style={styles.group}>
              <View style={styles.groupHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.empName}>{g.name ?? "-"}</Text>
                  <Text style={styles.empMeta}>
                    {g.code} · {g.department ?? "Unassigned"}
                  </Text>
                </View>
                <Text style={styles.empCount}>
                  {g.rows.filter((r: any) => r.status === "VERIFIED" || r.code).length}/{g.rows.length}
                </Text>
              </View>

              {g.rows.map((r: any) => {
                const thumb = getPhotoUrl(r.photo_thumbnail_url ?? r.photo_url);
                const editing = editCodeId === r.id;
                const notThere = r.status === "NOT_FOUND";
                const notThereEditing = notThereId === r.id;
                const photos: any[] = r.photos ?? [];
                const isVerified = !!r.code;
                return (
                  <View key={r.id} style={styles.rowWrap}>
                    <View style={styles.row}>
                      <View style={styles.rowBody}>
                        <View style={styles.typeChip}>
                          <Text style={styles.typeText}>{r.asset_type_name}</Text>
                        </View>
                        {notThere ? (
                          <View style={styles.notThereBox}>
                            <Text style={styles.notThereTag}>Not there</Text>
                            {r.remark ? <Text style={styles.remarkText}>{r.remark}</Text> : null}
                          </View>
                        ) : isVerified ? (
                          <>
                            <View style={styles.codeRow}>
                              <Text style={styles.codeText}>{r.code}</Text>
                              {r.ocr_confirmed && <Text style={styles.verifiedTag}>✓ OCR</Text>}
                            </View>
                          </>
                        ) : (
                          <Text style={styles.pending}>— No code yet —</Text>
                        )}
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
                                  Alert.alert("Remove photo?", "Remove this photo from the IT asset? (photo is deleted)", [
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

                    {!notThere && (
                      <TouchableOpacity
                        style={styles.photoAdd}
                        onPress={() =>
                          router.push({
                            pathname: "/camera",
                            params: { visitId: id, scanKind: "it", scanTargetId: r.id, plain: "1" },
                          })
                        }
                      >
                        <Text style={styles.photoAddText}>＋ Add Photo</Text>
                      </TouchableOpacity>
                    )}

                    <View style={styles.actions}>
                      {notThere ? (
                        <>
                          <TouchableOpacity
                            style={styles.notThereEditBtn}
                            onPress={() => {
                              setNotThereId(notThereEditing ? null : r.id);
                              setNotThereRemark(r.remark ?? "");
                            }}
                          >
                            <Text style={styles.notThereEditText}>📝 Remark</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.presentBtn}
                            onPress={() =>
                              Alert.alert("Mark as present?", "Reset this asset to normal verification? The 'not there' remark will be cleared.", [
                                { text: "Cancel", style: "cancel" },
                                { text: "Reset", style: "destructive", onPress: () => markPresentMut.mutate(r.id) },
                              ])
                            }
                          >
                            <Text style={styles.presentBtnText}>✓ Mark Present</Text>
                          </TouchableOpacity>
                        </>
                      ) : (
                        <>
                          <TouchableOpacity
                            style={styles.scanBtn}
                            onPress={() =>
                              router.push({
                                pathname: "/camera",
                                params: { visitId: id, scanKind: "it", scanTargetId: r.id },
                              })
                            }
                          >
                            <Text style={styles.scanBtnText}>
                              {r.photo_url ? "📷 Re-photo" : "📷 Photo & Code"}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.editBtn}
                            onPress={() => {
                              setEditCodeId(editing ? null : r.id);
                              setEditCode(r.code ?? "");
                            }}
                          >
                            <Text style={styles.editBtnText}>✏️ Code</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.notThereBtn}
                            onPress={() => {
                              setNotThereId(notThereEditing ? null : r.id);
                              setNotThereRemark("");
                            }}
                          >
                            <Text style={styles.notThereBtnText}>🚫 Not there</Text>
                          </TouchableOpacity>
                        </>
                      )}
                    </View>

                    {notThereEditing && (
                      <View style={styles.editBox}>
                        <TextInput
                          style={styles.remarkInput}
                          placeholder="Remark — why this asset is not there (e.g. not assigned yet, left for repair)"
                          placeholderTextColor="#94a3b8"
                          multiline
                          value={notThereRemark}
                          onChangeText={setNotThereRemark}
                        />
                        <View style={styles.editActions}>
                          <TouchableOpacity
                            style={styles.editCancelBtn}
                            onPress={() => {
                              setNotThereId(null);
                              setNotThereRemark("");
                            }}
                          >
                            <Text style={styles.editCancelText}>Cancel</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.notThereSaveBtn, (saveNotThereMut.isPending || !notThereRemark.trim()) && styles.disabled]}
                            disabled={saveNotThereMut.isPending || !notThereRemark.trim()}
                            onPress={() => saveNotThereMut.mutate({ rowId: r.id, remark: notThereRemark })}
                          >
                            <Text style={styles.notThereSaveText}>
                              {saveNotThereMut.isPending ? "Saving…" : "Confirm Not There"}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}

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
                            onPress={() => saveCodeMut.mutate({ rowId: r.id, code: editCode })}
                          >
                            <Text style={styles.editSaveText}>
                              {saveCodeMut.isPending ? "Saving…" : editCode.trim() ? "Save Code" : "No Code"}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )))}
        </ScrollView>
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
  searchWrap: { marginHorizontal: 16, marginTop: 10 },
  searchInput: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: "#0f172a",
    backgroundColor: "#fff",
    paddingRight: 40,
  },
  searchClear: {
    position: "absolute",
    right: 8,
    top: 0,
    bottom: 0,
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  searchClearText: { color: "#94a3b8", fontSize: 14, fontWeight: "700" },
  group: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#f1f5f9",
    marginHorizontal: 16,
    marginTop: 12,
    padding: 14,
    shadowColor: "#0f172a",
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  groupHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  empName: { fontSize: 15.5, fontWeight: "800", color: "#0f172a" },
  empMeta: { fontSize: 12.5, color: "#64748b", marginTop: 2 },
  empCount: { fontSize: 13, fontWeight: "800", color: "#2563eb" },
  rowWrap: {
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
    paddingTop: 10,
    paddingBottom: 4,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  rowBody: { flex: 1 },
  typeChip: {
    alignSelf: "flex-start",
    backgroundColor: "#eff6ff",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 6,
  },
  typeText: { color: "#1d4ed8", fontSize: 12, fontWeight: "800" },
  codeRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  codeText: { fontFamily: "monospace", fontSize: 13, color: "#0f172a", fontWeight: "600", flexShrink: 1 },
  verifiedTag: { color: "#059669", fontSize: 12, fontWeight: "800" },
  pending: { color: "#94a3b8", fontSize: 13 },
  notThereBox: { gap: 4 },
  notThereTag: {
    alignSelf: "flex-start",
    backgroundColor: "#fee2e2",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    color: "#b91c1c",
    fontSize: 12,
    fontWeight: "800",
    overflow: "hidden",
  },
  remarkText: { fontSize: 12.5, color: "#dc2626", marginTop: 3 },
  thumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: "#e2e8f0" },
  photosCount: { fontSize: 12, color: "#0e7490", fontWeight: "700", marginTop: 4 },
  photoStrip: { marginTop: 8 },
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
    marginTop: 8,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#67e8f9",
    borderRadius: 10,
    paddingVertical: 9,
    alignItems: "center",
    backgroundColor: "#ecfeff",
  },
  photoAddText: { color: "#0e7490", fontSize: 13, fontWeight: "700" },
  actions: { flexDirection: "row", gap: 8, marginTop: 8 },
  scanBtn: {
    flex: 1,
    backgroundColor: "#0891b2",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  scanBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  notThereBtn: {
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: "#fff1f2",
  },
  notThereBtnText: { color: "#dc2626", fontSize: 12, fontWeight: "700" },
  notThereEditBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: "#f8fafc",
  },
  notThereEditText: { color: "#334155", fontSize: 13, fontWeight: "700" },
  presentBtn: {
    flex: 1,
    backgroundColor: "#059669",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
  },
  presentBtnText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  notThereSaveBtn: {
    flex: 1,
    backgroundColor: "#dc2626",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  notThereSaveText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  remarkInput: {
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#0f172a",
    backgroundColor: "#fff",
    marginBottom: 10,
    minHeight: 72,
    textAlignVertical: "top",
  },
  editBtn: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: "#f8fafc",
  },
  editBtnText: { color: "#0e7490", fontSize: 13, fontWeight: "700" },
  editBox: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
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
    backgroundColor: "#0891b2",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
  },
  editSaveText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  disabled: { opacity: 0.6 },
  emptyTitle: { fontSize: 17, fontWeight: "800", color: "#0f172a" },
  emptyText: { fontSize: 13, color: "#64748b", textAlign: "center", marginTop: 6, lineHeight: 20 },
});