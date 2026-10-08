import axios from "axios";
import Cookies from "js-cookie";

export const BASE_PATH =
  process.env.NEXT_PUBLIC_BASE_PATH || "/branch-visit";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || `${BASE_PATH}/api/v1`;

export const api = axios.create({
  baseURL: API_URL,
  timeout: 20000,
});

api.interceptors.request.use((config) => {
  const token = Cookies.get("access_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export async function getErrorMessage(error: any): Promise<string> {
  // No HTTP response at all: network-level failure (backend down, wrong port,
  // CORS block, timeout). This is the common "backend is not working" case.
  if (!error.response) {
    if (error?.code === "ECONNABORTED") {
      return "Request timed out. The backend server may be slow or unreachable.";
    }
    return `Cannot reach the backend server at ${API_URL}. Make sure it is running (docker compose up -d) before signing in.`;
  }

  const status = error.response.status;
  const data = error.response.data;

  // A Next.js 404 page (text/html) means the request hit the UI origin but the
  // API proxy / backend was not reachable — surface that clearly.
  if (typeof data === "string" || data instanceof String) {
    const text = String(data).trim();
    if (text.startsWith("<") || text.includes("<!DOCTYPE")) {
      return `The API returned an unexpected page (HTTP ${status}). The backend/API proxy is not reachable right now.`;
    }
    if (!text) return `Request failed (HTTP ${status}).`;
    return text;
  }

  if (data?.detail) {
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) return data.detail.map((d: any) => d.msg).join(", ");
  }
  if (data?.message) return data.message;
  if (status >= 500) return `Server error (HTTP ${status}). Please try again.`;
  if (status === 401) return "Invalid email or password.";
  return `Request failed (HTTP ${status}).`;
}

/**
 * Turn relative backend media paths (`/api/v1/photos/{id}/file`) into absolute
 * URLs. The backend has no proxy on the web app port, so relative paths would
 * otherwise 404 (blank images). Absolute URLs keep working on any port.
 *
 * Native elements (<img>, <a>) can't set Authorization headers, so the access
 * token is appended as `?token=` — the backend's get_current_user_query()
 * explicitly supports this (same approach as the mobile app).
 */
export function getMediaUrl(raw: string | null | undefined): string {
  if (!raw) return "";
  let url: string;
  if (/^(https?:)?\/\//i.test(raw)) {
    url = raw;
  } else if (raw.startsWith("/api/v1")) {
    url = `${BASE_PATH}${raw}`;
  } else if (raw.startsWith(BASE_PATH)) {
    url = raw;
  } else {
    url = `${BASE_PATH}/${raw.replace(/^\//, "")}`;
  }
  const token = Cookies.get("access_token");
  if (!token) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

export const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-slate-400",
  ASSIGNED: "bg-blue-500",
  SCHEDULED: "bg-sky-500",
  IN_PROGRESS: "bg-amber-500",
  SUBMITTED: "bg-purple-500",
  UNDER_REVIEW: "bg-pink-500",
  APPROVED: "bg-emerald-500",
  CLOSED: "bg-emerald-600",
  REJECTED: "bg-red-500",
  REWORK_REQUIRED: "bg-orange-500",
  RESUBMITTED: "bg-purple-500",
};

export const ACTION_STATUS_COLORS: Record<string, string> = {
  OPEN: "bg-red-500",
  IN_PROGRESS: "bg-amber-500",
  COMPLETED: "bg-emerald-500",
  VERIFICATION_PENDING: "bg-purple-500",
  CLOSED: "bg-emerald-600",
  OVERDUE: "bg-red-700",
};