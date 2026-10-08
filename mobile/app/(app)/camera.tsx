import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
  Platform,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CameraView, useCameraPermissions, type CameraType, type FlashMode } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";
import { api, getErrorMessage } from "../../lib/api";
import { savePhotoOffline, getPendingSyncCount } from "../../lib/offline";
import { useNetworkStatus } from "../../lib/nativeNetwork";

export default function CameraScreen() {
  const { visitId, itemId, scanKind, scanTargetId, plain } = useLocalSearchParams<{
    visitId: string;
    itemId?: string;
    scanKind?: string;
    scanTargetId?: string;
    plain?: string;
  }>();
  const router = useRouter();
  const qc = useQueryClient();
  const cameraRef = useRef<CameraView>(null);
  const [photo, setPhoto] = useState<{ uri: string } | null>(null);
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const [facing, setFacing] = useState<CameraType>("back");
  const [flash, setFlash] = useState<FlashMode>("off");

  // "plain" = attach another evidence photo to a fixed asset / IT asset row
  // (no OCR, no code screen) — the flexible multi-photo flow.
  const plainMode = plain === "1";
  const scanMode = !!scanKind && !!scanTargetId && !!visitId;
  const isScanOcr = scanMode && !plainMode;
  const [ocr, setOcr] = useState<{ text: string; confidence: number } | null>(null);
  const [ocrEdit, setOcrEdit] = useState("");

  const [permission, requestPermission] = useCameraPermissions();
  const network = useNetworkStatus();

  const handlePickFromGallery = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: false,
        quality: 1,
      });
      if (!res.canceled && res.assets && res.assets.length > 0) {
        const uri = res.assets[0].uri;
        setPhoto({ uri });
        if (isScanOcr) uploadPhoto(uri);
      }
    } catch (e: any) {
      Alert.alert("Gallery Error", e?.message || "Could not open photo gallery");
    }
  };

  const takePhoto = async () => {
    if (!cameraRef.current) return;
    try {
      const result = await cameraRef.current.takePictureAsync({ quality: 1 });
      if (result && result.uri) {
        setPhoto({ uri: result.uri });
        if (isScanOcr) uploadPhoto(result.uri);
      }
    } catch (e: any) {
      Alert.alert("Camera Error", e?.message ?? "Could not capture image");
    }
  };

  const uploadPhoto = async (uriOverride?: string) => {
    const uri = uriOverride ?? photo?.uri;
    if (!uri || uploading || !visitId) return;
    setUploading(true);

    try {
      // Compress and resize for fast and reliable upload. Code-plate scans
      // (isScanOcr) keep full resolution: server-side OCR reads small printed
      // text, and downscaling to 1280px destroys it. Evidence-only photos use
      // the smaller size for fast uploads on weak connections.
      const manip = isScanOcr
        ? await ImageManipulator.manipulateAsync(
            uri,
            [],
            { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG }
          )
        : await ImageManipulator.manipulateAsync(
            uri,
            [{ resize: { width: 1280 } }],
            { compress: 0.75, format: ImageManipulator.SaveFormat.JPEG }
          );

      const fileName = `photo-${Date.now()}.jpg`;
      const fileUri = manip.uri;

      // Construct FormData for multipart upload. Expo SDK 57's WinterCG fetch
      // cannot serialize React Native `{ uri, name, type }` file parts and
      // throws "Unsupported FormDataPart implementation". Use axios (XHR
      // adapter) — the exact path the offline sync queue already relies on.
      const form = new FormData();
      // React Native FormData expects the file object with uri, name, type
      const fileObj = {
        uri: Platform.OS === "ios" ? fileUri.replace("file://", "") : fileUri,
        name: fileName,
        type: "image/jpeg",
      } as any;
      form.append("file", fileObj);

      if (itemId) {
        form.append("checklist_item_id", itemId);
      }
      if (caption.trim()) {
        form.append("caption", caption.trim());
      }
      form.append("captured_at", new Date().toISOString());

      const endpoint = scanMode
        ? `/visits/${visitId}/${
            scanKind === "asset" ? "assets" : "it-assets"
          }/${scanTargetId}/${plainMode ? "photos" : "code-photo"}`
        : `/visits/${visitId}/photos`;

      // axios adds the Bearer token via its request interceptor (and auto-renews
      // on 401), then dials the API with the same 60s deadline as before.
      const res = await api.post(endpoint, form, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 60000,
      });

      // Asset code-plate scan: the server stored the photo AND ran OCR. Surface
      // the editable code box so the inspector verifies/edits the extracted code
      // or types one manually (code is optional — photo is already saved).
      if (isScanOcr) {
        const scanned = res.data;
        setOcr({ text: scanned.ocr_text ?? "", confidence: scanned.ocr_confidence ?? 0 });
        setOcrEdit(scanned.ocr_text ?? "");
        setUploading(false);
        return;
      }

      // Success — update the app's shared photo cache IMMEDIATELY so the
      // checklist screen sees the photo the moment we return (no waiting on a
      // network refetch that this Wi-Fi can stall). This is what makes the
      // editor's Save button enable and the item turn green on first save.
      try {
        const uploaded = res.data;
        for (const key of [["visit-photos", visitId], ["photos", visitId]]) {
          qc.setQueryData<any>(key, (old: any) => {
            const list = Array.isArray(old) ? old : [];
            if (list.some((p) => p?.id === uploaded?.id)) return list;
            return [uploaded, ...list];
          });
        }
      } catch {
        // Non-JSON body: fall back to refetch on focus as before.
      }

      // Success -> refresh the asset/IT lists so newly added evidence shows
      // up immediately when we return (plain + scan mode both).
      if (scanMode) {
        qc.invalidateQueries({ queryKey: ["visit-assets", visitId] });
        qc.invalidateQueries({ queryKey: ["visit-it-assets", visitId] });
      }

      // Success -> navigate back immediately
      router.back();
    } catch (e: any) {
      setUploading(false);

      // Simple retry prompt — with automatic offline save so the photo is
      // never lost when the server is unreachable.
      const timedOut = e?.code === "ECONNABORTED" || e?.name === "AbortError";
      const msg = timedOut
        ? "Upload timed out — check your connection and try again."
        : await getErrorMessage(e);
      const buttons: any[] = isScanOcr
        ? [
            { text: "Retry", onPress: uploadPhoto },
            { text: "Cancel", style: "cancel" },
          ]
        : [
            {
              text: "Save Offline",
              onPress: async () => {
                try {
                  // Copy out of the camera's volatile cache into persistent
                  // storage — Android clears the cache and the photo would be
                  // lost before sync could run.
                  const fileName = `photo-${Date.now()}.jpg`;
                  const dest = `${FileSystem.documentDirectory}${fileName}`;
                  await FileSystem.copyAsync({ from: uri, to: dest });
                  await savePhotoOffline({
                    id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    visit_id: visitId,
                    checklist_item_id: itemId,
                    asset_id:
                      plainMode && scanKind === "asset" ? scanTargetId : undefined,
                    it_asset_row_id:
                      plainMode && scanKind === "it" ? scanTargetId : undefined,
                    uri: dest,
                    file_name: fileName,
                    mime_type: "image/jpeg",
                    file_size: 0,
                    uploaded: 0,
                    caption: caption.trim() || undefined,
                  });
                  const n = await getPendingSyncCount();
                  Alert.alert(
                    "Saved offline ✅",
                    `Photo stored on this device and will upload automatically when the server is reachable (${n} item(s) pending).`,
                    [{ text: "OK", onPress: () => router.back() }]
                  );
                } catch (saveErr: any) {
                  Alert.alert("Error", saveErr?.message || "Could not save offline.");
                }
              },
            },
            { text: "Retry", onPress: uploadPhoto },
            { text: "Cancel", style: "cancel" },
          ];
      Alert.alert("Upload failed", msg, buttons);
    }
  };

  const publishScan = async (finalCode: string) => {
    if (!scanMode) return;
    setUploading(true);
    try {
      const patchUrl = `/visits/${visitId}/${
        scanKind === "asset" ? "assets" : "it-assets"
      }/${scanTargetId}`;
      await api.patch(patchUrl, {
        code: finalCode || null,
        ocr_confirmed: !!finalCode,
      });
      qc.invalidateQueries({ queryKey: ["visit-assets", visitId] });
      qc.invalidateQueries({ queryKey: ["visit-it-assets", visitId] });
      router.back();
    } catch (e: any) {
      setUploading(false);
      Alert.alert("Save failed", await getErrorMessage(e), [
        { text: "Retry", onPress: () => publishScan(finalCode) },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  };

  const toggleFlash = () => {
    setFlash((current) => (current === "off" ? "on" : current === "on" ? "auto" : "off"));
  };

  const toggleFacing = () => {
    setFacing((current) => (current === "back" ? "front" : "back"));
  };

  // --- Web & Permissions Fallbacks ---
  if (Platform.OS === "web") {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={styles.permTitle}>Camera / Gallery</Text>
        <Text style={styles.permText}>Select a photo from your files to attach as evidence.</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={handlePickFromGallery}>
          <Text style={styles.primaryButtonText}>📂 Choose File from Computer</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.secondaryButton, { marginTop: 12 }]} onPress={() => router.back()}>
          <Text style={styles.secondaryButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!permission) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={[styles.container, styles.center]}>
        <Text style={{ fontSize: 40, marginBottom: 16 }}>📷</Text>
        <Text style={styles.permTitle}>Camera Permission Required</Text>
        <Text style={styles.permText}>
          Branch Visit needs camera access to capture inspection photo evidence.
        </Text>
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={async () => {
            const res = await requestPermission();
            if (!res.granted && res.canAskAgain === false) {
              Alert.alert(
                "Permission Denied",
                "Enable camera permissions in your device Settings to take photos.",
                [{ text: "OK" }]
              );
            }
          }}
        >
          <Text style={styles.primaryButtonText}>Grant Camera Access</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.secondaryButton, { marginTop: 12 }]} onPress={handlePickFromGallery}>
          <Text style={styles.secondaryButtonText}>📂 Choose from Gallery Instead</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 18 }}>
          <Text style={styles.cancelLink}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {!network.isConnected && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>
            ⚠️ Offline — photos will be saved on the device and uploaded automatically when the server is reachable.
          </Text>
        </View>
      )}
      {!photo ? (
        <>
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing={facing}
            flash={flash}
          >
            {isScanOcr && (
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                {/* Framing guide: a horizontal band where the printed code plate
                    should sit. Keep the plate inside the band and fill it — the
                    OCR reads small text, so closeness matters more than the
                    whole asset being visible. */}
                <View style={styles.guideDimTop} />
                <View style={styles.guideBand}>
                  <View style={styles.guideCornerTL} />
                  <View style={styles.guideCornerTR} />
                  <View style={styles.guideCornerBL} />
                  <View style={styles.guideCornerBR} />
                  <Text style={styles.guideText}>
                    Fill this band with the code plate · hold steady
                  </Text>
                </View>
                <View style={styles.guideDimBottom} />
              </View>
            )}
          </CameraView>

          {/* Top Controls Bar */}
          <View style={styles.topBar}>
            <TouchableOpacity style={styles.iconCircle} onPress={() => router.back()}>
              <Text style={styles.iconText}>✕</Text>
            </TouchableOpacity>

            <View style={styles.topRightControls}>
              <TouchableOpacity style={styles.iconCircle} onPress={toggleFlash}>
                <Text style={styles.iconText}>
                  {flash === "on" ? "⚡ On" : flash === "auto" ? "⚡ Auto" : "⚡ Off"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Bottom Capture Bar */}
          <View style={styles.bottomBar}>
            <TouchableOpacity style={styles.sideButton} onPress={handlePickFromGallery}>
              <Text style={{ fontSize: 24 }}>🖼️</Text>
              <Text style={styles.sideButtonText}>Gallery</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.shutterOuter} onPress={takePhoto} activeOpacity={0.7}>
              <View style={styles.shutterInner} />
            </TouchableOpacity>

            <TouchableOpacity style={styles.sideButton} onPress={toggleFacing}>
              <Text style={{ fontSize: 24 }}>🔄</Text>
              <Text style={styles.sideButtonText}>Flip</Text>
            </TouchableOpacity>
          </View>
        </>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.previewContainer}
        >
          <Image source={{ uri: photo.uri }} style={styles.previewImage} resizeMode="contain" />

          <View style={styles.previewBottomSheet}>
            {isScanOcr ? (
              <>
                <Text style={styles.ocrTitle}>📷 Photo captured · enter code</Text>
                <Text style={styles.ocrSubtitle}>
                  {uploading || !ocr
                    ? "Uploading the photo and reading the code plate…"
                    : ocr.text
                      ? `Code extracted by OCR (${ocr.confidence.toFixed(0)}% confidence). Verify it below or correct it if needed.`
                      : "No code could be read automatically. Type the code manually if it exists, or leave the box empty."}
                </Text>
                {uploading && !ocr && (
                  <View style={styles.ocrLoading}>
                    <ActivityIndicator color="#2563eb" size="small" />
                    <Text style={styles.ocrLoadingText}>Analyzing code plate…</Text>
                  </View>
                )}
                <TextInput
                  style={styles.captionInput}
                  placeholder="Asset code (optional — type or verify extracted)"
                  placeholderTextColor="#64748b"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  value={ocrEdit}
                  onChangeText={setOcrEdit}
                  maxLength={120}
                />
                <View style={styles.previewActionRow}>
                  <TouchableOpacity
                    style={styles.retakeBtn}
                    onPress={() => {
                      setOcr(null);
                      setOcrEdit("");
                      setPhoto(null);
                    }}
                    disabled={uploading}
                  >
                    <Text style={styles.retakeBtnText}>↺ Re-scan</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.saveBtn, uploading && styles.saveBtnDisabled]}
                    onPress={() => publishScan(ocrEdit.trim())}
                    disabled={uploading}
                  >
                    {uploading ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.saveBtnText}>
                        {ocrEdit.trim() ? "✓ Save Code" : "✓ Save Photo Only"}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
                <Text style={styles.ocrHint}>The photo is saved. Code is optional — leave empty to save the photo only.</Text>
              </>
            ) : (
              <>
                <TextInput
                  style={styles.captionInput}
                  placeholder={isScanOcr ? "Optional note (e.g. brand / location)…" : "Add optional caption or note..."}
                  placeholderTextColor="#94a3b8"
                  value={caption}
                  onChangeText={setCaption}
                  maxLength={200}
                />

                <View style={styles.previewActionRow}>
                  <TouchableOpacity
                    style={styles.retakeBtn}
                    onPress={() => setPhoto(null)}
                    disabled={uploading}
                  >
                    <Text style={styles.retakeBtnText}>↺ Retake</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.saveBtn, uploading && styles.saveBtnDisabled]}
                    onPress={() => uploadPhoto()}
                    disabled={uploading}
                  >
                    {uploading ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.saveBtnText}>{isScanOcr ? "🔍 Scan Code" : "✓ Save Photo"}</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#090d16" },
  center: { alignItems: "center", justifyContent: "center", padding: 28 },

  offlineBanner: {
    position: "absolute",
    top: Platform.OS === "ios" ? 50 : 28,
    left: 12,
    right: 12,
    backgroundColor: "rgba(217,119,6,0.95)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    zIndex: 30,
  },
  offlineBannerText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },

  topBar: {
    position: "absolute",
    top: Platform.OS === "ios" ? 54 : 32,
    left: 16,
    right: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 20,
  },
  topRightControls: {
    flexDirection: "row",
    gap: 10,
  },
  iconCircle: {
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  iconText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },

  bottomBar: {
    position: "absolute",
    bottom: Platform.OS === "ios" ? 40 : 28,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingHorizontal: 20,
    zIndex: 20,
  },
  sideButton: {
    alignItems: "center",
    justifyContent: "center",
    width: 68,
  },
  sideButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
  },
  shutterOuter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "transparent",
    borderWidth: 5,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: "#ffffff",
  },

  previewContainer: {
    flex: 1,
    backgroundColor: "#090d16",
    justifyContent: "space-between",
  },
  previewImage: {
    flex: 1,
    width: "100%",
  },
  previewBottomSheet: {
    backgroundColor: "#0f172a",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    paddingBottom: Platform.OS === "ios" ? 34 : 20,
  },
  captionInput: {
    backgroundColor: "#1e293b",
    color: "#fff",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 14,
  },
  ocrTitle: { color: "#fff", fontSize: 17, fontWeight: "800", marginBottom: 4 },
  ocrSubtitle: { color: "#94a3b8", fontSize: 12.5, marginBottom: 14, lineHeight: 18 },
  ocrLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#1e293b",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
  },
  ocrLoadingText: { color: "#cbd5e1", fontSize: 13, fontWeight: "600" },
  ocrHint: { color: "#64748b", fontSize: 11.5, marginTop: 10, textAlign: "center" },
  previewActionRow: {
    flexDirection: "row",
    gap: 12,
  },
  retakeBtn: {
    flex: 1,
    backgroundColor: "#1e293b",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
  },
  retakeBtnText: {
    color: "#cbd5e1",
    fontSize: 15,
    fontWeight: "700",
  },
  saveBtn: {
    flex: 1,
    backgroundColor: "#2563eb",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  saveBtnDisabled: {
    opacity: 0.7,
  },
  saveBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },

  permTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 8,
  },
  permText: {
    color: "#94a3b8",
    fontSize: 14,
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 20,
  },
  primaryButton: {
    backgroundColor: "#2563eb",
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 14,
    width: "100%",
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  secondaryButton: {
    backgroundColor: "#1e293b",
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 14,
    width: "100%",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
  },
  secondaryButtonText: {
    color: "#cbd5e1",
    fontSize: 15,
    fontWeight: "600",
  },
  cancelLink: {
    color: "#94a3b8",
    fontSize: 14,
    fontWeight: "600",
  },
  // --- OCR framing guide (code-plate scans) ---
  guideDimTop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "34%",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  guideDimBottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    top: "66%",
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  guideBand: {
    position: "absolute",
    top: "34%",
    height: "32%",
    left: 18,
    right: 18,
    borderWidth: 2,
    borderColor: "#38bdf8",
    borderRadius: 16,
    backgroundColor: "rgba(56,189,248,0.06)",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 8,
    overflow: "visible",
  },
  guideCornerTL: {
    position: "absolute",
    top: -3,
    left: -3,
    width: 22,
    height: 22,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    borderColor: "#7dd3fc",
    borderTopLeftRadius: 16,
  },
  guideCornerTR: {
    position: "absolute",
    top: -3,
    right: -3,
    width: 22,
    height: 22,
    borderTopWidth: 4,
    borderRightWidth: 4,
    borderColor: "#7dd3fc",
    borderTopRightRadius: 16,
  },
  guideCornerBL: {
    position: "absolute",
    bottom: -3,
    left: -3,
    width: 22,
    height: 22,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
    borderColor: "#7dd3fc",
    borderBottomLeftRadius: 16,
  },
  guideCornerBR: {
    position: "absolute",
    bottom: -3,
    right: -3,
    width: 22,
    height: 22,
    borderBottomWidth: 4,
    borderRightWidth: 4,
    borderColor: "#7dd3fc",
    borderBottomRightRadius: 16,
  },
  guideText: {
    position: "absolute",
    bottom: -26,
    alignSelf: "center",
    color: "#7dd3fc",
    fontSize: 12,
    fontWeight: "600",
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    overflow: "hidden",
  },
});
