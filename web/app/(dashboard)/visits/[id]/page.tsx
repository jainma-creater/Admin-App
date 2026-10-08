"use client";

import { useState, useRef, useEffect, type ChangeEvent } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { api, getErrorMessage, getMediaUrl, STATUS_COLORS } from "@/lib/api";
import { Card, Badge, Button, Input, Spinner, EmptyState } from "@/components/ui";
import { PhotoReviewModal } from "@/components/PhotoReviewModal";
import { useAuth } from "@/lib/auth";

const ROLE_BADGE_COLORS: Record<string, string> = {
  ADMIN: "bg-[#2f81f7]/12 text-[#58a6ff] border-[#58a6ff]/25",
  HR: "bg-[#3fb950]/12 text-[#3fb950] border-[#3fb950]/25",
  OPS: "bg-[#d29922]/12 text-[#d29922] border-[#d29922]/25",
  OTHERS: "bg-[#bc8cff]/12 text-[#bc8cff] border-[#bc8cff]/25",
};

export default function VisitDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const canReview = !!user &&
    ["SUPER_ADMIN", "ADMIN", "HOD", "REGIONAL_ADMIN", "AUDITOR"].some((r) =>
      (user.roles ?? []).some((x: any) => x.name === r)
    );

  const [comments, setComments] = useState("");
  const [selectedPhoto, setSelectedPhoto] = useState<any | null>(null);

  const { data: visit, isLoading, refetch } = useQuery({
    queryKey: ["visit", id],
    queryFn: async () => (await api.get(`/visits/${id}`)).data,
  });

  const { data: checklist, refetch: refetchChecklist } = useQuery({
    queryKey: ["checklist", id],
    queryFn: async () => (await api.get(`/visits/${id}/checklist`)).data,
    enabled: !!id,
  });

  const { data: actions } = useQuery({
    queryKey: ["actions", id],
    queryFn: async () => (await api.get(`/visits/${id}/actions`)).data,
    enabled: !!id,
  });

  const { data: photos, refetch: refetchPhotos } = useQuery({
    queryKey: ["photos", id],
    queryFn: async () => (await api.get(`/visits/${id}/photos`)).data,
    enabled: !!id,
  });

  const { data: assets, refetch: refetchAssets } = useQuery({
    queryKey: ["visit-assets", id],
    queryFn: async () => (await api.get(`/visits/${id}/assets`)).data,
    enabled: !!id,
  });

  const { data: itAssets, refetch: refetchItAssets } = useQuery({
    queryKey: ["visit-it-assets", id],
    queryFn: async () => (await api.get(`/visits/${id}/it-assets`)).data,
    enabled: !!id,
  });

  const approveMut = useMutation({
    mutationFn: async () => (await api.post(`/visits/${id}/approve`)).data,
    onSuccess: () => { refetch(); alert("Approved"); },
    onError: async (e: any) => alert(await getErrorMessage(e)),
  });

  const reviewMut = useMutation({
    mutationFn: async () => (await api.post(`/visits/${id}/review`)).data,
    onSuccess: () => { refetch(); alert("Review started"); },
    onError: async (e: any) => alert(await getErrorMessage(e)),
  });

  const reworkMut = useMutation({
    mutationFn: async () => (await api.post(`/visits/${id}/rework`, { comments })).data,
    onSuccess: () => { refetch(); alert("Sent for rework"); },
    onError: async (e: any) => alert(await getErrorMessage(e)),
  });

  // -------------------------------------------------------------------------
  // Interactive inspector workflow — answer + photo evidence + submit, both for
  // reviewers (web) and inspectors (the same checklists drive the on-site app).
  // -------------------------------------------------------------------------
  const [itemAnswer, setItemAnswer] = useState<Record<string, any>>({});
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null);

  const saveItemMut = useMutation({
    mutationFn: async ({ itemId, payload }: { itemId: string; payload: any }) =>
      (await api.patch(`/visits/${id}/checklist/items/${itemId}`, payload)).data,
    onSuccess: () => {
      refetchChecklist();
      alert("Answer saved ✓");
    },
    onError: async (e: any) => alert(await getErrorMessage(e)),
  });

  const photoInputRef = useRef<HTMLInputElement>(null);
  const [photoTargetItemId, setPhotoTargetItemId] = useState<string | null>(null);

  const uploadPhotoMut = useMutation({
    mutationFn: async ({ itemId, file }: { itemId: string; file: File }) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("checklist_item_id", itemId);
      return (await api.post(`/visits/${id}/photos`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      })).data;
    },
    onSuccess: async () => {
      setPhotoTargetItemId(null);
      alert("Photo uploaded ✓");
      refetchPhotos();
    },
    onError: async (e: any) => alert(await getErrorMessage(e)),
  });

  const submitMut = useMutation({
    mutationFn: async () => (await api.post(`/visits/${id}/submit`)).data,
    onSuccess: () => { refetch(); alert("Visit submitted for review ✓"); },
    onError: async (e: any) => alert(await getErrorMessage(e)),
  });

  // ---- Fixed & IT asset capture (code-plate photo -> server OCR) ----
  const [addingAsset, setAddingAsset] = useState(false);
  const [assetCategory, setAssetCategory] = useState("");
  const [assetName, setAssetName] = useState("");
  const scanInputRef = useRef<HTMLInputElement>(null);
  const scanTargetRef = useRef<{ kind: "asset" | "it"; id: string } | null>(null);

  const addAssetMut = useMutation({
    mutationFn: async () =>
      (await api.post(`/visits/${id}/assets`, { category: assetCategory, name: assetName || null })).data,
    onSuccess: () => {
      setAddingAsset(false);
      setAssetCategory("");
      setAssetName("");
      refetchAssets();
    },
    onError: async (e: any) => alert(await getErrorMessage(e)),
  });

  const deleteAssetMut = useMutation({
    mutationFn: async (assetId: string) => (await api.delete(`/visits/${id}/assets/${assetId}`)).data,
    onSuccess: () => refetchAssets(),
    onError: async (e: any) => alert(await getErrorMessage(e)),
  });

  const updateAssetCodeMut = useMutation({
    mutationFn: async ({ assetId, code }: { assetId: string; code: string }) =>
      (await api.patch(`/visits/${id}/assets/${assetId}`, { code, ocr_confirmed: true })).data,
    onSuccess: () => refetchAssets(),
    onError: async (e: any) => alert(await getErrorMessage(e)),
  });

  const updateItCodeMut = useMutation({
    mutationFn: async ({ rowId, code }: { rowId: string; code: string }) =>
      (await api.patch(`/visits/${id}/it-assets/${rowId}`, { code, ocr_confirmed: true })).data,
    onSuccess: () => refetchItAssets(),
    onError: async (e: any) => alert(await getErrorMessage(e)),
  });

  const setItNotFoundMut = useMutation({
    mutationFn: async ({ rowId, remark }: { rowId: string; remark: string }) =>
      (await api.patch(`/visits/${id}/it-assets/${rowId}`, { status: "NOT_FOUND", remark, code: null, ocr_confirmed: false })).data,
    onSuccess: () => refetchItAssets(),
    onError: async (e: any) => alert(await getErrorMessage(e)),
  });

  const clearItNotFoundMut = useMutation({
    mutationFn: async (rowId: string) =>
      (await api.patch(`/visits/${id}/it-assets/${rowId}`, { status: "PENDING", remark: null, code: null, ocr_confirmed: false })).data,
    onSuccess: () => refetchItAssets(),
    onError: async (e: any) => alert(await getErrorMessage(e)),
  });

  type ScanVars = { url: string; file: File; kind: "asset" | "it"; id: string };

  const scanMut = useMutation({
    mutationFn: async ({ url, file }: ScanVars) => {
      const fd = new FormData();
      fd.append("file", file);
      return (await api.post(url, fd, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: async (res: any, vars: ScanVars) => {
      refetchAssets();
      refetchItAssets();
      const text = (res.ocr_text ?? "").trim();
      if (!text) {
        alert("No code text could be read from this photo. Re-scan with better lighting and a straight-on angle.");
        return;
      }
      const edited = window.prompt(
        `OCR read "${res.ocr_text}" (confidence ${res.ocr_confidence}%).\n\nThe code was saved with the photo automatically. Correct it here if needed, or Cancel to keep it as-is.`,
        res.ocr_text
      );
      if (edited !== null) {
        if (vars.kind === "asset") updateAssetCodeMut.mutate({ assetId: vars.id, code: edited });
        else updateItCodeMut.mutate({ rowId: vars.id, code: edited });
      }
    },
    onError: async (e: any) => alert(await getErrorMessage(e)),
  });

  const startScan = (kind: "asset" | "it", targetId: string) => {
    scanTargetRef.current = { kind, id: targetId };
    scanInputRef.current?.click();
  };

  const onScanFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const target = scanTargetRef.current;
    e.target.value = "";
    if (!file || !target) return;
    const url = target.kind === "asset"
      ? `/visits/${id}/assets/${target.id}/code-photo`
      : `/visits/${id}/it-assets/${target.id}/code-photo`;
    scanMut.mutate({ kind: target.kind, id: target.id, url, file });
  };
  const [scanningId, setScanningId] = useState<string | null>(null);
  useEffect(() => {
    setScanningId(scanMut.isPending ? `${scanTargetRef.current?.kind}-${scanTargetRef.current?.id}` : null);
  }, [scanMut.isPending]);

  // ---- Interactive inspector workflow (on-site answering) ----
  const [drafts, setDrafts] = useState<Record<string, any>>({});
  const [uploadingItem, setUploadingItem] = useState<string | null>(null);
  

  if (isLoading || !visit) return <Spinner />;

  const items = checklist?.items ?? [];
  const itVerified = (itAssets ?? []).filter((r: any) => r.status === "VERIFIED" || r.code).length;
  const itTotal = (itAssets ?? []).length;
  const itNotFound = (itAssets ?? []).filter((r: any) => r.status === "NOT_FOUND").length;
  const notOkItems = items.filter((i: any) => i.status === "NOT_OK");
  const naItems = items.filter((i: any) => i.status === "NA");
  const okCount = items.filter((i: any) => i.status === "OK").length;
  const notOkCount = notOkItems.length;

  return (
    <div className="space-y-6">
      <div>
        <button onClick={() => router.back()} className="text-sm font-medium text-[#58a6ff] hover:underline mb-3 inline-block">
          ← Back to visits
        </button>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gh-text">{visit.branch_name ?? "Branch Visit"}</h1>
            <p className="text-gh-muted text-sm mt-1">
              {visit.visit_type_name ?? "Branch Visit"} · {visit.scheduled_date ?? "Inspection Visit"}
            </p>
          </div>
          <Badge className={`text-sm px-3 py-1 self-start sm:self-auto ${STATUS_COLORS[visit.status] ?? "bg-slate-500"}`}>
            {visit.status.replace("_", " ")}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-5 text-center">
          <p className="text-2xl font-bold text-[#58a6ff]">
            {visit.compliance_percentage != null ? `${visit.compliance_percentage}%` : "—"}
          </p>
          <p className="text-xs font-semibold text-gh-muted uppercase tracking-wide mt-1">Compliance Score</p>
        </Card>
        <Card className="p-5 text-center">
          <p className="text-2xl font-bold text-[#3fb950]">{okCount}</p>
          <p className="text-xs font-semibold text-gh-muted uppercase tracking-wide mt-1">OK Checkpoints</p>
        </Card>
        <Card className="p-5 text-center">
          <p className="text-2xl font-bold text-[#f85149]">{notOkCount}</p>
          <p className="text-xs font-semibold text-gh-muted uppercase tracking-wide mt-1">Failed Items</p>
        </Card>
        <Card className="p-5 text-center">
          <p className="text-2xl font-bold text-gh-muted">{naItems.length}</p>
          <p className="text-xs font-semibold text-gh-muted uppercase tracking-wide mt-1">N/A Items</p>
        </Card>
      </div>

      {visit.instructions && (
        <Card className="p-4 bg-[#d29922]/10 border-[#d29922]/30">
          <p className="text-sm text-[#d29922]">
            <span className="font-bold">Inspection Instructions: </span>{visit.instructions}
          </p>
        </Card>
      )}

      {/* Review controls */}
      {visit.status === "SUBMITTED" && (
        <Card className="p-5 border-[#2f81f7]/40 bg-[#2f81f7]/10">
          <h3 className="font-bold text-gh-text mb-2">Ready For Review</h3>
          <p className="text-sm text-gh-muted mb-4">
            This visit has been submitted by the inspector. Begin review to evaluate compliance findings and attached photos.
          </p>
          <Button variant="success" onClick={() => reviewMut.mutate()} disabled={reviewMut.isPending}>
            {reviewMut.isPending ? "Starting..." : "▶ Start Review"}
          </Button>
        </Card>
      )}
      {["UNDER_REVIEW", "REWORK_REQUIRED", "RESUBMITTED"].includes(visit.status) && (
        <Card className="p-5">
          <h3 className="font-semibold mb-3">Review Decisions</h3>
          <textarea
            className="w-full border border-[#30363d] rounded-lg p-3 text-sm mb-3 bg-gh-canvas text-gh-text focus:outline-none focus:ring-2 focus:ring-[#2f81f7]"
            rows={3}
            placeholder="Enter review findings or rework instructions..."
            value={comments}
            onChange={(e) => setComments(e.target.value)}
          />
          <div className="flex gap-3">
            <Button variant="success" onClick={() => approveMut.mutate()} disabled={approveMut.isPending}>
              {approveMut.isPending ? "Approving..." : "✓ Approve Visit"}
            </Button>
            <Button variant="danger" onClick={() => reworkMut.mutate()} disabled={reworkMut.isPending}>
              {reworkMut.isPending ? "Sending..." : "✕ Send For Rework"}
            </Button>
          </div>
        </Card>
      )}

      {/* Checklist responses */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gh-text">Checklist Checkpoints ({items.length} items)</h3>
            <p className="text-xs text-gh-muted mt-0.5">
              Showing checkpoints matching your role permissions from the SOP master sheet.
            </p>
          </div>
        </div>

        {!checklist || items.length === 0 ? (
          <EmptyState message="No checklist checkpoints found for this visit/role." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gh-border bg-white/[0.04]">
                  <th className="text-left px-3 py-2.5 font-semibold text-gh-muted w-12">#</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-gh-muted">Section & Checkpoint</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-gh-muted">Roles</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-gh-muted">Status</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-gh-muted">Remark / Notes</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-gh-muted">Action Required</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {items.map((i: any, idx: number) => (
                  <tr key={i.id} className={i.status === "NOT_OK" ? "bg-[#f85149]/10" : i.status === "OK" ? "bg-[#3fb950]/10" : ""}>
                    <td className="px-3 py-3 text-gh-faint font-mono text-xs">{idx + 1}</td>
                    <td className="px-3 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-gh-faint">
                        {i.section_name ?? "General"}
                      </p>
                      <p className="font-medium text-gh-text mt-0.5">{i.item_name}</p>
                      {i.item_description && (
                        <p className="text-xs text-gh-muted mt-1 line-clamp-2">{i.item_description}</p>
                      )}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="flex flex-wrap gap-1">
                        {(i.role_tags || []).length ? (
                          i.role_tags.map((rt: string) => (
                            <span
                              key={rt}
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                                ROLE_BADGE_COLORS[rt] ?? "bg-white/[0.06] text-gh-muted border-gh-border"
                              }`}
                            >
                              {rt}
                            </span>
                          ))
                        ) : (
                          <span className="text-[10px] text-gh-faint">ALL</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {i.status ? (
                        <Badge className={STATUS_COLORS[i.status] ?? "bg-slate-400"}>
                          {i.status.replace("_", " ")}
                        </Badge>
                      ) : (
                        <span className="text-[#484f58] text-xs">— Pending —</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-gh-muted text-xs">
                      {i.remark || <span className="text-[#484f58]">—</span>}
                    </td>
                    <td className="px-3 py-3 text-gh-muted text-xs">
                      {i.action_required || <span className="text-[#484f58]">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Fixed asset checklist */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gh-text">Fixed Asset Checklist ({assets?.length ?? 0})</h3>
            <p className="text-xs text-gh-muted mt-0.5">
              On-site assets (fans, chairs, tables, extinguishers…) with code-plate photo + OCR capture.
            </p>
          </div>
          <Button variant="secondary" onClick={() => setAddingAsset((v) => !v)}>+ Add Asset</Button>
        </div>

        {addingAsset && (
          <div className="flex gap-2 items-end bg-white/[0.03] border border-gh-border rounded-lg p-3 mb-4">
            <div className="flex-1">
              <Input label="Category" placeholder="Fan / Chair / Table…" value={assetCategory} onChange={(e) => setAssetCategory(e.target.value)} />
            </div>
            <div className="flex-1">
              <Input label="Name (optional)" placeholder="Ceiling fan near counter" value={assetName} onChange={(e) => setAssetName(e.target.value)} />
            </div>
            <Button onClick={() => addAssetMut.mutate()} disabled={!assetCategory.trim()}>Add</Button>
          </div>
        )}

        {!assets?.length ? (
          <EmptyState message="No fixed assets captured for this visit yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gh-border bg-white/[0.04]">
                  <th className="text-left px-3 py-2.5 font-semibold text-gh-muted">#</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-gh-muted">Asset</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-gh-muted">Code (OCR)</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-gh-muted">Status</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-gh-muted">Updated By</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-gh-muted">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {assets.map((a: any, idx: number) => (
                  <tr key={a.id}>
                    <td className="px-3 py-3 text-gh-faint font-mono text-xs">{idx + 1}</td>
                    <td className="px-3 py-3">
                      <p className="font-medium text-gh-text">{a.category}</p>
                      {a.name && <p className="text-xs text-gh-muted">{a.name}</p>}
                    </td>
                    <td className="px-3 py-3">
                      {a.code ? (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs bg-white/[0.07] border border-gh-border rounded px-2 py-1">{a.code}</span>
                          {a.ocr_confirmed && <Badge className="bg-emerald-500">OCR ✓</Badge>}
                        </div>
                      ) : (
                        <span className="text-[#484f58] text-xs">— Pending —</span>
                      )}
                      {a.photo_url && (
                        <a href={getMediaUrl(a.photo_url)} target="_blank" rel="noreferrer">
                          <img
                            src={getMediaUrl(a.photo_thumbnail_url ?? a.photo_url)}
                            alt="plate"
                            className="mt-1 h-10 w-10 rounded object-cover border border-gh-border"
                          />
                        </a>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Badge className={a.status === "VERIFIED" ? "bg-emerald-500" : a.status === "NOT_FOUND" ? "bg-red-500" : "bg-amber-500"}>
                        {a.status.replace("_", " ")}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-xs text-gh-muted">{a.created_by_name ?? "-"}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="flex gap-2 items-center">
                        <Button
                          variant="secondary"
                          className="px-2 py-1 text-xs"
                          disabled={scanningId === `asset-${a.id}`}
                          onClick={() => startScan("asset", a.id)}
                        >
                          {scanningId === `asset-${a.id}` ? "Scanning…" : a.photo_url ? "📷 Re-scan" : "📷 Scan Code"}
                        </Button>
                        <button
                          onClick={() => { if (confirm(`Delete "${a.category}"?`)) deleteAssetMut.mutate(a.id); }}
                          className="text-xs text-[#f85149] hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* IT asset verification */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-gh-text">IT Asset Verification ({itVerified}/{itTotal} codes captured{itNotFound > 0 ? ` · ${itNotFound} not there` : ""})</h3>
            <p className="text-xs text-gh-muted mt-0.5">
              Every employee of this branch is pre-assigned Laptop / Mobile (and admin-configured types).
            </p>
          </div>
        </div>

        {!itAssets?.length ? (
          <EmptyState message="No employees on record for this branch yet — add them under the Employees section." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gh-border bg-white/[0.04]">
                  <th className="text-left px-3 py-2.5 font-semibold text-gh-muted">Employee</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-gh-muted">Department</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-gh-muted">Asset Type</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-gh-muted">Serial / Code</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-gh-muted">Status</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-gh-muted">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {itAssets.map((r: any) => (
                  <tr key={r.id} className={r.status === "NOT_FOUND" ? "bg-[#f85149]/10" : r.code ? "bg-[#3fb950]/10" : ""}>
                    <td className="px-3 py-3">
                      <p className="font-medium text-gh-text">{r.employee_name ?? "-"}</p>
                      <p className="text-xs font-mono text-gh-faint">{r.employee_code}</p>
                    </td>
                    <td className="px-3 py-3 text-xs text-gh-muted">{r.department ?? "-"}</td>
                    <td className="px-3 py-3">
                      <Badge className="bg-blue-600">{r.asset_type_name}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      {r.status === "NOT_FOUND" ? (
                        <span className="text-xs text-[#f85149]">
                          <span className="font-semibold">Not there</span>
                          {r.remark ? <span className="block text-gh-muted mt-0.5">{r.remark}</span> : null}
                        </span>
                      ) : r.code ? (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs bg-white/[0.07] border border-gh-border rounded px-2 py-1">{r.code}</span>
                          {r.ocr_confirmed && <Badge className="bg-emerald-500">OCR ✓</Badge>}
                        </div>
                      ) : (
                        <span className="text-[#484f58] text-xs">— Not captured —</span>
                      )}
                      {r.photo_url && (
                        <a href={getMediaUrl(r.photo_url)} target="_blank" rel="noreferrer">
                          <img
                            src={getMediaUrl(r.photo_thumbnail_url ?? r.photo_url)}
                            alt="plate"
                            className="mt-1 h-10 w-10 rounded object-cover border border-gh-border"
                          />
                        </a>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Badge className={r.status === "VERIFIED" ? "bg-emerald-500" : r.status === "NOT_FOUND" ? "bg-red-500" : "bg-amber-500"}>
                        {r.status.replace("_", " ")}
                      </Badge>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-2 items-center">
                        <Button
                          variant="secondary"
                          className="px-2 py-1 text-xs"
                          disabled={scanningId === `it-${r.id}`}
                          onClick={() => startScan("it", r.id)}
                        >
                          {scanningId === `it-${r.id}` ? "Scanning…" : r.photo_url ? "📷 Re-scan" : "📷 Scan Code"}
                        </Button>
                        {r.status === "NOT_FOUND" ? (
                          <Button
                            variant="secondary"
                            className="px-2 py-1 text-xs border-[#f85149]/40 text-[#f85149] hover:bg-[#f85149]/10"
                            onClick={() => clearItNotFoundMut.mutate(r.id)}
                          >
                            Undo Not There
                          </Button>
                        ) : (
                          <Button
                            variant="secondary"
                            className="px-2 py-1 text-xs border-[#f85149]/40 text-[#f85149] hover:bg-[#f85149]/10"
                            onClick={() => {
                              const remark = window.prompt("Why isn't this asset there? (remark is required)", "");
                              if (remark !== null && remark.trim()) setItNotFoundMut.mutate({ rowId: r.id, remark: remark.trim() });
                            }}
                          >
                            🚫 Not There
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <input ref={scanInputRef} type="file" accept="image/*" className="hidden" onChange={onScanFile} />
      </Card>

      {/* Corrective actions */}
      <Card className="p-5">
        <h3 className="font-semibold mb-4 text-gh-text">Corrective Actions ({actions?.length ?? 0})</h3>
        {!actions?.length ? <EmptyState message="No corrective actions created." /> : (
          <div className="space-y-3">
            {actions.map((a: any) => (
              <div key={a.id} className="border border-gh-border rounded-lg p-4 bg-white/[0.03]">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-gh-text">{a.title}</p>
                  <Badge className={a.status === "OVERDUE" ? "bg-red-700" : a.status === "CLOSED" ? "bg-emerald-600" : "bg-amber-500"}>
                    {a.status.replace("_", " ")}
                  </Badge>
                </div>
                {a.observation && (
                  <p className="text-xs text-gh-muted mt-1"><span className="font-medium">Observed:</span> {a.observation}</p>
                )}
                <p className="text-sm text-[#c9d1d9] mt-2 font-medium">{a.action_required}</p>
                <p className="text-xs text-gh-faint mt-2">
                  Responsible: {a.responsible_person_name ?? "Unassigned"} · Target: {a.target_date ?? "No date"} · Priority: {a.priority}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Photo evidence */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gh-text">Photo Evidence Gallery ({photos?.length ?? 0})</h3>
          <span className="text-xs text-gh-muted">Click photo to review / flag quality</span>
        </div>
        {!photos?.length ? <EmptyState message="No photos attached for this visit." /> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {photos.map((p: any) => {
              const isRejected = p.status === "REJECTED";
              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedPhoto(p)}
                  className={`group relative block aspect-square rounded-xl overflow-hidden border cursor-pointer transition-all shadow ${
                    isRejected
                      ? "border-red-500/50 bg-red-950/20 hover:border-red-400"
                      : "border-gh-border bg-gh-panel hover:border-blue-500/60"
                  }`}
                >
                  <img
                    src={getMediaUrl(p.thumbnail_url ?? p.url)}
                    alt={p.caption || "Evidence"}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                  />
                  <div className="absolute top-1.5 left-1.5 flex gap-1">
                    {isRejected ? (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-600/90 text-white shadow">
                        ⚠️ Rejected
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-600/90 text-white shadow">
                        ✓ OK
                      </span>
                    )}
                  </div>
                  {p.caption ? (
                    <div className="absolute inset-x-0 bottom-0 bg-black/70 px-2 py-1">
                      <p className="text-[10px] text-white truncate">{p.caption}</p>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {selectedPhoto && (
        <PhotoReviewModal
          photo={selectedPhoto}
          canReview={canReview}
          onClose={() => setSelectedPhoto(null)}
          onUpdated={() => refetchPhotos()}
        />
      )}
    </div>
  );
}
