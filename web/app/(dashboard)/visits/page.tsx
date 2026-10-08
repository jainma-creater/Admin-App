"use client";

import { Suspense, useDeferredValue, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api, getErrorMessage, getMediaUrl, STATUS_COLORS, ACTION_STATUS_COLORS } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Card, Badge, Button, Input, Select, Table, Spinner, EmptyState, Chip, KpiTile } from "@/components/ui";
import { PhotoReviewModal } from "@/components/PhotoReviewModal";

/* -------------------------------------------------------------------------- */
/* Constants & Types                                                          */
/* -------------------------------------------------------------------------- */

type TabType = "all-visits" | "it-assets" | "fixed-assets" | "gallery" | "actions";

const TABS: { id: TabType; label: string; icon: string }[] = [
  { id: "all-visits", label: "All Visits", icon: "📋" },
  { id: "it-assets", label: "IT Asset Audits", icon: "💻" },
  { id: "fixed-assets", label: "Fixed Assets", icon: "🪑" },
  { id: "gallery", label: "Evidence Gallery & Audit", icon: "📸" },
  { id: "actions", label: "Corrective Actions", icon: "⚠️" },
];

const VISIT_STATUSES = [
  "DRAFT",
  "ASSIGNED",
  "SCHEDULED",
  "IN_PROGRESS",
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "CLOSED",
  "REJECTED",
  "REWORK_REQUIRED",
  "RESUBMITTED",
];

const FIXED_CATEGORIES = ["Fan", "Chair", "Table", "Locker", "Almirah", "Fire Extinguisher", "Signboard"];

