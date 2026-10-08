import { Stack, useRouter, useSegments } from "expo-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { View, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useAuth } from "../stores/auth";
import { initOfflineDB } from "../lib/offline";
import { AppErrorBoundary } from "../components/app-error-boundary";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 30 * 1000, // was 5 min — made answered items stay grey for ages
      refetchOnWindowFocus: true,
    },
    mutations: { retry: 0 },
  },
});

const BOOT_TIMEOUT_MS = 4000;

/**
 * Always-mounted shell: handles the auth redirect imperatively instead of
 * conditionally unmounting whole navigator groups. Unmounting the active
 * navigator on auth change was blanking the screen (white screen) because
 * there was briefly nothing to render.
 */
function AuthGate() {
  const { user, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "(auth)";

    if (!user && !inAuthGroup) {
      router.replace("/(auth)/login");
    } else if (user && inAuthGroup) {
      router.replace("/(app)");
    }
  }, [user, isLoading, segments]);

  return null;
}

export default function RootLayout() {
  const { loadSession, isLoading } = useAuth();
  const [ready, setReady] = useState(false);
  const [offlineError, setOfflineError] = useState<string | null>(null);

  useEffect(() => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        setReady(true);
      }
    };

    loadSession(); // async session restore, bounded by the boot timeout below

    const timer = setTimeout(finish, BOOT_TIMEOUT_MS);

    initOfflineDB()
      .then(finish)
      .catch((e: any) => {
        setOfflineError(e?.message || String(e));
        finish();
      });

    return () => clearTimeout(timer);
  }, []);

  if (!ready || isLoading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0f172a",
        }}
      >
        <Text style={{ color: "#94a3b8", marginTop: 16 }}>
          Loading Branch Visit…
        </Text>
        {offlineError && (
          <Text
            style={{
              color: "#f87171",
              fontSize: 12,
              padding: 16,
              textAlign: "center",
            }}
          >
            Offline storage warning: {offlineError}
          </Text>
        )}
      </View>
    );
  }

  return (
    <AppErrorBoundary>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <AuthGate />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(app)" />
            <Stack.Screen name="(auth)" />
          </Stack>
        </QueryClientProvider>
      </SafeAreaProvider>
    </AppErrorBoundary>
  );
}
