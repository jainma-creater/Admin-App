import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import {
  getSyncSummary,
  syncAll,
  getPendingSyncCount,
} from "../../lib/offline";
import { useHeaderTop } from "../../lib/safeArea";

export default function PendingSyncScreen() {
  const router = useRouter();
  const headerTop = useHeaderTop();
  const [summary, setSummary] = useState<any>(null);
  const [pending, setPending] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [s, c] = await Promise.all([getSyncSummary(), getPendingSyncCount()]);
      setSummary(s);
      setPending(c);
    } catch {
      setSummary({ visits: { pending: 0, failed: 0 }, items: { pending: 0, failed: 0 }, photos: { pending: 0, failed: 0 }, actions: { pending: 0, failed: 0 }, errors: [] });
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleSyncAll = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setResult(null);
    try {
      const res = await syncAll();
      setResult(`Synced ${res.success} item(s). ${res.failed ? `${res.failed} still pending.` : "All caught up!"}`);
    } catch (e: any) {
      setResult(e?.message || "Sync failed.");
    } finally {
      setIsSyncing(false);
      await refresh();
    }
  };

  const rows = [
    { key: "Visits", ...(summary?.visits ?? { pending: 0, failed: 0 }) },
    { key: "Checklist items", ...(summary?.items ?? { pending: 0, failed: 0 }) },
    { key: "Photos", ...(summary?.photos ?? { pending: 0, failed: 0 }) },
    { key: "Actions", ...(summary?.actions ?? { pending: 0, failed: 0 }) },
  ];

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={["#1e3a8a", "#2563eb", "#3b82f6"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.hero, headerTop]}
      >
        <View style={styles.topRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Pending Sync</Text>
          <View style={{ width: 34 }} />
        </View>
        <Text style={styles.subtitle}>
          {pending === 0
            ? "Everything is up to date."
            : `${pending} local change${pending === 1 ? "" : "s"} waiting for the server`}
        </Text>
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        {isSyncing && (
          <View style={styles.syncingRow}>
            <ActivityIndicator color="#2563eb" size="small" />
            <Text style={styles.syncingText}>Syncing offline queue...</Text>
          </View>
        )}
        {result ? (
          <View style={[styles.resultCard, result.includes("still pending") ? styles.resultWarn : styles.resultOk]}>
            <Text style={[styles.resultText, result.includes("still pending") ? { color: "#92400e" } : { color: "#065f46" }]}>
              {result}
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={styles.syncAllButton}
          activeOpacity={0.85}
          onPress={handleSyncAll}
          disabled={isSyncing || pending === 0}
        >
          <Text style={styles.syncAllText}>🔄 Sync Now</Text>
        </TouchableOpacity>

        <Text style={styles.sectionLabel}>Offline queue</Text>

        {rows.map((r: any) => {
          const has = r.pending > 0 || r.failed > 0;
          return (
            <View key={r.key} style={[styles.row, !has && styles.rowMuted]}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{r.key}</Text>
                {r.failed > 0 ? (
                  <Text style={styles.rowFailed}>{r.failed} failed</Text>
                ) : (
                  <Text style={styles.rowMeta}>{r.pending > 0 ? `${r.pending} pending` : "synced"}</Text>
                )}
              </View>
              <View style={[styles.dot, r.failed > 0 ? styles.dotFailed : r.pending > 0 ? styles.dotPending : styles.dotOk]} />
            </View>
          );
        })}

        {(summary?.errors?.length ?? 0) > 0 && (
          <>
            <Text style={styles.sectionLabel}>Last errors</Text>
            <View style={styles.errorCard}>
              {summary.errors.slice(0, 10).map((err: string, i: number) => (
                <Text key={i} style={styles.errorLine} numberOfLines={3}>
                  • {err}
                </Text>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc" },
  hero: {
    paddingHorizontal: 18,
    paddingTop: Platform.OS === "ios" ? 54 : 36,
    paddingBottom: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  backText: { color: "#fff", fontSize: 22, lineHeight: 24, fontWeight: "700" },
  title: { color: "#fff", fontSize: 20, fontWeight: "800" },
  subtitle: { color: "#bfdbfe", fontSize: 13, marginTop: 6, textAlign: "center" },

  syncingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  syncingText: { color: "#2563eb", fontWeight: "600", fontSize: 13 },

  resultCard: { borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1 },
  resultOk: { backgroundColor: "#ecfdf5", borderColor: "#a7f3d0" },
  resultWarn: { backgroundColor: "#fffbeb", borderColor: "#fde68a" },
  resultText: { fontSize: 13, fontWeight: "600" },

  syncAllButton: {
    backgroundColor: "#2563eb",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    shadowColor: "#2563eb",
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 3,
  },
  syncAllText: { color: "#fff", fontSize: 15, fontWeight: "800" },

  sectionLabel: {
    fontSize: 13,
    fontWeight: "800",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginTop: 22,
    marginBottom: 8,
  },

  row: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#f1f5f9",
  },
  rowMuted: { opacity: 0.55 },
  rowTitle: { fontSize: 15, fontWeight: "700", color: "#0f172a" },
  rowMeta: { fontSize: 12.5, color: "#94a3b8", marginTop: 2 },
  rowFailed: { fontSize: 12.5, color: "#b91c1c", marginTop: 2, fontWeight: "600" },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotOk: { backgroundColor: "#10b981" },
  dotPending: { backgroundColor: "#f59e0b" },
  dotFailed: { backgroundColor: "#ef4444" },

  errorCard: { backgroundColor: "#fef2f2", borderColor: "#fecaca", borderWidth: 1, borderRadius: 12, padding: 12 },
  errorLine: { fontSize: 12, color: "#991b1b", marginBottom: 6 },
});