/* -------------------------------------------------------------------------- */
/* Create Visit Modal                                                         */
/* -------------------------------------------------------------------------- */
function CreateVisitModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [branchId, setBranchId] = useState("");
  const [visitTypeId, setVisitTypeId] = useState("");
  const [visitorId, setVisitorId] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [instructions, setInstructions] = useState("");
  const [error, setError] = useState<string | null>(null);

  const branches = useQuery({ queryKey: ["branches"], queryFn: async () => (await api.get("/branches?limit=500")).data });
  const visitTypes = useQuery({ queryKey: ["visit-types"], queryFn: async () => (await api.get("/checklists/visit-types")).data });
  const users = useQuery({ queryKey: ["users"], queryFn: async () => (await api.get("/users")).data });

  const createMut = useMutation({
    mutationFn: async () =>
      (
        await api.post("/visits", {
          branch_id: branchId,
          visit_type_id: visitTypeId,
          visitor_ids: visitorId ? [visitorId] : [],
          reviewer_ids: reviewerId ? [reviewerId] : [],
          scheduled_date: scheduledDate || null,
          priority,
          instructions: instructions || null,
        })
      ).data,
    onSuccess: () => {
      onCreated();
      onClose();
    },
    onError: async (e: any) => setError(await getErrorMessage(e)),
  });

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gh-panel border border-gh-border rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">Create New Branch Visit</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/10 text-gh-muted hover:text-white">✕</button>
        </div>
        {error && <p className="text-[#f85149] text-sm mb-3 bg-red-950/40 border border-red-800/40 p-2.5 rounded-lg">{error}</p>}
        <div className="space-y-4">
          <Select label="Branch *" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">Select branch...</option>
            {(branches.data ?? []).map((b: any) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code}) - {b.city || b.region_name || "Active"}
              </option>
            ))}
          </Select>
          <Select label="Visit Inspection Type *" value={visitTypeId} onChange={(e) => setVisitTypeId(e.target.value)}>
            <option value="">Select inspection module...</option>
            {(visitTypes.data ?? []).map((t: any) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select label="Assigned Field Inspector" value={visitorId} onChange={(e) => setVisitorId(e.target.value)}>
              <option value="">Unassigned</option>
              {(users.data ?? []).map((u: any) => (
                <option key={u.id} value={u.id}>{u.first_name} {u.last_name} ({u.email})</option>
              ))}
            </Select>
            <Select label="Reviewer / Admin" value={reviewerId} onChange={(e) => setReviewerId(e.target.value)}>
              <option value="">Unassigned</option>
              {(users.data ?? []).map((u: any) => (
                <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Scheduled Date" type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} />
            <Select label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </Select>
          </div>
          <Input label="Special Instructions / Scope Notes" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. Verify CCTV back-up & fire extinguishers" />
          <div className="flex gap-3 pt-3">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => createMut.mutate()} disabled={!branchId || !visitTypeId || createMut.isPending} className="flex-1">
              {createMut.isPending ? "Creating..." : "Create & Schedule Visit"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main Unified Visits Console Inner                                          */
/* -------------------------------------------------------------------------- */
function VisitsInner() {
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const { user } = useAuth();
  const canReview = !!user && ["SUPER_ADMIN", "ADMIN", "HOD", "REGIONAL_ADMIN", "AUDITOR"].some((r) =>
    (user.roles ?? []).some((x: any) => x.name === r)
  );

  const initialTab = (searchParams.get("tab") as TabType) || "all-visits";
  const [tab, setTab] = useState<TabType>(initialTab);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [selectedRegion, setSelectedRegion] = useState<string>(searchParams.get("region") ?? "ALL");
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [selectedStatus, setSelectedStatus] = useState<string>(searchParams.get("status") ?? "");
  const [selectedRowStatus, setSelectedRowStatus] = useState<string>("");
  const [selectedAssetType, setSelectedAssetType] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedPhoto, setSelectedPhoto] = useState<any | null>(null);

  // Queries
  const branchesQ = useQuery({
    queryKey: ["branches-list"],
    queryFn: async () => (await api.get("/branches?limit=500")).data,
  });
  const overviewQ = useQuery({
    queryKey: ["branch-overview"],
    queryFn: async () => (await api.get("/dashboard/branch-overview")).data,
  });
  const visitsQ = useQuery({
    queryKey: ["visits-main"],
    queryFn: async () => (await api.get("/visits", { params: { per_page: 500 } })).data,
  });
  const assetTypesQ = useQuery({
    queryKey: ["it-asset-types"],
    queryFn: async () => (await api.get("/it-asset-types")).data,
  });

  // Inspections Detail Queries (for IT & Fixed Asset tabs)
  const itInspectionsQ = useQuery({
    queryKey: ["inspections-it", selectedBranchId, selectedStatus, selectedRowStatus, selectedAssetType, deferredSearch],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (selectedBranchId) p.set("branch_id", selectedBranchId);
      if (selectedStatus) p.set("visit_status", selectedStatus);
      if (selectedRowStatus) p.set("row_status", selectedRowStatus);
      if (selectedAssetType) p.set("asset_type", selectedAssetType);
      if (deferredSearch) p.set("search", deferredSearch);
      return (await api.get(`/inspections/it-assets?${p.toString()}`)).data;
    },
    enabled: tab === "it-assets",
  });

  const fixedInspectionsQ = useQuery({
    queryKey: ["inspections-fixed", selectedBranchId, selectedStatus, selectedRowStatus, selectedCategory, deferredSearch],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (selectedBranchId) p.set("branch_id", selectedBranchId);
      if (selectedStatus) p.set("visit_status", selectedStatus);
      if (selectedRowStatus) p.set("row_status", selectedRowStatus);
      if (selectedCategory) p.set("category", selectedCategory);
      if (deferredSearch) p.set("search", deferredSearch);
      return (await api.get(`/inspections/fixed-assets?${p.toString()}`)).data;
    },
    enabled: tab === "fixed-assets",
  });

  // Gallery Photos Query
  const photosQ = useQuery({
    queryKey: ["gallery-photos", selectedBranchId, selectedStatus],
    queryFn: async () => {
      const params: any = { limit: 300 };
      if (selectedBranchId) params.branch_id = selectedBranchId;
      return (await api.get("/photos", { params })).data;
    },
    enabled: tab === "gallery",
  });

  // Actions Query
  const actionsQ = useQuery({
    queryKey: ["actions-list", selectedBranchId, selectedStatus],
    queryFn: async () => {
      const params: any = { limit: 200 };
      if (selectedBranchId) params.branch_id = selectedBranchId;
      if (selectedStatus) params.status = selectedStatus;
      return (await api.get("/actions", { params })).data;
    },
    enabled: tab === "actions",
  });

  const branches: any[] = branchesQ.data ?? [];
  const overview: any[] = overviewQ.data ?? [];
  const allVisits: any[] = visitsQ.data ?? [];

  const regions = useMemo(
    () => Array.from(new Set(overview.map((o) => o.region).filter(Boolean))).sort() as string[],
    [overview]
  );

  const branchNameToRegion = useMemo(() => {
    const m: Record<string, string> = {};
    for (const o of overview) m[o.name] = o.region;
    return m;
  }, [overview]);

  // Scoped visits for "all-visits" tab
  const filteredVisits = useMemo(() => {
    return allVisits.filter((v: any) => {
      if (selectedStatus && v.status !== selectedStatus) return false;
      if (selectedRegion !== "ALL" && (v.branch_name ? branchNameToRegion[v.branch_name] : null) !== selectedRegion) return false;
      if (selectedBranchId && v.branch_id !== selectedBranchId) return false;
      if (deferredSearch) {
        const q = deferredSearch.toLowerCase();
        const branchMatch = (v.branch_name ?? "").toLowerCase().includes(q);
        const typeMatch = (v.visit_type_name ?? "").toLowerCase().includes(q);
        const visitorMatch = (v.visitors?.[0]?.name ?? "").toLowerCase().includes(q);
        if (!branchMatch && !typeMatch && !visitorMatch) return false;
      }
      return true;
    });
  }, [allVisits, selectedStatus, selectedRegion, selectedBranchId, deferredSearch, branchNameToRegion]);

  // KPIs
  const kpis = useMemo(() => {
    const total = filteredVisits.length;
    const completed = filteredVisits.filter((v) => ["APPROVED", "CLOSED"].includes(v.status)).length;
    const pending = filteredVisits.filter((v) => ["SUBMITTED", "UNDER_REVIEW"].includes(v.status)).length;
    const inProgress = filteredVisits.filter((v) =>
      ["DRAFT", "ASSIGNED", "SCHEDULED", "IN_PROGRESS", "REWORK_REQUIRED", "RESUBMITTED"].includes(v.status)
    ).length;
    return { total, completed, pending, inProgress };
  }, [filteredVisits]);

  // Export link helper
  const exportUrl = useMemo(() => {
    if (tab === "it-assets") {
      const p = new URLSearchParams({ view: "it-assets" });
      if (selectedBranchId) p.set("branch_id", selectedBranchId);
      if (selectedStatus) p.set("visit_status", selectedStatus);
      if (selectedRowStatus) p.set("row_status", selectedRowStatus);
      if (selectedAssetType) p.set("asset_type", selectedAssetType);
      if (deferredSearch) p.set("search", deferredSearch);
      return getMediaUrl(`/api/v1/inspections/export?${p.toString()}`);
    }
    if (tab === "fixed-assets") {
      const p = new URLSearchParams({ view: "fixed-assets" });
      if (selectedBranchId) p.set("branch_id", selectedBranchId);
      if (selectedStatus) p.set("visit_status", selectedStatus);
      if (selectedRowStatus) p.set("row_status", selectedRowStatus);
      if (selectedCategory) p.set("category", selectedCategory);
      if (deferredSearch) p.set("search", deferredSearch);
      return getMediaUrl(`/api/v1/inspections/export?${p.toString()}`);
    }
    // Default branch visit export
    const p = new URLSearchParams({ view: "branch" });
    if (selectedBranchId) p.set("branch_id", selectedBranchId);
    if (selectedStatus) p.set("visit_status", selectedStatus);
    if (deferredSearch) p.set("search", deferredSearch);
    return getMediaUrl(`/api/v1/inspections/export?${p.toString()}`);
  }, [tab, selectedBranchId, selectedStatus, selectedRowStatus, selectedAssetType, selectedCategory, deferredSearch]);

  return (
    <div className="space-y-6 max-w-[1440px]">
      {/* Top Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-white tracking-tight">Branch Inspection & Audit Operations</h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/25 text-[#58a6ff] font-semibold">
              Unified Hub
            </span>
          </div>
          <p className="text-sm text-gh-muted mt-1">
            Complete management of branch checklists, physical fixed assets, employee IT equipment, photos & corrective actions.
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <a
            href={exportUrl}
            target="_blank"
            rel="noreferrer"
            className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-[#21262d] hover:bg-[#30363d] text-[#e6edf3] border border-white/[0.12] transition-colors flex items-center gap-1.5"
          >
            <span>⬇</span>
            <span>Export Excel</span>
          </a>
          <Button onClick={() => setShowCreate(true)} className="px-4 py-2 text-xs font-bold rounded-xl shadow-glow">
            + Schedule New Visit
          </Button>
        </div>
      </header>

      {/* KPI Tiles Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiTile
          index={1}
          label="Total Visits in Scope"
          value={kpis.total}
          sub="inspections logged"
          tone="blue"
        />
        <KpiTile
          index={2}
          label="Awaiting Review"
          value={kpis.pending}
          sub="submitted by inspectors"
          tone="amber"
        />
        <KpiTile
          index={3}
          label="In Progress / Draft"
          value={kpis.inProgress}
          sub="active on mobile"
          tone="cyan"
        />
        <KpiTile
          index={4}
          label="Approved & Closed"
          value={kpis.completed}
          sub="100% compliant audits"
          tone="green"
        />
      </div>

      {/* Primary Navigation Tabs */}
      <div className="flex border-b border-white/[0.08] gap-2 overflow-x-auto pb-px gh-scroll">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
                setSelectedStatus("");
                setSelectedRowStatus("");
              }}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${
                active
                  ? "border-[#2f81f7] text-[#58a6ff] bg-white/[0.03]"
                  : "border-transparent text-gh-muted hover:text-[#e6edf3] hover:bg-white/[0.02]"
              }`}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
              {t.id === "all-visits" && (
                <span className="text-[11px] font-mono px-1.5 py-0.2 rounded-full bg-white/10 text-gh-muted">
                  {kpis.total}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Filter Toolbar */}
      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Input
            placeholder="Search branch, inspector, code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <Select value={selectedBranchId} onChange={(e) => setSelectedBranchId(e.target.value)}>
            <option value="">All Branches ({branches.length})</option>
            {branches.map((b: any) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.code})
              </option>
            ))}
          </Select>

          <Select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)}>
            <option value="">All Visit Statuses</option>
            {VISIT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </Select>

          {/* Contextual Filters per Tab */}
          {tab === "it-assets" && (
            <Select value={selectedAssetType} onChange={(e) => setSelectedAssetType(e.target.value)}>
              <option value="">All IT Asset Types</option>
              {(assetTypesQ.data ?? []).map((t: any) => (
                <option key={t.id} value={t.name}>{t.name}</option>
              ))}
            </Select>
          )}

          {tab === "fixed-assets" && (
            <Select value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}>
              <option value="">All Asset Categories</option>
              {FIXED_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          )}

          {(tab === "it-assets" || tab === "fixed-assets") && (
            <Select value={selectedRowStatus} onChange={(e) => setSelectedRowStatus(e.target.value)}>
              <option value="">All Verification Status</option>
              <option value="VERIFIED">✓ Verified</option>
              <option value="PENDING">⏳ Pending Audit</option>
              <option value="NOT_FOUND">⚠️ Not Found</option>
            </Select>
          )}
        </div>

        {/* Region Pills (All Visits Tab) */}
        {tab === "all-visits" && regions.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pt-1 gh-scroll">
            <span className="text-[11px] font-semibold text-gh-muted uppercase tracking-wider mr-1">Region:</span>
            <Chip active={selectedRegion === "ALL"} onClick={() => setSelectedRegion("ALL")}>
              All Regions
            </Chip>
            {regions.map((r) => (
              <Chip key={r} active={selectedRegion === r} onClick={() => setSelectedRegion(r)}>
                {r}
              </Chip>
            ))}
          </div>
        )}
      </Card>

      {/* ==================================================================== */}
      {/* TAB 1: ALL VISITS OVERVIEW                                           */}
      {/* ==================================================================== */}
      {tab === "all-visits" && (
        <Card className="overflow-hidden">
          {visitsQ.isLoading ? (
            <Spinner />
          ) : filteredVisits.length === 0 ? (
            <div className="p-10"><EmptyState message="No visits match the selected filter criteria." /></div>
          ) : (
            <Table headers={["#", "Branch Name & Code", "Inspection Module", "Status", "Progress", "Compliance", "Assigned Inspector", "Scheduled", "Actions"]}>
              {filteredVisits.map((v: any, idx: number) => {
                const isComplete = ["APPROVED", "CLOSED"].includes(v.status);
                const isPending = ["SUBMITTED", "UNDER_REVIEW"].includes(v.status);

                return (
                  <tr key={v.id} className="hover:bg-white/[0.03] transition-colors">
                    <td className="px-4 py-3 text-gh-faint font-mono text-xs">{idx + 1}</td>
                    <td className="px-4 py-3">
                      <Link href={`/visits/${v.id}`} className="font-bold text-[#58a6ff] hover:underline flex items-center gap-1.5">
                        <span>{v.branch_name ?? "Branch"}</span>
                      </Link>
                      <div className="flex items-center gap-2 mt-0.5 text-xs text-gh-muted font-mono">
                        <span>{v.branch_code ?? "—"}</span>
                        {v.branch_name && branchNameToRegion[v.branch_name] && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-500/10 border border-purple-500/20 text-[#bc8cff]">
                            {branchNameToRegion[v.branch_name]}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gh-muted text-xs font-medium">
                      {v.visit_type_name ?? "General Audit"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={STATUS_COLORS[v.status] ?? "bg-slate-500"}>
                        {v.status.replace("_", " ")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gh-muted">
                      {v.total_items > 0 ? `${v.completed_items}/${v.total_items}` : "—"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {v.compliance_percentage != null ? (
                        <span
                          className={`font-bold ${
                            v.compliance_percentage >= 85
                              ? "text-emerald-400"
                              : v.compliance_percentage >= 60
                              ? "text-amber-400"
                              : "text-red-400"
                          }`}
                        >
                          {v.compliance_percentage}%
                        </span>
                      ) : (
                        <span className="text-gh-faint">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gh-muted">
                      {v.visitors?.[0]?.name ?? <span className="text-gh-faint italic">Unassigned</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gh-muted font-mono whitespace-nowrap">
                      {v.scheduled_date ? new Date(v.scheduled_date).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/visits/${v.id}`}
                          className="px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/25 text-[#58a6ff] hover:bg-blue-500/20 text-xs font-semibold transition-colors"
                        >
                          {isPending ? "Review →" : "Inspect →"}
                        </Link>
                        {isComplete && (
                          <Link
                            href={`/reports/${v.id}`}
                            className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20 text-xs font-semibold transition-colors"
                          >
                            Report
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Card>
      )}

      {/* ==================================================================== */}
      {/* TAB 2: IT ASSET AUDITS                                               */}
      {/* ==================================================================== */}
      {tab === "it-assets" && (
        <Card className="overflow-hidden">
          {itInspectionsQ.isLoading ? (
            <Spinner />
          ) : (itInspectionsQ.data ?? []).length === 0 ? (
            <div className="p-10"><EmptyState message="No IT asset records found matching criteria." /></div>
          ) : (
            <Table headers={["Photo", "Branch", "Employee", "Department", "Asset Type", "Serial / Code", "Audit Status", "Remark", "Visit Status", "Submitted"]}>
              {(itInspectionsQ.data ?? []).map((r: any) => (
                <tr key={r.id} className="hover:bg-white/[0.03]">
                  <td className="px-4 py-3">
                    {r.photo?.photo_thumbnail_url ? (
                      <img
                        src={getMediaUrl(r.photo.photo_thumbnail_url)}
                        alt="Asset"
                        className="h-10 w-10 rounded-lg object-cover border border-white/10 cursor-pointer"
                        onClick={() => setSelectedPhoto({ url: r.photo.photo_url, title: `${r.employee_name} - ${r.asset_type_name}` })}
                      />
                    ) : (
                      <span className="text-gh-faint text-xs">No photo</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-semibold text-white">{r.branch_name}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gh-text text-xs">{r.employee_name ?? "—"}</div>
                    <div className="text-[11px] text-[#58a6ff] font-mono">{r.employee_code ?? ""}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gh-muted">{r.department ?? "—"}</td>
                  <td className="px-4 py-3 text-xs font-semibold text-white">{r.asset_type_name}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {r.code ? (
                      <span className="px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/30 text-[#58a6ff] font-bold">
                        {r.code}
                      </span>
                    ) : (
                      <span className="text-gh-faint italic">No code</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={r.status === "VERIFIED" ? "bg-emerald-600" : r.status === "NOT_FOUND" ? "bg-red-600" : "bg-amber-600"}>
                      {r.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-gh-muted max-w-[12rem] truncate">{r.remark ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge className={STATUS_COLORS[r.visit_status] ?? "bg-slate-500"}>{r.visit_status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-gh-muted font-mono whitespace-nowrap">
                    {r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {/* ==================================================================== */}
      {/* TAB 3: FIXED ASSETS                                                  */}
      {/* ==================================================================== */}
      {tab === "fixed-assets" && (
        <Card className="overflow-hidden">
          {fixedInspectionsQ.isLoading ? (
            <Spinner />
          ) : (fixedInspectionsQ.data ?? []).length === 0 ? (
            <div className="p-10"><EmptyState message="No fixed asset inspections found matching filters." /></div>
          ) : (
            <Table headers={["Photo", "Branch", "Category", "Description", "Serial / Code", "Audit Status", "Visit Status", "Submitted"]}>
              {(fixedInspectionsQ.data ?? []).map((r: any) => (
                <tr key={r.id} className="hover:bg-white/[0.03]">
                  <td className="px-4 py-3">
                    {r.photo?.photo_thumbnail_url ? (
                      <img
                        src={getMediaUrl(r.photo.photo_thumbnail_url)}
                        alt="Fixed Asset"
                        className="h-10 w-10 rounded-lg object-cover border border-white/10 cursor-pointer"
                        onClick={() => setSelectedPhoto({ url: r.photo.photo_url, title: `${r.branch_name} - ${r.category}` })}
                      />
                    ) : (
                      <span className="text-gh-faint text-xs">No photo</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-semibold text-white">{r.branch_name}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-md text-xs font-bold bg-purple-500/10 border border-purple-500/30 text-[#bc8cff]">
                      {r.category}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gh-muted">{r.name ?? "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {r.code ? (
                      <span className="px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/30 text-[#58a6ff] font-bold">
                        {r.code}
                      </span>
                    ) : (
                      <span className="text-gh-faint italic">No code</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={r.status === "VERIFIED" ? "bg-emerald-600" : r.status === "NOT_FOUND" ? "bg-red-600" : "bg-amber-600"}>
                      {r.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge className={STATUS_COLORS[r.visit_status] ?? "bg-slate-500"}>{r.visit_status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-gh-muted font-mono whitespace-nowrap">
                    {r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {/* ==================================================================== */}
      {/* TAB 4: EVIDENCE GALLERY & QUALITY AUDIT                              */}
      {/* ==================================================================== */}
      {tab === "gallery" && (
        <div>
          {photosQ.isLoading ? (
            <Spinner />
          ) : (photosQ.data ?? []).length === 0 ? (
            <Card className="p-8"><EmptyState message="No photo evidence uploaded yet." /></Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
              {(photosQ.data ?? []).map((p: any) => {
                const isRejected = p.status === "REJECTED";
                return (
                  <div
                    key={p.id}
                    onClick={() => setSelectedPhoto(p)}
                    className={`group relative block rounded-xl overflow-hidden border cursor-pointer transition-all shadow-md hover:shadow-xl ${
                      isRejected ? "border-red-500/50 bg-red-950/20" : "border-gh-border bg-gh-panel hover:border-blue-500/60"
                    }`}
                  >
                    <div className="aspect-square relative overflow-hidden bg-black">
                      <img
                        src={getMediaUrl(p.thumbnail_url ?? p.url)}
                        alt={p.caption || "Evidence"}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                      <div className="absolute top-2 left-2">
                        {isRejected ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-600 text-white shadow">
                            ⚠️ Rejected
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-600 text-white shadow">
                            ✓ OK
                          </span>
                        )}
                      </div>
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                        <span className="text-white text-xs font-bold bg-black/60 px-2 py-1 rounded-md">
                          🔍 Review
                        </span>
                      </div>
                    </div>
                    <div className="p-2.5 space-y-1">
                      <p className="text-xs font-semibold text-white truncate">{p.branch_name ?? "Branch"}</p>
                      {p.caption && <p className="text-[11px] text-gh-muted truncate italic">{p.caption}</p>}
                      {isRejected && p.rejection_reason && (
                        <p className="text-[10px] font-medium text-red-400 truncate">Reason: {p.rejection_reason}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 5: CORRECTIVE ACTIONS                                            */}
      {/* ==================================================================== */}
      {tab === "actions" && (
        <Card className="overflow-hidden">
          {actionsQ.isLoading ? (
            <Spinner />
          ) : (actionsQ.data ?? []).length === 0 ? (
            <div className="p-10"><EmptyState message="No pending corrective actions." /></div>
          ) : (
            <Table headers={["Action Title", "Branch", "Priority", "Responsible Person", "Target Date", "Status"]}>
              {(actionsQ.data ?? []).map((a: any) => (
                <tr key={a.id} className="hover:bg-white/[0.03]">
                  <td className="px-4 py-3 font-semibold text-white">{a.title}</td>
                  <td className="px-4 py-3 text-xs text-gh-muted">{a.branch_name ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge
                      className={
                        a.priority === "CRITICAL"
                          ? "bg-red-600"
                          : a.priority === "HIGH"
                          ? "bg-orange-500"
                          : a.priority === "MEDIUM"
                          ? "bg-amber-500"
                          : "bg-slate-500"
                      }
                    >
                      {a.priority}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-gh-muted">{a.responsible_person_name ?? "Unassigned"}</td>
                  <td className="px-4 py-3 text-xs text-gh-muted font-mono">{a.target_date ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge className={ACTION_STATUS_COLORS[a.status] ?? "bg-slate-500"}>
                      {a.status.replace("_", " ")}
                    </Badge>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {/* Modals */}
      {showCreate && (
        <CreateVisitModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            visitsQ.refetch();
            overviewQ.refetch();
          }}
        />
      )}

      {selectedPhoto && (
        <PhotoReviewModal
          photo={selectedPhoto}
          canReview={canReview}
          onClose={() => setSelectedPhoto(null)}
          onUpdated={() => {
            qc.invalidateQueries({ queryKey: ["gallery-photos"] });
            qc.invalidateQueries({ queryKey: ["inspections-it"] });
            qc.invalidateQueries({ queryKey: ["inspections-fixed"] });
          }}
        />
      )}
    </div>
  );
}

export default function VisitsPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <VisitsInner />
    </Suspense>
  );
}
