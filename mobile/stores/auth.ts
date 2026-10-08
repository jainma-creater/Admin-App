import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api, getErrorMessage, setCachedToken } from "../lib/api";
import { create } from "zustand";

type AuthState = {
  user: any | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  saveSession: (tokens: { access_token: string; refresh_token: string }) => Promise<void>;
  logout: () => Promise<void>;
  loadSession: () => Promise<void>;
};

// Persist tokens, then load the current user profile into state.
// Shared by login and public self-registration so both auto-log-in.
async function storeSession(
  set: (partial: Partial<AuthState>) => void,
  tokens: { access_token: string; refresh_token: string }
): Promise<void> {
  await SecureStore.setItemAsync("access_token", tokens.access_token);
  await SecureStore.setItemAsync("refresh_token", tokens.refresh_token);
  setCachedToken(tokens.access_token);
  const me = await api.get("/users/me");
  await AsyncStorage.setItem("user", JSON.stringify(me.data));
  set({ user: me.data, isLoading: false });
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  isLoading: true,

  login: async (email: string, password: string) => {
    const { data } = await api.post("/auth/login", { email, password });
    await storeSession(set, data);
  },

  saveSession: (tokens) => storeSession(set, tokens),

  logout: async () => {
    await SecureStore.deleteItemAsync("access_token").catch(() => {});
    await SecureStore.deleteItemAsync("refresh_token").catch(() => {});
    await AsyncStorage.removeItem("user").catch(() => {});
    setCachedToken(null);
    set({ user: null });
  },

  loadSession: async () => {
    // Mark loading done immediately: the boot gate in _layout is bounded by
    // its own timeout. The previous version never cleared isLoading when no
    // cached session existed, leaving the app stuck (white/boot screen forever).
    try {
      const cached = await AsyncStorage.getItem("user");
      const token = await SecureStore.getItemAsync("access_token");
      setCachedToken(token);
      if (cached && token) {
        set({ user: JSON.parse(cached), isLoading: false });
        return;
      }
      if (token) {
        const me = await api.get("/users/me");
        await AsyncStorage.setItem("user", JSON.stringify(me.data));
        setCachedToken(token);
        set({ user: me.data, isLoading: false });
        return;
      }
      set({ user: null, isLoading: false });
    } catch (e) {
      console.warn("[auth] loadSession failed:", getErrorMessage(e));
      set({ user: null, isLoading: false });
    }
  },
}));
