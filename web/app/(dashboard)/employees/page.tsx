"use client";

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Cookies from "js-cookie";
import { API_URL, api, getErrorMessage, getMediaUrl } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Card, Badge, Button, Input, Select, Table, Spinner, EmptyState } from "@/components/ui";
import { DataTable, type ColumnDef } from "@/components/DataTable";

const ROLE_LABEL: Record<string, string> = {
  ADMIN: "bg-blue-600",
  HOD: "bg-emerald-600",
  REGIONAL_ADMIN: "bg-amber-600",
};

/* -------------------------------------------------------------------------- */
/* Full Image Lightbox Viewer                                                 */
/* -------------------------------------------------------------------------- */
function PhotoLightboxModal({
  photoUrl,
  title,
  subtitle,
  onClose,
}: {
  photoUrl: string;
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  const fullUrl = getMediaUrl(photoUrl);
  // Backend forces Content-Disposition: attachment so the browser saves the
  // evidence file (with its original filename) instead of opening a tab.
  const downloadUrl = photoUrl.includes("?")
    ? `${getMediaUrl(photoUrl)}&download=1`
    : `${getMediaUrl(photoUrl)}?download=1`;

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center z-[100] p-4">
      <div className="w-full max-w-4xl flex items-center justify-between mb-3 text-white">
        <div>
          <h3 className="text-lg font-bold flex items-center gap-2">
            📸 {title}
          </h3>
          {subtitle && <p className="text-xs text-[#8b949e] mt-0.5">{subtitle}</p>}
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
      <div className="relative max-w-4xl max-h-[80vh] w-full flex items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-black/60 shadow-2xl">
        <img
          src={fullUrl}
          alt={title}
          className="max-w-full max-h-[78vh] object-contain rounded-lg"
        />
      </div>
      <p className="text-[11px] text-[#8b949e] mt-2">
        Tamper-proof compliance evidence stored permanently in PostgreSQL database.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Employee Asset Details & History Modal                                     */
/* -------------------------------------------------------------------------- */
function EmployeeAssetModal({
  employee: initialEmp,
  canManage,
  onClose,
}: {
  employee: any;
  canManage: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const employeeId = initialEmp?.id;
  const [selectedPhoto, setSelectedPhoto] = useState<{ url: string; title: string; subtitle?: string } | null>(null);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editRemark, setEditRemark] = useState("");
  const [editStatus, setEditStatus] = useState("VERIFIED");
  const [showAddAsset, setShowAddAsset] = useState(false);
  const [newAssetTypeId, setNewAssetTypeId] = useState("");
  const [newAssetCode, setNewAssetCode] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoTargetTypeId, setPhotoTargetTypeId] = useState<string | null>(null);

  // ---- Annual device allocations (super admin assigns; regional verifies) ----
  const { user: authUser } = useAuth();
  const isSuper = !!authUser && (authUser.roles ?? []).some((x: any) => x.name === "SUPER_ADMIN");
  const currentYear = new Date().getFullYear();
  const [allocYear, setAllocYear] = useState(String(currentYear));
  const [showAddAlloc, setShowAddAlloc] = useState(false);
  const [newAllocTypeId, setNewAllocTypeId] = useState("");
  const [newAllocCode, setNewAllocCode] = useState("");
  const [newAllocYear, setNewAllocYear] = useState(String(currentYear));
  const [newAllocRemark, setNewAllocRemark] = useState("");

  const { data: detailData, isLoading, refetch } = useQuery({
    queryKey: ["employee-detail", employeeId],
    queryFn: async () => (await api.get(`/employees/${employeeId}`)).data,
    enabled: !!employeeId,
  });

  const emp = detailData ?? initialEmp;

  const { data: assetTypes } = useQuery({
    queryKey: ["it-asset-types"],
    queryFn: async () => (await api.get("/it-asset-types")).data,
  });

  const updateAssetMut = useMutation({
    mutationFn: async ({ rowId, payload }: { rowId: string; payload: any }) =>
      (await api.patch(`/employees/${employeeId}/assets/${rowId}`, payload)).data,
    onSuccess: () => {
      setEditingRowId(null);
      refetch();
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: async (e: any) => alert(await getErrorMessage(e)),
  });

  const createAssetMut = useMutation({
    mutationFn: async (payload: any) =>
      (await api.post(`/employees/${employeeId}/assets`, payload)).data,
    onSuccess: () => {
      setShowAddAsset(false);
      setNewAssetCode("");
      refetch();
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: async (e: any) => alert(await getErrorMessage(e)),
  });

  const uploadPhotoMut = useMutation({
    mutationFn: async ({ assetTypeId, file }: { assetTypeId: string; file: File }) => {
      const fd = new FormData();
      fd.append("file", file);
      return (await api.post(`/employees/${employeeId}/assets/${assetTypeId}/photo`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      })).data;
    },
    onSuccess: () => {
      setPhotoTargetTypeId(null);
      refetch();
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
    onError: async (e: any) => alert(await getErrorMessage(e)),
  });

  const allocations = useQuery({
    queryKey: ["it-asset-allocations", employeeId],
    queryFn: async () => (await api.get("/it-asset-allocations", { params: { employee_id: employeeId } })).data,
    enabled: !!employeeId,
  });
  const allocRows: any[] = allocations.data?.allocations ?? [];

  const createAllocMut = useMutation({
    mutationFn: async (payload: any) => (await api.post("/it-asset-allocations", payload)).data,
    onSuccess: () => {
      setShowAddAlloc(false);
      setNewAllocCode("");
      setNewAllocRemark("");
      qc.invalidateQueries({ queryKey: ["it-asset-allocations", employeeId] });
    },
    onError: async (e: any) => alert(await getErrorMessage(e)),
  });

  const deleteAllocMut = useMutation({
    mutationFn: async (allocId: string) => api.delete(`/it-asset-allocations/${allocId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["it-asset-allocations", employeeId] }),
    onError: async (e: any) => alert(await getErrorMessage(e)),
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && photoTargetTypeId) {
      uploadPhotoMut.mutate({ assetTypeId: photoTargetTypeId, file });
    }
  };

  const getDeviceIcon = (name: string) => {
    const n = (name || "").toLowerCase();
    if (n.includes("laptop") || n.includes("macbook") || n.includes("computer")) return "💻";
    if (n.includes("phone") || n.includes("mobile") || n.includes("android") || n.includes("iphone")) return "📱";
    if (n.includes("tablet") || n.includes("ipad")) return "📟";
    if (n.includes("monitor") || n.includes("screen") || n.includes("display")) return "🖥️";
    if (n.includes("printer") || n.includes("scanner")) return "🖨️";
    return "📦";
  };

  const assets: any[] = emp?.assets ?? [];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileUpload}
      />

      <div className="bg-gh-panel border border-gh-border rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-gh-border flex items-start justify-between bg-gh-canvas/60">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-white font-bold text-lg shadow-md">
              {emp?.name ? emp.name.slice(0, 2).toUpperCase() : "EM"}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold text-white">{emp?.name ?? "Employee"}</h2>
                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/30 text-[#58a6ff]">
                  {emp?.emp_code}
                </span>
                <Badge className={emp?.is_active ? "bg-emerald-600" : "bg-slate-500"}>
                  {emp?.is_active ? "Active" : "Inactive"}
                </Badge>
              </div>
              <p className="text-xs text-gh-muted mt-1">
                {emp?.department ?? "General"} · {emp?.branch_name ?? "Branch Unassigned"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-gh-panel hover:bg-white/10 text-gh-muted hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoading && !detailData ? (
            <div className="py-12 flex justify-center"><Spinner /></div>
          ) : (
            <>
              {/* Top summary stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.08]">
                  <p className="text-[11px] font-medium text-gh-muted uppercase tracking-wider">Total Expected Assets</p>
                  <p className="text-2xl font-bold text-white mt-1">{emp?.total_assets ?? 0}</p>
                </div>
                <div className="p-3.5 rounded-xl bg-emerald-500/[0.08] border border-emerald-500/25">
                  <p className="text-[11px] font-medium text-emerald-400 uppercase tracking-wider">Verified With Code</p>
                  <p className="text-2xl font-bold text-emerald-400 mt-1">{emp?.verified_count ?? 0}</p>
                </div>
                <div className="p-3.5 rounded-xl bg-blue-500/[0.08] border border-blue-500/25">
                  <p className="text-[11px] font-medium text-[#58a6ff] uppercase tracking-wider">Photo Evidence Status</p>
                  <p className="text-2xl font-bold text-[#58a6ff] mt-1">
                    {assets.filter((a) => a.photo_url || (a.photos && a.photos.length > 0)).length} on File
                  </p>
                </div>
              </div>

              {/* Annual Device Allocations */}
              <div>
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h3 className="font-bold text-white text-base flex items-center gap-2">
                    <span>📱 Annual Device Allocations</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-gh-muted">
                      Super admin assigns · Regional verifies codes yearly
                    </span>
                  </h3>
                  <div className="flex items-center gap-2">
                    <Select value={allocYear} onChange={(e) => setAllocYear(e.target.value)}>
                      {Array.from({ length: 5 }, (_, i) => String(currentYear - 2 + i)).map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </Select>
                    {isSuper && (
                      <Button
                        variant="secondary"
                        className="px-3 py-1 text-xs"
                        onClick={() => {
                          setShowAddAlloc(true);
                          setNewAllocTypeId(assetTypes?.[0]?.id ?? "");
                          setNewAllocYear(allocYear);
                        }}
                      >
                        + Assign Device
                      </Button>
                    )}
                  </div>
                </div>

                {showAddAlloc && (
                  <div className="mb-4 p-4 rounded-xl bg-gh-canvas border border-emerald-500/30 space-y-3">
                    <p className="text-xs font-semibold text-emerald-400">
                      Assign devices for {newAllocYear} — 2 laptops + 3 mobiles = add each device code separately.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Select label="Device Type" value={newAllocTypeId} onChange={(e) => setNewAllocTypeId(e.target.value)}>
                        {(assetTypes ?? []).map((t: any) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </Select>
                      <Input label="Device Code / Serial" placeholder="e.g. LAP-2026-0042" value={newAllocCode} onChange={(e) => setNewAllocCode(e.target.value)} />
                      <Select label="Year" value={newAllocYear} onChange={(e) => setNewAllocYear(e.target.value)}>
                        {Array.from({ length: 6 }, (_, i) => String(currentYear - 3 + i)).map((y) => (
                          <option key={y} value={y}>{y}</option>
                        ))}
                      </Select>
                      <Input label="Remark (optional)" value={newAllocRemark} onChange={(e) => setNewAllocRemark(e.target.value)} />
                    </div>
                    <div className="flex gap-2 justify-end pt-1">
                      <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => setShowAddAlloc(false)}>Cancel</Button>
                      <Button
                        className="px-3 py-1 text-xs"
                        disabled={!newAllocTypeId || !newAllocCode.trim()}
                        onClick={() => createAllocMut.mutate({
                          employee_id: employeeId,
                          asset_type_id: newAllocTypeId,
                          device_code: newAllocCode.trim(),
                          allocation_year: parseInt(newAllocYear, 10),
                          remark: newAllocRemark.trim() || null,
                        })}
                      >
                        Save Allocation
                      </Button>
                    </div>
                  </div>
                )}

                {allocations.isLoading ? (
                  <Spinner />
                ) : (() => {
                  const yearRows = allocRows.filter((a: any) => String(a.allocation_year) === allocYear);
                  const grouped = new Map<string, any[]>();
                  for (const a of yearRows) {
                    if (!grouped.has(a.asset_type_name)) grouped.set(a.asset_type_name, []);
                    grouped.get(a.asset_type_name)!.push(a);
                  }
                  if (yearRows.length === 0) {
                    return (
                      <div className="p-6 text-center bg-white/[0.02] border border-dashed border-white/10 rounded-xl">
                        <p className="text-sm text-gh-muted">
                          No devices allocated for {allocYear}.
                          {isSuper ? " Use “+ Assign Device” to add laptops, mobiles, etc. with their codes." : " The super admin has not assigned devices yet."}
                        </p>
                      </div>
                    );
                  }
                  return (
                    <div className="space-y-3">
                      {Array.from(grouped.entries()).map(([typeName, rows]) => (
                        <div key={typeName} className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08]">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xl">{getDeviceIcon(typeName)}</span>
                            <span className="font-bold text-white text-sm">{typeName}</span>
                            <span className="text-xs text-gh-faint">× {rows.length} allocated</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {rows.map((a: any) => (
                              <span key={a.id} className="inline-flex items-center gap-2 text-xs bg-white/[0.05] border border-gh-border rounded-full pl-2.5 pr-1.5 py-1">
                                <span className="font-mono font-semibold text-[#58a6ff]">{a.device_code}</span>
                                <Badge className={a.status === "VERIFIED" ? "bg-emerald-600" : a.status === "REMOVED" ? "bg-slate-500" : "bg-amber-600"}>
                                  {a.status}
                                </Badge>
                                {a.remark && <span className="text-[#d29922]">· {a.remark}</span>}
                                {isSuper && (
                                  <button
                                    className="text-[#f85149] hover:underline font-bold px-1"
                                    title="Delete allocation"
                                    onClick={() => {
                                      if (confirm(`Delete allocation ${a.device_code} (${a.allocation_year})?`)) deleteAllocMut.mutate(a.id);
                                    }}
                                  >
                                    ✕
                                  </button>
                                )}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                      <p className="text-[11px] text-gh-faint">
                        During the annual visit the regional admin scans each device code; a scan matching one of these allocations confirms the same device is still with this employee. The same code can be allocated again in a later year to track device reuse.
                      </p>
                    </div>
                  );
                })()}
              </div>

              {/* Assets Section */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-bold text-white text-base flex items-center gap-2">
                    <span>Assigned IT Devices & Photo Evidence</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-gh-muted">
                      Permanent Archive
                    </span>
                  </h3>
                  {canManage && (
                    <Button
                      variant="secondary"
                      className="px-3 py-1 text-xs"
                      onClick={() => {
                        setShowAddAsset(true);
                        setNewAssetTypeId(assetTypes?.[0]?.id ?? "");
                      }}
                    >
                      + Assign Asset Type
                    </Button>
                  )}
                </div>

                {/* Add Asset Form if expanded */}
                {showAddAsset && (
                  <div className="mb-4 p-4 rounded-xl bg-gh-canvas border border-blue-500/30 space-y-3">
                    <p className="text-xs font-semibold text-[#58a6ff]">Assign / Register Asset to Employee</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Select
                        label="Asset Type"
                        value={newAssetTypeId}
                        onChange={(e) => setNewAssetTypeId(e.target.value)}
                      >
                        {(assetTypes ?? []).map((t: any) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </Select>
                      <Input
                        label="Serial Code / Tag"
                        placeholder="e.g. LAP-2024-8841"
                        value={newAssetCode}
                        onChange={(e) => setNewAssetCode(e.target.value)}
                      />
                    </div>
                    <div className="flex gap-2 justify-end pt-1">
                      <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => setShowAddAsset(false)}>Cancel</Button>
                      <Button
                        className="px-3 py-1 text-xs"
                        disabled={!newAssetTypeId}
                        onClick={() => createAssetMut.mutate({ asset_type_id: newAssetTypeId, code: newAssetCode || null })}
                      >
                        Save Asset Record
                      </Button>
                    </div>
                  </div>
                )}

                {assets.length === 0 ? (
                  <div className="p-8 text-center bg-white/[0.02] border border-dashed border-white/10 rounded-xl">
                    <p className="text-sm text-gh-muted">No IT asset records found for this employee.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {assets.map((asset: any) => {
                      const isVerified = asset.status === "VERIFIED" || (asset.code && asset.code.trim());
                      const isNotFound = asset.status === "NOT_FOUND";
                      const isEditing = editingRowId === (asset.id ?? asset.asset_type_id);
                      const hasPhoto = !!asset.photo_url || (asset.photos && asset.photos.length > 0);

                      return (
                        <div
                          key={asset.asset_type_id}
                          className="p-4 rounded-xl bg-white/[0.02] border border-white/[0.08] hover:border-white/20 transition-all flex flex-col md:flex-row md:items-center justify-between gap-4"
                        >
                          {/* Left: Device Info & Serial Code */}
                          <div className="flex items-start gap-3.5 flex-1 min-w-0">
                            <div className="w-12 h-12 rounded-xl bg-white/[0.05] border border-white/10 flex items-center justify-center text-2xl shrink-0">
                              {getDeviceIcon(asset.asset_type_name)}
                            </div>
                            <div className="space-y-1 min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-bold text-white text-sm">
                                  {asset.asset_type_name}
                                </span>
                                <Badge
                                  className={
                                    isVerified
                                      ? "bg-emerald-600/90 text-white"
                                      : isNotFound
                                      ? "bg-amber-600/90 text-white"
                                      : "bg-slate-600 text-slate-200"
                                  }
                                >
                                  {isVerified ? "✓ Verified" : isNotFound ? "⚠ Not Found" : "Pending Audit"}
                                </Badge>
                                {asset.ocr_confirmed && (
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/10 border border-blue-500/25 text-[#58a6ff]">
                                    OCR Scanned
                                  </span>
                                )}
                              </div>

                              {/* Code display or edit mode */}
                              {isEditing ? (
                                <div className="pt-2 space-y-2 max-w-sm">
                                  <Input
                                    placeholder="Serial / Asset Code"
                                    value={editCode}
                                    onChange={(e) => setEditCode(e.target.value)}
                                  />
                                  <Input
                                    placeholder="Remark / Notes"
                                    value={editRemark}
                                    onChange={(e) => setEditRemark(e.target.value)}
                                  />
                                  <div className="flex gap-2">
                                    <Button
                                      className="px-3 py-1 text-xs"
                                      variant="secondary"
                                      onClick={() => setEditingRowId(null)}
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      className="px-3 py-1 text-xs"
                                      onClick={() => {
                                        if (asset.id) {
                                          updateAssetMut.mutate({
                                            rowId: asset.id,
                                            payload: { code: editCode.trim() || null, remark: editRemark.trim() || null },
                                          });
                                        } else {
                                          createAssetMut.mutate({
                                            asset_type_id: asset.asset_type_id,
                                            code: editCode.trim() || null,
                                            remark: editRemark.trim() || null,
                                          });
                                        }
                                      }}
                                    >
                                      Save
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-gh-muted">Asset Code:</span>
                                    {asset.code ? (
                                      <span className="font-mono text-xs font-bold text-[#58a6ff] bg-[#58a6ff]/10 border border-[#58a6ff]/20 px-2 py-0.5 rounded select-all">
                                        {asset.code}
                                      </span>
                                    ) : (
                                      <span className="text-xs text-gh-faint italic">No code registered yet</span>
                                    )}
                                  </div>
                                  {asset.remark && (
                                    <p className="text-xs text-[#d29922] mt-0.5">
                                      Note: {asset.remark}
                                    </p>
                                  )}
                                  {asset.verified_at &&
                                    (asset.code || (asset.photos && asset.photos.length > 0) || (asset.status && asset.status !== "PENDING")) && (
                                      <p className="text-[11px] text-gh-faint mt-1">
                                        Verified: {new Date(asset.verified_at).toLocaleDateString("en-IN", {
                                          day: "numeric",
                                          month: "short",
                                          year: "numeric",
                                        })}{" "}
                                        {asset.verified_by_name ? `by ${asset.verified_by_name}` : ""}
                                        {asset.visit_branch_name ? ` @ ${asset.visit_branch_name}` : ""}
                                      </p>
                                    )}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Right: Photo Evidence Thumbnail & Actions */}
                          <div className="flex items-center gap-3 self-end md:self-center shrink-0">
                            {hasPhoto ? (
                              <button
                                onClick={() =>
                                  setSelectedPhoto({
                                    url: asset.photo_url || (asset.photos?.[0]?.photo_url ?? ""),
                                    title: `${emp?.name} - ${asset.asset_type_name}`,
                                    subtitle: `Code: ${asset.code || "Unlabeled"} · Captured during inspection`,
                                  })
                                }
                                className="group relative w-16 h-16 rounded-xl overflow-hidden border border-white/20 bg-black hover:border-blue-500 transition-all shadow-md"
                                title="Click to view full photo"
                              >
                                <img
                                  src={getMediaUrl(asset.photo_url || asset.photos?.[0]?.photo_url)}
                                  alt="Asset Evidence"
                                  className="w-full h-full object-cover group-hover:scale-110 transition-transform"
                                />
                                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                  <span className="text-white text-xs font-bold">🔍</span>
                                </div>
                              </button>
                            ) : (
                              canManage && (
                                <button
                                  onClick={() => {
                                    setPhotoTargetTypeId(asset.asset_type_id);
                                    fileInputRef.current?.click();
                                  }}
                                  className="px-3 py-2 border border-dashed border-white/20 hover:border-blue-500 rounded-xl text-xs text-gh-muted hover:text-[#58a6ff] flex items-center gap-1.5 transition-colors"
                                >
                                  <span>📷</span>
                                  <span>+ Upload Photo</span>
                                </button>
                              )
                            )}

                            {canManage && !isEditing && (
                              <button
                                onClick={() => {
                                  setEditingRowId(asset.id ?? asset.asset_type_id);
                                  setEditCode(asset.code ?? "");
                                  setEditRemark(asset.remark ?? "");
                                }}
                                className="text-xs text-[#58a6ff] hover:underline px-2 py-1"
                              >
                                Edit Code
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Database Retention Notice */}
              <div className="p-3.5 rounded-xl bg-blue-500/[0.06] border border-blue-500/20 text-xs text-gh-muted flex items-center gap-2.5">
                <span className="text-base">🔒</span>
                <span>
                  <strong>Permanent Compliance Database:</strong> All employee asset codes, OCR plates, and photos are permanently retained. You can retrieve evidence records anytime in future audits.
                </span>
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-gh-border flex justify-end bg-gh-canvas/40">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      {selectedPhoto && (
        <PhotoLightboxModal
          photoUrl={selectedPhoto.url}
          title={selectedPhoto.title}
          subtitle={selectedPhoto.subtitle}
          onClose={() => setSelectedPhoto(null)}
        />
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Create / Edit Employee Modals                                              */
/* -------------------------------------------------------------------------- */
function CreateEmployeeModal({
  branches,
  initial,
  onClose,
  onSaved,
}: {
  branches: any[];
  initial?: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [empCode, setEmpCode] = useState(initial?.emp_code ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [department, setDepartment] = useState(initial?.department ?? "");
  const [branchId, setBranchId] = useState(initial?.branch_id ?? branches[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (initial) {
        return (await api.patch(`/employees/${initial.id}`, { emp_code: empCode, name, department: department || null, branch_id: branchId })).data;
      }
      return (await api.post("/employees", { emp_code: empCode, name, department: department || null, branch_id: branchId })).data;
    },
    onSuccess: () => { onSaved(); onClose(); },
    onError: async (e: any) => setError(await getErrorMessage(e)),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gh-panel border border-gh-border rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold mb-4">{initial ? "Edit Employee" : "Add Employee"}</h2>
        {error && <p className="text-[#f85149] text-sm mb-3">{error}</p>}
        <div className="space-y-3">
          <Input label="Emp Code" placeholder="EMP123" value={empCode} onChange={(e) => setEmpCode(e.target.value)} />
          <Input label="Emp Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Department" placeholder="Operations" value={department} onChange={(e) => setDepartment(e.target.value)} />
          <Select label="Branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            {branches.map((b: any) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => saveMut.mutate()} disabled={!empCode || !name || !branchId} className="flex-1">
              {initial ? "Save Changes" : "Add Employee"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);

  const importMut = useMutation({
    mutationFn: async () => {
      const file = fileRef.current?.files?.[0];
      if (!file) throw new Error("Choose a file first");
      const fd = new FormData();
      fd.append("file", file);
      return (await api.post("/employees/import", fd, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: (r) => { setResult(r); onImported(); },
    onError: async (e: any) => { setError(await getErrorMessage(e)); setResult(null); },
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gh-panel border border-gh-border rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold mb-1">Import Employees</h2>
        <p className="text-xs text-gh-faint mb-4">
          Upload a .xlsx or .csv with columns: Employee Code, Employee Name, Department, Branch.
          Optional columns: Region, Area, Employment Status. Super admin uploads auto-create
          missing regions, areas and branches from the file.
        </p>
        {error && <p className="text-[#f85149] text-sm mb-3">{error}</p>}
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv"
          className="block w-full text-sm border border-dashed border-[#30363d] rounded-lg px-3 py-4 mb-3 bg-gh-canvas text-gh-muted" />

        {result && (
          <div className="text-sm bg-[#3fb950]/10 border border-[#3fb950]/25 rounded-lg p-3 mb-3">
            <p className="font-semibold text-[#3fb950]">Imported: {result.total} rows</p>
            <p className="text-[#3fb950]">Created {result.created} · Updated {result.updated} · Skipped {result.skipped}</p>
            {(result.created_regions > 0 || result.created_areas > 0 || result.created_branches > 0) && (
              <p className="mt-1 text-[#58a6ff]">
                Org created: {result.created_regions} regions · {result.created_areas} areas · {result.created_branches} branches
              </p>
            )}
            {result.errors?.length > 0 && (
              <ul className="mt-2 text-xs text-[#d29922] max-h-28 overflow-y-auto list-disc pl-4">
                {result.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}
              </ul>
            )}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button variant="success" onClick={() => importMut.mutate()} disabled={importMut.isPending} className="flex-1">
            {importMut.isPending ? "Importing…" : "Upload & Import"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TypesCard() {
  const { data, refetch } = useQuery({
    queryKey: ["it-asset-types"],
    queryFn: async () => (await api.get("/it-asset-types")).data,
  });
  const [name, setName] = useState("");

  const addMut = useMutation({
    mutationFn: async () => (await api.post("/it-asset-types", { name })).data,
    onSuccess: async () => { setName(""); refetch(); },
  });

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="font-semibold text-gh-text">Expected IT Asset Types</h3>
          <p className="text-xs text-gh-muted mt-0.5">
            Every employee in scope is pre-assigned one row per type for verification on each visit.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        {(data ?? []).map((t: any) => (
          <Badge key={t.id} className={t.is_active ? ROLE_LABEL.ADMIN : "bg-slate-400"}>{t.name}</Badge>
        ))}
        {(data ?? []).length === 0 && <span className="text-xs text-gh-faint">No asset types yet.</span>}
      </div>
      <div className="flex gap-2">
        <Input placeholder="New type (e.g. Monitor)" value={name} onChange={(e) => setName(e.target.value)} className="max-w-xs" />
        <Button onClick={() => addMut.mutate()} disabled={!name.trim()} variant="secondary">Add Type</Button>
      </div>
      {addMut.isError && <p className="text-[#f85149] text-xs mt-2">{addMut.error instanceof Error ? addMut.error.message : ""}</p>}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Main Employees Page Component                                              */
/* -------------------------------------------------------------------------- */
export default function EmployeesPage() {
  const { user } = useAuth();
  const canManage = !!user &&
    ["SUPER_ADMIN", "ADMIN", "HOD", "REGIONAL_ADMIN"].some((r) => (user.roles ?? []).some((x: any) => x.name === r));
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [viewingEmployee, setViewingEmployee] = useState<any | null>(null);
  const [showImport, setShowImport] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["employees"],
    queryFn: async () => (await api.get("/employees", { params: { limit: 10000 } })).data,
  });
  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: async () => (await api.get("/branches")).data,
  });

  const departments = Array.from(new Set((data ?? []).map((e: any) => e.department).filter(Boolean))) as string[];

  const removeMut = useMutation({
    mutationFn: async (id: string) => (await api.delete(`/employees/${id}`)).data,
    onSuccess: () => refetch(),
    onError: async (e: any) => alert(await getErrorMessage(e)),
  });

  const employeeColumns: ColumnDef[] = [
    {
      key: "emp_code",
      label: "Emp Code",
      render: (e) => (
        <span className="font-mono text-[13px] text-[#58a6ff] font-medium">{e.emp_code}</span>
      ),
    },
    {
      key: "name",
      label: "Name",
      render: (e) => <span className="font-medium text-gh-text">{e.name}</span>,
    },
    {
      key: "department",
      label: "Department",
      render: (e) => <span className="text-gh-muted">{e.department ?? "-"}</span>,
    },
    {
      key: "branch_name",
      label: "Branch",
      render: (e) => <span className="text-gh-muted">{e.branch_name ?? "-"}</span>,
    },
    {
      key: "status",
      label: "Status",
      options: ["Active", "Inactive"],
      render: (e) => (
        <Badge className={e.is_active ? "bg-emerald-600" : "bg-slate-500"}>
          {e.is_active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "verified",
      label: "Verified",
      align: "center",
      noFilter: true,
      render: (e) => {
        const pct = e.total_assets > 0 ? Math.round((e.verified_count / e.total_assets) * 100) : 0;
        return (
          <span
            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs font-semibold font-mono mono-num ${
              pct === 100
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                : pct > 0
                ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                : "bg-white/[0.04] border-white/[0.08] text-gh-muted"
            }`}
            title={`${pct}% of expected assets verified with a code`}
          >
            💻 {e.verified_count}/{e.total_assets}
          </span>
        );
      },
    },
    ...(canManage
      ? [
          {
            key: "_actions",
            label: "Actions",
            noFilter: true,
            render: (e: any) => (
              <div className="flex items-center gap-2" onClick={(ev: any) => ev.stopPropagation()}>
                <button
                  onClick={() => setViewingEmployee(e)}
                  className="text-xs text-[#58a6ff] hover:underline font-semibold"
                >
                  Assets
                </button>
                <span className="text-gh-faint">·</span>
                <button onClick={() => setEditing(e)} className="text-xs text-gh-muted hover:text-white">
                  Edit
                </button>
                <span className="text-gh-faint">·</span>
                <button
                  onClick={() => {
                    if (confirm(`Deactivate ${e.name}?`)) removeMut.mutate(e.id);
                  }}
                  className="text-xs text-[#f85149] hover:underline"
                >
                  Off
                </button>
              </div>
            ),
          } as ColumnDef,
        ]
      : []),
  ];

  const templateUrl = () => {
    const base = API_URL.replace(/\/api\/v1\/?$/, "");
    const token = Cookies.get("access_token");
    return `${base}/api/v1/employees/template?token=${encodeURIComponent(token ?? "")}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Employees & IT Asset Registry</h1>
          <p className="text-sm text-gh-muted mt-0.5">
            Click any employee to view their permanent IT asset codes, serials & photo evidence
          </p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <a href={templateUrl()}>
              <Button variant="secondary">⬇ Template</Button>
            </a>
            <Button variant="secondary" onClick={() => setShowImport(true)}>⬆ Import</Button>
            <Button onClick={() => setShowCreate(true)}>+ Add Employee</Button>
          </div>
        )}
      </div>

      <TypesCard />

      {isLoading ? <Spinner /> : (
        <DataTable
          columns={employeeColumns}
          rows={data ?? []}
          pageSize={100}
          onRowClick={(e) => setViewingEmployee(e)}
          emptyMessage="No employees found."
          exportName="employees"
        />
      )}

      {/* View Assets & Evidence Modal */}
      {viewingEmployee && (
        <EmployeeAssetModal
          employee={viewingEmployee}
          canManage={canManage}
          onClose={() => setViewingEmployee(null)}
        />
      )}

      {showCreate && (
        <CreateEmployeeModal
          branches={branches.data ?? []}
          onClose={() => setShowCreate(false)}
          onSaved={() => refetch()}
        />
      )}
      {editing && (
        <CreateEmployeeModal
          branches={branches.data ?? []}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => refetch()}
        />
      )}
      {showImport && (
        <ImportModal onClose={() => setShowImport(false)} onImported={() => refetch()} />
      )}
    </div>
  );
}