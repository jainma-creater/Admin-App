import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TextInput,
  Image,
  Modal,
  ScrollView,
  Linking,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { useState, useCallback, useEffect, useRef } from "react";
import { api, getErrorMessage, getPhotoUrl } from "../../../lib/api";
import { getOfflinePhotos, deleteOfflinePhoto, cacheChecklist, getCachedChecklist } from "../../../lib/offline";
import {
  sampleDocUrl,
  samplePreviewUrl,
  getCachedSampleUri,
  downloadSamplePreview,
  prefetchSamplePreviews,
} from "../../../lib/sampleCache";
import DatePickerField from "../../../components/DatePickerField";
import { useHeaderTop } from "../../../lib/safeArea";

const STATUS_META: Record<string, { color: string; label: string }> = {
  OK: { color: "#10b981", label: "OK" },
  NOT_OK: { color: "#ef4444", label: "NOT OK" },
  NA: { color: "#64748b", label: "NA" },
};

import { useAuth } from "../../../stores/auth";

function photoUri(p: any): string | null {
  // Offline-queued photos carry the local file uri directly — no server round
  // trip needed, so they render even with zero connectivity.
  if (p?.offline) return p.uri ?? null;
  const raw = p?.thumbnail_url ?? p?.url ?? null;
  return getPhotoUrl(raw);
}

// Reference sample evidence served from the backend /static mount (e.g.
// notice-board.pdf). Opened in the OS viewer/browser — no token needed.
function sampleUrl(ref: string): string {
  return sampleDocUrl(ref);
}

function openSample(ref: string) {
  Linking.openURL(sampleUrl(ref)).catch(() => {});
}

// Inline sample thumbnail that prefers the on-device cache (offline-friendly)
// and falls back to the live preview URL, with a small remote-download kick so
// the next time it is fully local.
function SampleThumb({ ref, style }: { ref: string; style: any }) {
  const [uri, setUri] = useState<string>(samplePreviewUrl(ref));
  useEffect(() => {
    let active = true;
    getCachedSampleUri(ref).then((local) => {
      if (active) {
        setUri(local ?? samplePreviewUrl(ref));
      }
    });
    downloadSamplePreview(ref);
    return () => {
      active = false;
    };
  }, [ref]);
  return <Image source={{ uri }} style={style} />;
}

