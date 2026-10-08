"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, getMediaUrl } from "@/lib/api";
import { Card, Spinner, EmptyState, Select, Badge } from "@/components/ui";
import { PhotoReviewModal } from "@/components/PhotoReviewModal";
import { useAuth } from "@/lib/auth";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function GalleryPage() {
  const { user } = useAuth();
  const canReview = !!user &&
    ["SUPER_ADMIN", "ADMIN", "HOD", "REGIONAL_ADMIN", "AUDITOR"].some((r) =>
      (user.roles ?? []).some((x: any) => x.name === r)
    );

  const [branchId, setBranchId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedPhoto, setSelectedPhoto] = useState<any | null>(null);

  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: async () => (await api.get("/branches?limit=200")).data,
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["gallery", branchId, statusFilter],
    queryFn: async () => {
      const params: any = { limit: 200 };
      if (branchId) params.branch_id = branchId;
      return (await api.get("/photos", { params })).data;
    },
  });

  const filteredPhotos = (data ?? []).filter((p: any) => {
    if (!statusFilter) return true;
    if (statusFilter === "REJECTED") return p.status === "REJECTED";
    if (statusFilter === "ACCEPTED") return p.status === "ACCEPTED" || !p.status;
    return true;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Evidence Gallery & Quality Audit</h1>
          <p className="text-xs text-gh-muted mt-0.5">
            Click any photo to inspect high-resolution evidence, approve, or flag blurry/wrong photos to notify inspectors on mobile.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-40 text-xs"
          >
            <option value="">All Review Status</option>
            <option value="ACCEPTED">✓ Accepted Evidence</option>
            <option value="REJECTED">⚠️ Rejected / Blurry</option>
          </Select>

          <Select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="w-48 text-xs"
          >
            <option value="">All branches</option>
            {(branches.data ?? []).map((b: any) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {isLoading ? (
        <Spinner />
      ) : !filteredPhotos.length ? (
        <Card className="p-5">
          <EmptyState message="No photo evidence matching the selected filter." />
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {filteredPhotos.map((p: any) => {
            const isRejected = p.status === "REJECTED";
            const downloadUrl = (p.url || "").includes("?")
              ? `${getMediaUrl(p.url)}&download=1`
              : `${getMediaUrl(p.url)}?download=1`;

            return (
              <div
                key={p.id}
                onClick={() => setSelectedPhoto(p)}
                className={`group relative block rounded-xl overflow-hidden border cursor-pointer transition-all shadow-md hover:shadow-xl ${
                  isRejected
                    ? "border-red-500/50 bg-red-950/20 hover:border-red-400"
                    : "border-gh-border bg-gh-panel hover:border-blue-500/60"
                }`}
              >
                <div className="aspect-square relative overflow-hidden bg-black">
                  <img
                    src={getMediaUrl(p.thumbnail_url ?? p.url)}
                    alt={p.caption || "Evidence photo"}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                  />
                  {/* Status chip over image */}
                  <div className="absolute top-2 left-2 flex gap-1">
                    {isRejected ? (
                      <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-red-600/90 text-white shadow">
                        ⚠️ Rejected
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-emerald-600/90 text-white shadow">
                        ✓ OK
                      </span>
                    )}
                  </div>
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <span className="text-white text-xs font-bold bg-black/60 px-2 py-1 rounded-md">
                      🔍 Inspect / Review
                    </span>
                  </div>
                </div>

                <div className="p-2.5 space-y-1">
                  {p.branch_name && (
                    <p className="text-xs font-semibold text-gh-text truncate">{p.branch_name}</p>
                  )}
                  {isRejected && p.rejection_reason && (
                    <p className="text-[11px] font-medium text-red-400 truncate" title={p.rejection_reason}>
                      Reason: {p.rejection_reason}
                    </p>
                  )}
                  {p.uploader_name && (
                    <p className="text-[10px] text-gh-muted truncate">👤 {p.uploader_name}</p>
                  )}
                  <p className="text-[10px] text-gh-faint truncate">
                    🕒 {formatDate(p.created_at)}
                  </p>
                  {p.caption && (
                    <p className="text-[10px] text-gh-muted truncate italic">{p.caption}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedPhoto && (
        <PhotoReviewModal
          photo={selectedPhoto}
          canReview={canReview}
          onClose={() => setSelectedPhoto(null)}
          onUpdated={() => refetch()}
        />
      )}
    </div>
  );
}
