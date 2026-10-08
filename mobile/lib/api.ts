import axios from "axios";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Port the backend is published on (see docker-compose.yml: host 8010 -> container 8000).
 * Port 8000 was already taken on the dev machine by a Supabase stack.
 */
const API_PORT = 8010;

/**
 * Ordered list of API base URLs the app can reach. Requests start on the first
 * candidate and automatically rotate to the next on a network-level failure,
 * so the APK keeps working even if one endpoint (e.g. a LAN IP or a disposable
 * trycloudflare tunnel) goes away.
 *
 * Production build order (baked via eas.json):
 *   1. EXPO_PUBLIC_API_URL            → nginx on the PC's LAN IP (same Wi-Fi)
 *   2. EXPO_PUBLIC_FALLBACK_API_URL   → Cloudflare quick tunnel (anywhere)
 *
 * Dev order falls back to hostUri-derived endpoints + emulator loopback.
 */
function buildBaseCandidates(): string[] {
  const candidates: string[] = [];
  const add = (url?: string | null) => {
    if (!url) return;
    const clean = url.trim().replace(/\/+$/, "");
    if (clean && !candidates.includes(clean)) candidates.push(clean);
  };

  add(process.env.EXPO_PUBLIC_API_URL);
  add(process.env.EXPO_PUBLIC_FALLBACK_API_URL);

  // hostUri is like "192.168.1.20:8081" (Expo Go on a real device)
  // or "localhost:8081" (simulator) while Metro is running.
  const hostUri =
    (Constants.expoConfig as any)?.hostUri ??
    (Constants as any).manifest?.debuggerHost ??
    (Constants as any).manifest2?.extra?.expoClient?.hostUri ??
    null;

  if (typeof hostUri === "string" && hostUri.length > 0) {
    const host = hostUri.split(":")[0];
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      // Real device on the same network: reach the dev machine's nginx (port 80)
      // and the raw backend (port 8010) directly.
      add(`http://${host}/api/v1`);
      add(`http://${host}:${API_PORT}/api/v1`);
    } else if (host === "localhost" && Platform.OS === "android") {
      // Android emulator: host loopback is 10.0.2.2; iOS simulator can use localhost
      add(`http://10.0.2.2/api/v1`);
      add(`http://10.0.2.2:${API_PORT}/api/v1`);
    } else {
      add(`http://localhost:${API_PORT}/api/v1`);
    }
  }

  // Final fallback: Android emulator with no Metro metadata.
  add(`http://10.0.2.2:${API_PORT}/api/v1`);
  return candidates;
}

const BASE_CANDIDATES = buildBaseCandidates();
let activeBaseIndex = 0;

/**
 * The base URL the app is currently set to hit. Photo URLs and the profile
 * page read from here so they follow failover automatically.
 */
export const API_URL: string = BASE_CANDIDATES[0] ?? `http://10.0.2.2:${API_PORT}/api/v1`;

export const api = axios.create({
  baseURL: API_URL,
  timeout: 20000,
  headers: { "Content-Type": "application/json" },
});

/** Rotate to the next base candidate and keep it for subsequent requests. */
function advanceBaseUrl(): string {
  activeBaseIndex = (activeBaseIndex + 1) % BASE_CANDIDATES.length;
  const next = BASE_CANDIDATES[activeBaseIndex];
  api.defaults.baseURL = next;
  return next;
}

// Cached copy of the access token so photo <Image> tags can append ?token=
// (native <Image> cannot set Authorization headers).
let cachedToken: string | null = null;

export function setCachedToken(token: string | null) {
  cachedToken = token;
}

export function getCachedToken(): string | null {
  return cachedToken;
}

async function refreshCachedToken() {
  try {
    cachedToken = await SecureStore.getItemAsync("access_token");
  } catch {
    cachedToken = null;
  }
  return cachedToken;
}

// One-time log so you can see exactly where the app is connecting (check Metro logs)
if (__DEV__) {
  console.log(`[api] Base URL: ${API_URL}`);
}

api.interceptors.request.use(async (config) => {
  try {
    const token = await refreshCachedToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // SecureStore unavailable (rare, e.g. first launch race) — proceed unauthenticated
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;

    // No HTTP status → network-level failure (host unreachable / timeout).
    // If another base endpoint exists, rotate to it and retry once. The app
    // then stays on the working endpoint for subsequent requests.
    if (!status && original && !original._netRetried && BASE_CANDIDATES.length > 1) {
      original._netRetried = true;
      original.baseURL = advanceBaseUrl();
      return api(original);
    }

    // Only attempt refresh for real 401 responses — never for network errors.
    if (status === 401 && original && !original._retry) {
      original._retry = true;
      try {
        const refreshToken = await SecureStore.getItemAsync("refresh_token");
        if (!refreshToken) throw new Error("no refresh token");

        const { data } = await axios.post(`${API_URL}/auth/refresh`, {
          refresh_token: refreshToken,
        });
        await SecureStore.setItemAsync("access_token", data.access_token);
        await SecureStore.setItemAsync("refresh_token", data.refresh_token);
        cachedToken = data.access_token;
        original.headers.Authorization = `Bearer ${data.access_token}`;
        return api(original);
      } catch (refreshError: any) {
        // Only clear the session when the server rejected the refresh token.
        // A network failure here must NOT log the user out (that was causing
        // silent white-screen loops when the backend was briefly unreachable).
        const refreshStatus = refreshError?.response?.status;
        if (refreshStatus === 401 || refreshStatus === 403) {
          await SecureStore.deleteItemAsync("access_token");
          await SecureStore.deleteItemAsync("refresh_token");
          cachedToken = null;
          // Force the app back to the login screen on an expired session.
          // This store import is safe: the Zustand store has no circular dep
          // on this module (it only reads it via useAuth()).
          try {
            const { useAuth } = require("../stores/auth");
            useAuth.getState().logout();
          } catch {
            // ignore — a UI refresh will handle it shortly
          }
        }
      }
    }
    return Promise.reject(error);
  }
);

export async function getErrorMessage(error: any): Promise<string> {
  if (!error.response) {
    const code = error?.code;
    if (code === "ECONNABORTED") {
      return "Request timed out. Is the backend server running and reachable from this device?";
    }
    return `Cannot reach the server at ${API_URL}. Check that the backend is running and your phone is on the same Wi-Fi network.`;
  }
  const data = error.response.data;
  if (typeof data === "string") return data;
  if (data?.detail) {
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) return data.detail.map((d: any) => d.msg).join(", ");
  }
  if (data?.message) return data.message;
  return "Something went wrong.";
}

export function getPhotoUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.startsWith("file://") || raw.startsWith("data:")) {
    return raw;
  }
  if (!raw.startsWith("http://") && !raw.startsWith("https://")) {
    const base = (api.defaults.baseURL ?? API_URL).replace(/\/api\/v1\/?$/, "");
    raw = `${base}/${raw.replace(/^\//, "")}`;
  }
  // The backend file/thumbnail endpoints require a valid access token.
  // Native <Image> can't set headers, so attach it as a query param.
  const token = getCachedToken();
  if (!token) return raw;
  const sep = raw.includes("?") ? "&" : "?";
  return `${raw}${sep}token=${encodeURIComponent(token)}`;
}