export default function Checklist() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const headerTop = useHeaderTop();

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<any>(null);
  const [savedToast, setSavedToast] = useState(false);
  const cameraPushedRef = useRef(false);

  const {
    data: checklist,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["checklist", id],
    queryFn: async () => {
      try {
        const data = (await api.get(`/visits/${id}/checklist`)).data;
        // Keep the last-good checklist so the screen renders offline with the
        // item text + sample refs even when the server is unreachable.
        cacheChecklist(String(id), data).catch(() => {});
        return data;
      } catch (e: any) {
        // Network failure → fall back to the locally cached copy. Only
        // swallow the error when a cache actually exists; otherwise surface it.
        const cached = await getCachedChecklist(String(id));
        if (cached) return cached;
        throw e;
      }
    },
  });

  // Photos refresh when returning from the camera screen
  const { data: photos, refetch: refetchPhotos } = useQuery({
    queryKey: ["visit-photos", id],
    queryFn: async () => (await api.get(`/visits/${id}/photos`)).data,
  });

  useFocusEffect(
    useCallback(() => {
      refetchPhotos();
      // Also refresh checklist counts (progress bar, section x/y) so a return
      // from the camera always shows the true state.
      refetch();
    }, [refetchPhotos, refetch])
  );

  // Warm the sample-preview cache the moment the checklist is available so the
  // thumbnails render instantly on tap and survive offline visits.
  useEffect(() => {
    const refs: string[] = [];
    for (const it of checklist?.items ?? []) {
      for (const r of it.sample_refs ?? []) {
        if (r) refs.push(String(r));
      }
    }
    prefetchSamplePreviews(refs);
  }, [checklist]);

  // Offline-queued photos (uploads that failed when the server was down) are
  // merged into the photo list so they are visible immediately — they live on
  // the phone, not the server. The editor also counts them, so an item with
  // only offline evidence still saves and turns green.
  const [offlinePhotos, setOfflinePhotos] = useState<any[]>([]);
  useFocusEffect(
    useCallback(() => {
      let active = true;
      getOfflinePhotos(String(id))
        .then((rows) => {
          if (active) {
            setOfflinePhotos(
              rows
                .filter((r) => !r.synced_at)
                .map((r) => ({
                  id: r.id,
                  checklist_item_id: r.checklist_item_id,
                  uri: r.uri,
                  offline: true,
                  created_at: r.created_at,
                }))
            );
          }
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }, [id])
  );
  const allPhotos = [...(photos ?? []), ...offlinePhotos];

  const saveMut = useMutation({
    mutationFn: async ({ itemId, payload }: { itemId: string; payload: any }) =>
      (await api.patch(`/visits/${id}/checklist/items/${itemId}`, payload)).data,
    onSuccess: (_data, vars) => {
      // Optimistic: paint the item green/red/grey instantly from the payload
      // the server just accepted — no waiting for a refetch (which the flaky
      // network can stall, leaving a saved item looking unsaved).
      qc.setQueryData<any>(["checklist", id], (old: any) => {
        if (!old?.items) return old;
        return {
          ...old,
          items: old.items.map((it: any) =>
            it.id === vars.itemId
              ? {
                  ...it,
                  ...vars.payload,
                  is_completed: true,
                }
              : it
          ),
        };
      });
      qc.setQueryData<any>(["checklist", id], (old: any) => {
        if (!old?.items) return old;
        const done = old.items.filter((it: any) => it.status).length;
        return { ...old, completed_count: done, total_count: old.total_count ?? old.items.length };
      });
      qc.invalidateQueries({ queryKey: ["checklist", id] });
      qc.invalidateQueries({ queryKey: ["visits"] });
      qc.invalidateQueries({ queryKey: ["visit", id] });
      // "Saved ✓" confirmation so the user knows it stuck (the optimistic
      // paint alone can be missed while scrolling).
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 1600);
    },
    onError: async (e: any) => Alert.alert("Error", await getErrorMessage(e)),
  });

  const deletePhotoMut = useMutation({
    mutationFn: async (photo: any) => {
      if (photo?.offline) {
        await deleteOfflinePhoto(photo.id);
        // Refresh the merged offline list so the thumbnail disappears.
        const rows = await getOfflinePhotos(String(id));
        setOfflinePhotos(
          rows
            .filter((r) => !r.synced_at)
            .map((r) => ({
              id: r.id,
              checklist_item_id: r.checklist_item_id,
              uri: r.uri,
              offline: true,
              created_at: r.created_at,
            }))
        );
        return;
      }
      await api.delete(`/photos/${photo.id}`);
    },
    onSuccess: () => {
      setPreviewPhoto(null);
      refetchPhotos();
    },
    onError: async (e: any) => Alert.alert("Delete failed", await getErrorMessage(e)),
  });

  const confirmDeletePhoto = (photo: any) => {
    Alert.alert("Delete photo?", "This photo will be permanently removed.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deletePhotoMut.mutate(photo) },
    ]);
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Failed to load checklist</Text>
        <Text style={styles.errorDetail}>
          {error instanceof Error ? error.message : String(error)}
        </Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!checklist) return null;

  const itemsAll: any[] = checklist.items ?? [];
  // Role filter: an item with role_tags shows only for users with a matching
  // role; untagged items (no role_tags) are for everyone.
  const myRoles: string[] = (useAuth.getState().user?.roles ?? [])
    .map((r: any) => (typeof r === "string" ? r : r?.name))
    .filter(Boolean);
  const isSuper = myRoles.includes("SUPER_ADMIN");
  const items = isSuper
    ? itemsAll
    : itemsAll.filter(
        (it: any) =>
          !it.role_tags?.length || it.role_tags.some((t: string) => myRoles.includes(t))
      );
  const completedAll = checklist.completed_count ?? 0;
  const totalAll = checklist.total_count ?? 0;
  // Progress reflects what THIS user must answer (role-filtered).
  const completed = items.filter((i: any) => i.status).length;
  const total = items.length;
  const progress = total ? (completed / total) * 100 : 0;
  const selectedItem = items.find((i: any) => i.id === selectedItemId) ?? null;
  const photosFor = (visitItemId: string) =>
    allPhotos.filter((p: any) => p.checklist_item_id === visitItemId);

  // Grouped rows: section headers interleaved with their items
  type Row =
    | { type: "header"; title: string; done: number; count: number; key: string }
    | { type: "item"; item: any; key: string };
  const rows: Row[] = [];
  let currentHeader: (Row & { type: "header" }) | null = null;
  for (const it of items) {
    const sec = it.section_name ?? "Checklist";
    if (!currentHeader || currentHeader.title !== sec) {
      currentHeader = { type: "header", title: sec, done: 0, count: 0, key: `hdr-${sec}` };
      rows.push(currentHeader);
    }
    currentHeader.count += 1;
    if (it.status) currentHeader.done += 1;
    rows.push({ type: "item", item: it, key: it.id });
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <View style={[styles.navRow, headerTop]}>
        <TouchableOpacity onPress={() => router.back()}>
          <Text style={styles.backText}>← Visit</Text>
        </TouchableOpacity>
        <Text style={styles.navTitle}>Checklist</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.progressCard}>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text style={styles.progressLabel}>Checklist Progress</Text>
          <Text style={styles.progressLabel}>
            {total > 0
              ? `${progress.toFixed(0)}% · ${completed}/${total} answered`
              : "Checklist items"}
          </Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
        <TouchableOpacity
          style={styles.allDoneBanner}
          onPress={() => router.push(`/visit/${id}/summary`)}
        >
          <Text style={styles.allDoneText}>
            {total > 0 && completed >= total
              ? "🎉 All items answered — Review & Submit the visit ›"
              : "📝 Review & Submit Visit for Review ›"}
          </Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(row: any) => String(row.key)}
        contentContainerStyle={{ paddingBottom: 32, paddingHorizontal: 16 }}
        renderItem={({ item: row }: { item: any }) => {
          if (row.type === "header") {
            return (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionHeaderText}>{row.title}</Text>
                <Text style={styles.sectionHeaderCount}>
                  {row.done}/{row.count}
                </Text>
              </View>
            );
          }
          return (
            <ItemRow
              item={row.item}
              photosFor={photosFor}
              onOpen={setSelectedItemId}
              onPreview={setPreviewPhoto}
            />
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No checklist items found.</Text>
          </View>
        }
      />

      {selectedItem && (
        <ItemEditor
          item={selectedItem}
          photos={photosFor(selectedItem.id)}
          isSaving={saveMut.isPending}
          onSave={(payload) =>
            saveMut.mutate(
              { itemId: selectedItem.id, payload },
              // Close the sheet only after the server confirms — if the save
              // fails the editor stays open with the user's answers intact.
              { onSuccess: () => setSelectedItemId(null) }
            )
          }
          onClose={() => setSelectedItemId(null)}
          onTakePhoto={() => {
            // Guard: rapid double-taps pushed the camera twice, so closing it
            // once brought the user right back into a second camera. Only one
            // camera trip per press.
            if (cameraPushedRef.current) return;
            cameraPushedRef.current = true;
            setTimeout(() => {
              cameraPushedRef.current = false;
            }, 1200);
            // Keep the editor (and its status/remark state) mounted while the
            // camera screen is open — closing it here wiped the user's answers
            // and the item never got saved after the photo.
            router.push({
              pathname: "/(app)/camera",
              params: { visitId: String(selectedItem.visit_id), itemId: String(selectedItem.id) },
            });
          }}
          onPreviewPhoto={(p: any) => setPreviewPhoto(p)}
        />
      )}

      {/* "Saved ✓" confirmation */}
      {savedToast && (
        <View style={styles.savedToast} pointerEvents="none">
          <Text style={styles.savedToastText}>✓ Saved</Text>
        </View>
      )}

      {/* Full-screen photo preview with delete */}
      <Modal visible={!!previewPhoto} transparent animationType="fade" onRequestClose={() => setPreviewPhoto(null)}>
        <View style={styles.previewOverlay}>
          <View style={styles.previewTop}>
            <TouchableOpacity onPress={() => setPreviewPhoto(null)}>
              <Text style={styles.previewClose}>✕ Close</Text>
            </TouchableOpacity>
            {previewPhoto && (
              <TouchableOpacity onPress={() => confirmDeletePhoto(previewPhoto)}>
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
          {previewPhoto?.status === "REJECTED" && (
            <View style={styles.previewRejectBox}>
              <Text style={styles.previewRejectTitle}>⚠️ PHOTO REJECTED BY REVIEWER</Text>
              <Text style={styles.previewRejectReason}>
                Reason: {previewPhoto.rejection_reason || "Blurry or invalid photo"}
              </Text>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

function ItemRow({
  item,
  photosFor,
  onOpen,
  onPreview,
}: {
  item: any;
  photosFor: (id: string) => any[];
  onOpen: (id: string) => void;
  onPreview: (p: any) => void;
}) {
  const done = !!item.status;
  const isNotOk = item.status === "NOT_OK";
  const itemPhotos = photosFor(item.id);
  const rejectedPhotos = itemPhotos.filter((p: any) => p.status === "REJECTED");
  const hasRejected = rejectedPhotos.length > 0;
  const meta = STATUS_META[item.status];
  return (
    <View
      style={[
        styles.itemCard,
        done && !isNotOk && styles.itemCardOk,
        isNotOk && styles.itemCardNotOk,
        hasRejected && styles.itemCardRejected,
      ]}
    >
      <TouchableOpacity
        style={styles.itemMain}
        onPress={() => onOpen(item.id)}
        activeOpacity={0.7}
      >
        <View
          style={[
            styles.checkCircle,
            { backgroundColor: hasRejected ? "#dc2626" : done ? (meta?.color ?? "#64748b") : "#e2e8f0" },
          ]}
        >
          <Text style={styles.checkIcon}>
            {hasRejected ? "!" : item.status === "OK" ? "✓" : isNotOk ? "✕" : done ? "–" : ""}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.itemName, done && styles.itemNameDone]}>
            {item.item_name}
          </Text>
          {hasRejected ? (
            <Text style={[styles.itemSub, styles.itemSubRejected]}>
              ⚠️ Evidence Rejected ({rejectedPhotos[0].rejection_reason || "Blurry / quality issue"}) · Tap to retake
            </Text>
          ) : done ? (
            <Text style={[styles.itemSub, { color: meta?.color ?? "#64748b" }]}>
              {meta?.label}
              {itemPhotos.length ? ` · 📷 ${itemPhotos.length}` : ""}
              {item.sample_refs?.length ? " · 📎 sample" : ""}
            </Text>
          ) : itemPhotos.length > 0 ? (
            <Text style={[styles.itemSub, styles.itemSubAttention]}>
              📷 {itemPhotos.length} photo attached — tap to finish (status + remark)
            </Text>
          ) : item.photo_allowed === false ? (
            <Text style={styles.itemSub}>Tap to mark Done (no photo needed)</Text>
          ) : item.sample_refs?.length ? (
            <Text style={styles.itemSub}>📎 Sample available — tap to answer</Text>
          ) : (
            <Text style={styles.itemSub}>Tap to answer</Text>
          )}
        </View>
        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>

      {item.sample_refs?.length > 0 && (
        <View style={[styles.thumbRow, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e2e8f0" }]}>
          {item.sample_refs.slice(0, 4).map((ref: string) => (
            <TouchableOpacity key={ref} onPress={() => openSample(ref)} activeOpacity={0.8}>
              <SampleThumb ref={ref} style={styles.thumb} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {itemPhotos.length > 0 && (
        <View style={styles.thumbRow}>
          {itemPhotos.map((p: any) => {
            const uri = photoUri(p);
            const isRej = p.status === "REJECTED";
            return uri ? (
              <TouchableOpacity key={p.id} onPress={() => onPreview(p)} style={styles.thumbWrapper}>
                <Image source={{ uri }} style={[styles.thumb, isRej && styles.thumbRejected]} />
                {isRej && (
                  <View style={styles.thumbRejBadge}>
                    <Text style={styles.thumbRejBadgeText}>✕ Retake</Text>
                  </View>
                )}
              </TouchableOpacity>
            ) : null;
          })}
        </View>
      )}
    </View>
  );
}

function ItemEditor({
  item,
  photos,
  isSaving,
  onSave,
  onClose,
  onTakePhoto,
  onPreviewPhoto,
}: {
  item: any;
  photos: any[];
  isSaving: boolean;
  onSave: (payload: any) => void;
  onClose: () => void;
  onTakePhoto: () => void;
  onPreviewPhoto: (p: any) => void;
}) {
  const [status, setStatus] = useState<string>(item.status ?? "");
  const [remark, setRemark] = useState(item.remark ?? "");
  const [observation, setObservation] = useState(item.observation ?? "");
  const [actionRequired, setActionRequired] = useState(item.action_required ?? "");
  const [targetDate, setTargetDate] = useState(item.target_date ?? "");

  // Auto-save when returning from the camera: the user picked a status and
  // wrote a remark, then went to take the required photo. When they come back
  // the photo is on the server, so everything is ready — save it right away
  // and the item turns green without a second tap.
  const wentToCamera = useRef(false);
  useEffect(() => {
    if (wentToCamera.current && readyToSave && !isSaving) {
      wentToCamera.current = false;
      handleSave();
    }
  });
  const markCameraTrip = () => {
    wentToCamera.current = true;
    onTakePhoto();
  };

  const rejectedPhotos = photos.filter((p: any) => p.status === "REJECTED");
  const hasRejected = rejectedPhotos.length > 0;

  const notOk = status === "NOT_OK";
  const isNa = status === "NA";
  // Items marked photo_allowed=false are "done-only" checkpoints (e.g. "Branch
  // location available on Google") — answer + remark, no photo needed.
  const photoAllowed: boolean = item.photo_allowed !== false;
  // Check if current status requires a photo based on template config
  const photoRequiredForStatus: boolean = photoAllowed && 
    Array.isArray(item.photo_required_on) && item.photo_required_on.includes(status);
  const readyToSave =
    !!status &&
    !!remark.trim() &&
    (!photoRequiredForStatus || photos.length > 0) &&
    (!notOk || (!!observation.trim() && !!actionRequired.trim() && !!targetDate));

  const handleSave = () => {
    if (!status) {
      Alert.alert("Status Required", "Please select OK, NOT OK, or NA.");
      return;
    }
    if (!remark.trim()) {
      Alert.alert("Remark Required", "Please enter a Remark to record your inspection findings.");
      return;
    }
    // Photo evidence required only when the item allows photos AND the current status requires it.
    if (photoRequiredForStatus && photos.length === 0) {
      Alert.alert(
        "Photo Required",
        "Attach at least 1 photo as evidence before saving (tap 📷 Take / attach photo)."
      );
      return;
    }
    if (notOk) {
      if (!observation.trim()) {
        Alert.alert("Observation Required", "Please describe what was observed for this NOT OK item.");
        return;
      }
      if (!actionRequired.trim()) {
        Alert.alert("Action Required", "Please specify the corrective action needed.");
        return;
      }
      if (!targetDate) {
        Alert.alert("Target Date Required", "Please select the target completion date from the calendar.");
        return;
      }
    }

    const payload: any = { status, remark: remark.trim() };
    if (notOk) {
      payload.observation = observation.trim();
      payload.action_required = actionRequired.trim();
      payload.target_date = targetDate || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    }
    onSave(payload);
  };

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={styles.editorOverlay}>
      <View style={styles.editorSheet}>
        <View style={styles.editorHeader}>
          <Text style={styles.editorTitle} numberOfLines={2}>
            {item.item_name}
          </Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Text style={styles.editorClose}>✕</Text>
          </TouchableOpacity>
        </View>
        <ScrollView
          style={{ flexShrink: 1 }}
          contentContainerStyle={{ paddingBottom: 12 }}
          keyboardShouldPersistTaps="always"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
        {item.item_description ? (
          <Text style={styles.editorDesc}>{item.item_description}</Text>
        ) : null}

        {item.sample_refs?.length > 0 && (
          <View style={styles.sampleSection}>
            <Text style={styles.fieldLabel}>Sample photo (how to click) — tap to view</Text>
            <View style={styles.sampleRow}>
              {item.sample_refs.map((ref: string) => (
                <TouchableOpacity
                  key={ref}
                  style={styles.sampleChip}
                  onPress={() => openSample(ref)}
                  activeOpacity={0.8}
                >
                  <SampleThumb ref={ref} style={styles.sampleImage} />
                  <Text style={styles.sampleChipText}>{ref}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {hasRejected && (
          <View style={styles.editorRejectBanner}>
            <Text style={styles.editorRejectTitle}>⚠️ Evidence Rejected by Reviewer</Text>
            <Text style={styles.editorRejectReason}>
              Reason: {rejectedPhotos[0]?.rejection_reason || "Blurry or wrong photo"}
            </Text>
            <Text style={styles.editorRejectHint}>
              Please take a clear replacement photo below to resolve this checkpoint.
            </Text>
          </View>
        )}

        <View style={styles.statusRow}>
          {(["OK", "NOT_OK", "NA"] as const).map((s) => (
            <TouchableOpacity
              key={s}
              onPress={() => setStatus(s)}
              style={[
                styles.largeStatusButton,
                {
                  backgroundColor:
                    status === s ? (STATUS_META[s] ?? { color: "#64748b" }).color : "#f1f5f9",
                  borderColor: status === s ? "transparent" : "#e2e8f0",
                },
              ]}
            >
              <Text
                style={[styles.largeStatusText, { color: status === s ? "#fff" : "#334155" }]}
              >
                {s === "NOT_OK" ? "NOT OK" : s}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {notOk && (
          <View style={styles.notOkFields}>
            <Text style={styles.fieldLabel}>Observation (Required for NOT OK)</Text>
            <TextInput
              style={styles.textArea}
              multiline
              value={observation}
              onChangeText={setObservation}
              placeholder="Describe the issue / defect observed..."
              placeholderTextColor="#94a3b8"
              blurOnSubmit={false}
              returnKeyType="next"
            />
            <Text style={styles.fieldLabel}>Action Required (Required)</Text>
            <TextInput
              style={styles.textArea}
              multiline
              value={actionRequired}
              onChangeText={setActionRequired}
              placeholder="What action is needed to resolve this?"
              placeholderTextColor="#94a3b8"
              blurOnSubmit={false}
              returnKeyType="next"
            />
            <Text style={styles.fieldLabel}>Target Date (Required)</Text>
            <DatePickerField
              value={targetDate}
              onChange={setTargetDate}
              placeholder="Select target date"
              required
            />
          </View>
        )}

        <Text style={styles.fieldLabel}>Remark (Required to confirm answer)</Text>
        <TextInput
          style={styles.textArea}
          multiline
          value={remark}
          onChangeText={setRemark}
          placeholder="Enter detailed inspection remark..."
          placeholderTextColor="#94a3b8"
          blurOnSubmit={false}
          returnKeyType="done"
        />

{photoAllowed ? (
        <TouchableOpacity style={styles.photoButton} onPress={markCameraTrip} activeOpacity={0.7}>
          <Text style={styles.photoButtonText}>
            {photos.length
              ? `📷 Add Another Photo (${photos.length} attached)`
              : photoRequiredForStatus
              ? "📷 Take Photo (Required)"
              : "📷 Take Photo (Optional)"}
          </Text>
        </TouchableOpacity>
      ) : (
        <Text style={{ color: "#64748b", fontSize: 12, marginBottom: 8 }}>
          ✓ No photo needed for this checkpoint — just mark Done and add a remark.
        </Text>
      )}

        {photos.length > 0 && (
          <View style={styles.thumbRow}>
            {photos.map((p: any) => {
              const uri = photoUri(p);
              return uri ? (
                <TouchableOpacity key={p.id} onPress={() => onPreviewPhoto(p)}>
                  <Image source={{ uri }} style={styles.thumb} />
                </TouchableOpacity>
              ) : null;
            })}
          </View>
        )}
        </ScrollView>

        <View style={styles.editorActions}>
          <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.saveButton, (!readyToSave || isSaving) && styles.saveDisabled]}
            onPress={handleSave}
            disabled={!readyToSave || isSaving}
          >
            <Text style={styles.saveText}>
              {isSaving
            ? "Saving..."
            : readyToSave
            ? "✓ Save Answer"
            : !status
            ? "Pick status"
            : !remark.trim()
            ? "Add remark"
            : photoRequiredForStatus && photos.length === 0
            ? "Photo needed"
            : notOk && !targetDate
            ? "Pick target date"
            : "Fill NOT OK details"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    backgroundColor: "#f8fafc",
  },
  backText: { color: "#2563eb", fontSize: 15, fontWeight: "600", width: 60 },
  navTitle: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  progressCard: { paddingHorizontal: 16, paddingBottom: 8 },
  progressLabel: { fontSize: 13, fontWeight: "600", color: "#475569" },
  progressTrack: {
    height: 8,
    backgroundColor: "#e2e8f0",
    borderRadius: 4,
    marginTop: 6,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: "#10b981", borderRadius: 4 },
  allDoneBanner: {
    backgroundColor: "#ecfdf5",
    borderColor: "#6ee7b7",
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  allDoneText: { color: "#047857", fontWeight: "700", fontSize: 13, textAlign: "center" },
  savedToast: {
    position: "absolute",
    bottom: 60,
    alignSelf: "center",
    backgroundColor: "rgba(16,185,129,0.95)",
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 8,
    elevation: 6,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
  },
  savedToastText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 18,
    marginBottom: 2,
    paddingHorizontal: 4,
  },
  sectionHeaderText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#475569",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    flex: 1,
  },
  sectionHeaderCount: {
    fontSize: 12,
    fontWeight: "700",
    color: "#2563eb",
    backgroundColor: "#dbeafe",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: "hidden",
  },
  itemCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    marginTop: 10,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 3,
    elevation: 1,
  },
  itemCardOk: { backgroundColor: "#f0fdf4" },
  itemCardNotOk: { backgroundColor: "#fef2f2" },
  itemCardRejected: { backgroundColor: "#fff1f2", borderWidth: 1.5, borderColor: "#f43f5e" },
  itemMain: { flexDirection: "row", alignItems: "center", padding: 14, gap: 12 },
  checkCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  checkIcon: { color: "#fff", fontSize: 16, fontWeight: "800" },
  itemName: { fontSize: 15, fontWeight: "600", color: "#0f172a", flex: 1 },
  itemNameDone: { color: "#334155" },
  itemSub: { fontSize: 12, color: "#94a3b8", marginTop: 2 },
  itemSubAttention: { color: "#d97706", fontWeight: "600" },
  itemSubRejected: { color: "#e11d48", fontWeight: "700" },
  chevron: { fontSize: 20, color: "#cbd5e1" },
  thumbRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 14,
  },
  thumbWrapper: { position: "relative" },
  thumbButton: {},
  thumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: "#e2e8f0" },
  thumbRejected: { borderWidth: 2, borderColor: "#e11d48" },
  thumbRejBadge: {
    position: "absolute",
    bottom: 2,
    left: 2,
    right: 2,
    backgroundColor: "rgba(225,29,72,0.9)",
    borderRadius: 4,
    paddingVertical: 1,
    alignItems: "center",
  },
  thumbRejBadgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },
  emptyState: { alignItems: "center", paddingVertical: 40 },
  emptyText: { color: "#64748b" },
  errorText: { fontSize: 16, fontWeight: "600", color: "#0f172a" },
  errorDetail: { fontSize: 13, color: "#ef4444", marginTop: 6, marginBottom: 12, textAlign: "center" },
  retryButton: {
    backgroundColor: "#2563eb",
    borderRadius: 10,
    paddingHorizontal: 24,
    paddingVertical: 10,
  },
  retryText: { color: "#fff", fontWeight: "600" },

  editorRejectBanner: {
    backgroundColor: "#ffe4e6",
    borderColor: "#f43f5e",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
    marginBottom: 4,
  },
  editorRejectTitle: { color: "#9f1239", fontSize: 13, fontWeight: "800" },
  editorRejectReason: { color: "#be123c", fontSize: 12, fontWeight: "600", marginTop: 2 },
  editorRejectHint: { color: "#881337", fontSize: 11, marginTop: 4 },

  previewRejectBox: {
    backgroundColor: "rgba(225,29,72,0.92)",
    marginHorizontal: 20,
    marginTop: 10,
    borderRadius: 10,
    padding: 10,
    alignItems: "center",
  },
  previewRejectTitle: { color: "#fff", fontSize: 12, fontWeight: "800" },
  previewRejectReason: { color: "#ffe4e6", fontSize: 11, fontWeight: "600", marginTop: 2 },

  // Editor bottom sheet
  editorOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15,23,42,0.45)",
    justifyContent: "flex-end",
  },
  editorSheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingTop: 14,
    maxHeight: "88%",
  },
  editorHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  editorTitle: { fontSize: 17, fontWeight: "700", color: "#0f172a", flex: 1, paddingRight: 8 },
  editorClose: { fontSize: 20, color: "#64748b", padding: 4 },
  editorDesc: { fontSize: 13, color: "#64748b", marginTop: 4 },
  sampleSection: { marginTop: 12 },
  sampleRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 6 },
  sampleChip: {
    backgroundColor: "#f1f5f9",
    borderColor: "#e2e8f0",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 6,
    alignItems: "center",
    maxWidth: 140,
  },
  sampleImage: {
    width: 120,
    height: 90,
    borderRadius: 6,
    backgroundColor: "#e2e8f0",
  },
  sampleChipText: { color: "#1d4ed8", fontSize: 11, fontWeight: "600", marginTop: 4 },
  statusRow: { flexDirection: "row", gap: 10, marginTop: 14 },
  largeStatusButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
  },
  largeStatusText: { fontWeight: "700", fontSize: 15 },
  notOkFields: { marginTop: 12 },
  fieldLabel: { fontSize: 12, fontWeight: "600", color: "#475569", marginTop: 10, marginBottom: 4 },
  textArea: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    padding: 10,
    minHeight: 60,
    fontSize: 14,
    color: "#0f172a",
    textAlignVertical: "top",
  },
  textInput: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    padding: 10,
    fontSize: 14,
    color: "#0f172a",
  },
  photoButton: {
    backgroundColor: "#eff6ff",
    borderColor: "#bfdbfe",
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 14,
  },
  photoButtonText: { color: "#1d4ed8", fontWeight: "600", fontSize: 14 },
  editorActions: {
    flexDirection: "row",
    gap: 10,
    paddingTop: 14,
    marginTop: 6,
    paddingBottom: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#e2e8f0",
  },
  cancelButton: {
    flex: 1,
    backgroundColor: "#f1f5f9",
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
  },
  cancelText: { color: "#334155", fontWeight: "600" },
  saveButton: {
    flex: 2,
    backgroundColor: "#10b981",
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
  },
  saveDisabled: { backgroundColor: "#a7f3d0" },
  saveText: { color: "#fff", fontWeight: "700" },

  // Photo preview modal
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
