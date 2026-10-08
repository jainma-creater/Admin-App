import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useState } from "react";
import { api, getErrorMessage } from "../../../lib/api";
import { useHeaderTop } from "../../../lib/safeArea";

const INPUT_LABELS: { key: string; label: string; placeholder: string; required?: boolean; multiline?: boolean }[] = [
  { key: "name", label: "Branch name *", placeholder: "e.g. Mumbai Andheri", required: true },
  { key: "code", label: "Branch code *", placeholder: "e.g. MUM-003", required: true },
  { key: "city", label: "City", placeholder: "e.g. Mumbai" },
  { key: "state", label: "State", placeholder: "e.g. Maharashtra" },
  { key: "pincode", label: "Pincode", placeholder: "e.g. 400069" },
  { key: "address", label: "Address", placeholder: "Full street address", multiline: true },
  { key: "gst_number", label: "GST number (optional)", placeholder: "e.g. 27AAAAA0000A1Z5" },
];

export default function AddBranch() {
  const router = useRouter();
  const qc = useQueryClient();
  const headerTop = useHeaderTop();
  const [form, setForm] = useState<Record<string, string>>({});

  // First region/area is used automatically (single-org deployments have one).
  const { data: regions } = useQuery({
    queryKey: ["regions"],
    queryFn: async () => (await api.get("/branches/regions")).data,
  });
  const { data: areas } = useQuery({
    queryKey: ["areas"],
    queryFn: async () => (await api.get("/branches/areas")).data,
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const payload: any = {
        name: form.name?.trim(),
        code: form.code?.trim(),
        region_id: regions?.[0]?.id,
        area_id: areas?.[0]?.id,
      };
      for (const key of ["city", "state", "pincode", "address", "gst_number"]) {
        if (form[key]?.trim()) payload[key] = form[key].trim();
      }
      return (await api.post("/branches", payload)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["branches"] });
      qc.invalidateQueries({ queryKey: ["mobile-summary"] });
      Alert.alert("Branch added ✅", "The new branch is now on your Home screen.");
      router.back();
    },
    onError: async (e: any) =>
      Alert.alert("Could not add branch", await getErrorMessage(e)),
  });

  const handleSave = () => {
    if (!form.name?.trim()) {
      Alert.alert("Name required", "Please enter the branch name.");
      return;
    }
    if (!form.code?.trim()) {
      Alert.alert("Code required", "Please enter a short branch code (e.g. MUM-003).");
      return;
    }
    createMut.mutate();
  };

  const set = (key: string) => (v: string) => setForm((f) => ({ ...f, [key]: v }));

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <TouchableOpacity style={[styles.backRow, headerTop]} onPress={() => router.back()}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Add New Branch</Text>
      <Text style={styles.subtitle}>
        It will appear on the Home screen right away.
      </Text>

      {INPUT_LABELS.map((f) => (
        <View key={f.key} style={{ marginTop: 14 }}>
          <Text style={styles.label}>{f.label}</Text>
          <TextInput
            style={[styles.input, f.multiline && styles.inputMulti]}
            value={form[f.key] ?? ""}
            onChangeText={set(f.key)}
            placeholder={f.placeholder}
            placeholderTextColor="#94a3b8"
            multiline={f.multiline}
            autoCapitalize={f.key === "code" ? "characters" : "sentences"}
          />
        </View>
      ))}

      <TouchableOpacity
        style={[styles.saveButton, createMut.isPending && styles.saveDisabled]}
        onPress={handleSave}
        disabled={createMut.isPending}
      >
        {createMut.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.saveText}>＋ Add Branch</Text>
        )}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  backRow: { paddingTop: 12, paddingHorizontal: 16 },
  backText: { color: "#2563eb", fontSize: 15, fontWeight: "600" },
  title: { fontSize: 22, fontWeight: "800", color: "#0f172a", paddingHorizontal: 16, marginTop: 8 },
  subtitle: { fontSize: 13, color: "#64748b", paddingHorizontal: 16, marginTop: 2 },
  label: { fontSize: 12.5, fontWeight: "600", color: "#475569", marginBottom: 6, paddingHorizontal: 16 },
  input: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    marginHorizontal: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: "#0f172a",
  },
  inputMulti: { minHeight: 80, textAlignVertical: "top" },
  saveButton: {
    backgroundColor: "#10b981",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 24,
  },
  saveDisabled: { opacity: 0.6 },
  saveText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
