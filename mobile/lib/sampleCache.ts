import * as FileSystem from "expo-file-system/legacy";
import { API_URL } from "./api";

/**
 * Sample evidence thumbnails: the server serves a PNG preview of the first
 * PDF page at /static/samples/previews/<stem>.png. We cache these on-device so
 * sample photos render even with zero connectivity (inline thumb + tap-to-view).
 */

export function sampleDocUrl(ref: string): string {
  const base = API_URL.replace(/\/api\/v1\/?$/, "");
  return `${base}/static/samples/${encodeURIComponent(ref)}`;
}

export function samplePreviewUrl(ref: string): string {
  const base = API_URL.replace(/\/api\/v1\/?$/, "");
  const stem = ref.replace(/\.pdf$/i, "");
  return `${base}/static/samples/previews/${encodeURIComponent(stem)}.png`;
}

const DIR = `${FileSystem.documentDirectory}samples/`;

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
  }
}

function stemOf(ref: string): string {
  return ref.replace(/\.pdf$/i, "");
}

/** Download the preview PNG for a sample ref and return its local file uri. */
export async function downloadSamplePreview(ref: string): Promise<string | null> {
  try {
    await ensureDir();
    const dest = `${DIR}${stemOf(ref)}.png`;
    const existing = await FileSystem.getInfoAsync(dest);
    if (existing.exists) return dest;
    await FileSystem.downloadAsync(samplePreviewUrl(ref), dest);
    return dest;
  } catch {
    return null;
  }
}

/** Local uri if already fetched, else null (caller falls back to the remote). */
export async function getCachedSampleUri(ref: string): Promise<string | null> {
  try {
    const dest = `${DIR}${stemOf(ref)}.png`;
    const info = await FileSystem.getInfoAsync(dest);
    return info.exists ? dest : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the best uri for a sample preview: local disk when cached (offline),
 * otherwise the live server URL so the thumbnail always renders online.
 */
export async function resolveSamplePreviewUri(ref: string): Promise<string> {
  const cached = await getCachedSampleUri(ref);
  return cached ?? samplePreviewUrl(ref);
}

/** Warm the cache for a list of sample refs (fire-and-forget). */
export function prefetchSamplePreviews(refs: string[]): void {
  for (const ref of new Set(refs)) {
    if (ref) {
      downloadSamplePreview(ref).catch(() => {});
    }
  }
}