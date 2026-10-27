"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import Cookies from "js-cookie";
import { api } from "./api";

type AuthContextType = {
  user: any | null;
  loading: boolean;
  login: (email: string, password: string, captcha?: { token?: string; honeypot?: string; mouse_events?: string }) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: async () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = Cookies.get("access_token");
    if (token) {
      api
        .get("/users/me")
        .then((res) => setUser(res.data))
        .catch(() => {
          Cookies.remove("access_token");
          Cookies.remove("refresh_token");
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (
    email: string,
    password: string,
    captcha: { token?: string; honeypot?: string; mouse_events?: string } = {},
  ) => {
    const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";
    const { data } = await api.post("/auth/login", {
      email,
      password,
      captcha_token: captcha.token,
      honeypot: captcha.honeypot,
      mouse_events: captcha.mouse_events,
    });
    Cookies.set("access_token", data.access_token, {
      expires: 1 / 24,
      path: "/",
      sameSite: "Lax",
      secure: isHttps,
    });
    Cookies.set("refresh_token", data.refresh_token, {
      expires: 7,
      path: "/",
      sameSite: "Lax",
      secure: isHttps,
    });
    const me = await api.get("/users/me");
    setUser(me.data);
  };

  const logout = () => {
    Cookies.remove("access_token", { path: "/" });
    Cookies.remove("refresh_token", { path: "/" });
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);