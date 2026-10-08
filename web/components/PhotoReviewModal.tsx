"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage, getMediaUrl } from "@/lib/api";
import { Badge, Button, Input } from "@/components/ui";

const PRESET_REASONS = [
  { key: "BLURRY", label: "📸 Blurry Photo", desc: "Out of focus or blurred; text/details cannot be read." },
  { key: "NOT_VISIBLE", label: "👁️ Not Properly Visible", desc: "Too dark, distant, glary, or obstructed evidence." },
  { key: "WRONG_PHOTO", label: "❌ Wrong Photo", desc: "Incorrect document, asset, or area captured." },
  { key: "INCOMPLETE", label: "📐 Incomplete / Cutoff", desc: "Serial code, name, or board edges are cut off." },
  { key: "OTHER", label: "✍️ Other Reason", desc: "Specify custom feedback in the notes field." },
];

export function PhotoReviewModal({
  photo,
  canReview = true,
  onClose,
  onUpdated,
}: {
  photo: any;
  canReview?: boolean;
  onClose: () => void;
  onUpdated?: (updatedPhoto: any) => void;
}) {
  const qc = useQueryClient();
  const [selectedReason, setSelectedReason] = useState<string>("BLURRY");
  const [customNotes, setCustomNotes] = useState<string>("");
  const [isRejecting, setIsRejecting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fullUrl = getMediaUrl(photo.url || photo.photo_url);
  const downloadUrl = (photo.url || photo.photo_url || "").includes("?")
    ? `${fullUrl}&download=1`
    : `${fullUrl}?download=1`;

  const rejectMut = useMutation({
    mutationFn: async () => {
      const preset = PRESET_REASONS.find((r) => r.key === selectedReason);
      const reasonLabel = preset?.label.replace(/^[^\w]+/, "").trim() || selectedReason;
      return (
        await api.post(`/photos/${photo.id}/reject`, {
          reason: reasonLabel,
          notes: customNotes.trim() || null,
        })
      ).data;
    },
    onSuccess: (updated) => {
      setIsRejecting(false);
      qc.invalidateQueries({ queryKey: ["photos"] });
      qc.invalidateQueries({ queryKey: ["gallery"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      onUpdated?.(updated);
      alert("Photo marked as REJECTED. Notification sent to inspector on mobile.");
      onClose();
    },
    onError: async (e: any) => setError(await getErrorMessage(e)),
  });

  const approveMut = useMutation({
    mutationFn: async () => (await api.post(`/photos/${photo.id}/approve`, {})).data,
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["photos"] });
      qc.invalidateQueries({ queryKey: ["gallery"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      onUpdated?.(updated);
      alert("Photo APPROVED as valid compliance evidence.");
      onClose();
    },
    onError: async (e: any) => setError(await getErrorMessage(e)),
  });

  const isRejected = photo.status === "REJECTED";
  const isAccepted = photo.status === "ACCEPTED" || !photo.status;

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center z-[100] p-4">
      {/* Header bar */}
      <div className="w-full max-w-5xl flex items-center justify-between mb-3 text-white">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <span>📷 Evidence Review</span>
            {isRejected ? (
              <Badge className="bg-red-600 text-white font-bold">⚠️ REJECTED</Badge>
            ) : isAccepted ? (
              <Badge className="bg-emerald-600 text-white font-bold">✓ ACCEPTED</Badge>
            ) : (
              <Badge className="bg-amber-600 text-white font-bold">{photo.status}</Badge>
            )}
          </h3>
          {photo.branch_name && (
            <span className="text-xs text-[#8b949e]">· {photo.branch_name}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <a
            href={downloadUrl}
            className="px-3 py-1.5 bg-[#238636] hover:bg-[#2ea043] rounded-lg text-xs font-semibold text-white transition-colors"
          >
            ⬇ Download
          </a>
          <a
            href={fullUrl}
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] rounded-lg text-xs font-semibold text-[#58a6ff] transition-colors"
          >
            ↗ Open Full Size
          </a>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#21262d] hover:bg-[#30363d] text-[#c9d1d9] text-sm font-bold transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Main content area */}
      <div className="w-full max-w-5xl bg-gh-panel border border-gh-border rounded-2xl overflow-hidden shadow-2xl flex flex-col lg:flex-row max-h-[82vh]">
        {/* Left: Large Photo */}
        <div className="flex-1 bg-black flex items-center justify-center p-3 overflow-hidden min-h-[320px]">
          <img
            src={fullUrl}
            alt={photo.caption || "Evidence photo"}
            className="max-w-full max-h-[74vh] object-contain rounded-lg"
          />
        </div>

        {/* Right: Inspection & Flagging Details Sidebar */}
        <div className="w-full lg:w-96 p-5 border-t lg:border-t-0 lg:border-l border-gh-border bg-gh-canvas flex flex-col justify-between overflow-y-auto space-y-4">
          <div className="space-y-4">
            {/* Metadata */}
            <div className="space-y-2 text-xs">
              {photo.caption && (
                <div>
                  <span className="text-gh-muted block">Caption / Checkpoint:</span>
                  <p className="font-semibold text-white">{photo.caption}</p>
                </div>
              )}
              {photo.uploader_name && (
                <div>
                  <span className="text-gh-muted block">Captured / Uploaded By:</span>
                  <p className="text-white">👤 {photo.uploader_name}</p>
                </div>
              )}
              {photo.created_at && (
                <div>
                  <span className="text-gh-muted block">Timestamp:</span>
                  <p className="text-gh-faint">🕒 {new Date(photo.created_at).toLocaleString()}</p>
                </div>
              )}
              {photo.gps_enabled && photo.latitude && photo.longitude && (
                <div>
                  <span className="text-gh-muted block">GPS Coordinates:</span>
                  <p className="text-[#58a6ff] font-mono text-[11px]">
                    📍 {photo.latitude.toFixed(6)}, {photo.longitude.toFixed(6)}
                  </p>
                </div>
              )}
            </div>

            {/* Rejection Details Banner if already rejected */}
            {isRejected && (
              <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs space-y-1">
                <p className="font-bold text-red-400 flex items-center gap-1.5">
                  <span>⚠️ Evidence Rejection Notice</span>
                </p>
                <p className="text-red-300">
                  <strong>Reason:</strong> {photo.rejection_reason || "Quality issue reported"}
                </p>
                {photo.reviewer_name && (
                  <p className="text-gh-muted text-[11px]">
                    Flagged by: {photo.reviewer_name}{" "}
                    {photo.reviewed_at ? `on ${new Date(photo.reviewed_at).toLocaleDateString()}` : ""}
                  </p>
                )}
              </div>
            )}

            {error && <p className="text-xs text-[#f85149]">{error}</p>}

            {/* Reviewer Action Area */}
            {canReview && (
              <div className="pt-2 border-t border-gh-border space-y-3">
                <h4 className="text-xs font-bold uppercase text-gh-muted tracking-wider">
                  Quality Audit Actions
                </h4>

                {!isRejecting ? (
                  <div className="space-y-2">
                    <button
                      onClick={() => setIsRejecting(true)}
                      className="w-full py-2 px-3 rounded-lg bg-red-600/15 hover:bg-red-600/25 border border-red-500/30 text-red-400 font-semibold text-xs transition-colors text-left flex items-center justify-between"
                    >
                      <span>🚩 Flag as Blurry / Wrong / Reject Photo</span>
                      <span>›</span>
                    </button>
                    {isRejected && (
                      <Button
                        variant="secondary"
                        onClick={() => approveMut.mutate()}
                        disabled={approveMut.isPending}
                        className="w-full text-xs"
                      >
                        ✓ Remove Flag & Approve Photo
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="p-3.5 rounded-xl bg-gh-panel border border-red-500/40 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-red-400">Select Rejection Reason</span>
                      <button
                        onClick={() => setIsRejecting(false)}
                        className="text-xs text-gh-muted hover:text-white"
                      >
                        Cancel
                      </button>
                    </div>

                    <div className="space-y-1.5">
                      {PRESET_REASONS.map((r) => (
                        <label
                          key={r.key}
                          className={`flex items-start gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                            selectedReason === r.key
                              ? "bg-red-500/15 border-red-500/50 text-white"
                              : "bg-gh-canvas border-white/5 text-gh-muted hover:text-white"
                          }`}
                        >
                          <input
                            type="radio"
                            name="reject-reason"
                            checked={selectedReason === r.key}
                            onChange={() => setSelectedReason(r.key)}
                            className="mt-0.5"
                          />
                          <div>
                            <p className="font-semibold">{r.label}</p>
                            <p className="text-[10px] text-gh-faint">{r.desc}</p>
                          </div>
                        </label>
                      ))}
                    </div>

                    <Input
                      label="Notes / Instructions for Inspector"
                      placeholder="e.g. Please take a clear close-up with proper lighting"
                      value={customNotes}
                      onChange={(e) => setCustomNotes(e.target.value)}
                      className="text-xs"
                    />

                    <Button
                      variant="danger"
                      onClick={() => rejectMut.mutate()}
                      disabled={rejectMut.isPending}
                      className="w-full text-xs"
                    >
                      {rejectMut.isPending ? "Sending Notification…" : "🚨 Reject Photo & Notify Inspector"}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-gh-border text-[11px] text-gh-faint text-center">
            Evidence is tracked on the mobile app & audit logs.
          </div>
        </div>
      </div>
    </div>
  );
}
