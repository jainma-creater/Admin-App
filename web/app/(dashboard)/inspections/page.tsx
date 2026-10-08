"use client";

import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api, getMediaUrl, STATUS_COLORS } from "@/lib/api";
import { Button, Card, Select, Input, Badge, Table, Spinner, EmptyState } from "@/components/ui";

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

const ROW_STATUSES = ["PENDING", "VERIFIED", "NOT_FOUND"];
const CATEGORIES = ["Fan", "Chair", "Table", "Phone", "AC"];

type View = "branch" | "it-assets" | "fixed-assets";

const VIEW_TABS: { id: View; label: string }[] = [
  { id: "branch", label: "Branch Inspections" },
  { id: "it-assets", label: "IT Assets" },
  { id: "fixed-assets", label: "Fixed Assets" },
];

export default function InspectionsPage() {
  const [view, setView] = useState<View>("branch");
  const [branchId, setBranchId] = useState("");
  const [visitStatus, setVisitStatus] = useState("");
  const [rowStatus, setRowStatus] = useState("");
  const [assetType, setAssetType] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  const { data: branches = [] } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => {
      const res = await api.get("/branches");
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const { data: assetTypes = [] } = useQuery({
    queryKey: ["it-asset-types"],
    queryFn: async () => {
      const res = await api.get("/it-asset-types");
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (branchId) p.set("branch_id", branchId);
    if (visitStatus) p.set("visit_status", visitStatus);
    if (rowStatus && view !== "branch") p.set("row_status", rowStatus);
    if (assetType && view === "it-assets") p.set("asset_type", assetType);
    if (category && view === "fixed-assets") p.set("category", category);
    if (deferredSearch) p.set("search", deferredSearch);
    return p;
  }, [view, branchId, visitStatus, rowStatus, assetType, category, deferredSearch]);

  const { data: rows, isLoading, isError, refetch } = useQuery({
    queryKey: ["inspections", view, params.toString()],
    queryFn: async () => {
      const qs = params.toString();
      return (await api.get(`/inspections/${view}${qs ? `?${qs}` : ""}`)).data;
    },
  });

  const list: any[] = rows ?? [];

  const exportUrl = useMemo(() => {
    const p = new URLSearchParams({ view });
    for (const [k, v] of Array.from(params.entries())) {
      if (k === "branch_id" || k === "visit_status" || k === "row_status" || k === "asset_type" || k === "category" || k === "search") p.set(k, v);
    }
    return getMediaUrl(`/api/v1/inspections/export?${p.toString()}`);
  }, [view, params]);

  const branchOptions = useMemo(
    () => [...branches].sort((a: any, b: any) => (a.name ?? "").localeCompare(b.name ?? "")),
    [branches]
  );

  const switchTab = (next: View) => {
    setView(next);
    setRowStatus("");
    setAssetType("");
    setCategory("");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Inspections</h1>
          <p className="text-gh-muted text-sm mt-1">
            Consolidated view of Branch, Fixed Asset and IT Asset inspections with photo evidence and Excel export.
          </p>
        </div>
        <a
          href={exportUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-[#21262d] hover:bg-[#30363d] text-[#e6edf3] border border-white/[0.12]"
        >
          ⬇ Export Excel
        </a>
      </div>

      <Card className="p-2 flex gap-1 overflow-x-auto">
        {VIEW_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => switchTab(t.id)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              view === t.id
                ? "bg-[#2f81f7]/15 text-[#58a6ff]"
                : "text-gh-muted hover:text-[#e6edf3] hover:bg-white/[0.05]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </Card>

      <Card className="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Select label="Branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">All branches</option>
            {branchOptions.map((b: any) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
          <Select label="Visit status" value={visitStatus} onChange={(e) => setVisitStatus(e.target.value)}>
            <option value="">Any status</option>
            {VISIT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </Select>
          {view === "it-assets" && (
            <Select label="Asset type" value={assetType} onChange={(e) => setAssetType(e.target.value)}>
              <option value="">All types</option>
              {assetTypes.map((t: any) => (
                <option key={t.id} value={t.name}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
          {view === "fixed-assets" && (
            <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          )}
          {view !== "branch" && (
            <Select label="Row status" value={rowStatus} onChange={(e) => setRowStatus(e.target.value)}>
              <option value="">Any status</option>
              {ROW_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </Select>
          )}
          <div className={view === "branch" ? "sm:col-span-2" : ""}>
            <Input
              label="Search"
              placeholder={
                view === "it-assets"
                  ? "Employee name / code / asset code…"
                  : view === "fixed-assets"
                    ? "Asset name / code…"
                    : "Branch name / code…"
              }
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="p-10 flex justify-center">
            <Spinner />
          </div>
        ) : isError ? (
          <div className="p-10 text-center text-sm text-[#f85149]">
            Could not load inspections.{" "}
            <button className="underline hover:text-white" onClick={() => refetch()}>
              Retry
            </button>
          </div>
        ) : list.length === 0 ? (
          <div className="p-10">
            <EmptyState message="No inspections match the current filters." />
          </div>
        ) : view === "branch" ? (
          <Table
            headers={["Branch", "Scheduled", "Submitted", "Compliance", "Photos", "Items", "Submitter", "Reviewers", "Status", ""]}
          >
            {list.map((v: any) => (
              <tr key={v.visit_id} className="hover:bg-white/[0.04]">
                <td className="px-4 py-3">
                  <div className="font-medium">{v.branch_name}</div>
                  <div className="text-xs text-gh-muted">{v.branch_code}</div>
                </td>
                <td className="px-4 py-3 text-gh-muted whitespace-nowrap">
                  {v.scheduled_date ? new Date(v.scheduled_date).toLocaleDateString() : "-"}
                </td>
                <td className="px-4 py-3 text-gh-muted whitespace-nowrap">
                  {v.submitted_at ? new Date(v.submitted_at).toLocaleString() : "-"}
                </td>
                <td className="px-4 py-3 text-gh-muted">
                  {v.compliance_percentage != null ? `${v.compliance_percentage}%` : "-"}
                </td>
                <td className="px-4 py-3 text-gh-muted">{v.photos}</td>
                <td className="px-4 py-3 text-gh-muted">
                  {v.total_items > 0 ? (
                    <Badge
                      className={
                        v.notok_items
                          ? "bg-amber-500"
                          : v.ok_items === v.total_items
                            ? "bg-emerald-500"
                            : "bg-slate-400"
                      }
                    >
                      {v.ok_items}/{v.total_items} OK
                    </Badge>
                  ) : (
                    "-"
                  )}
                </td>
                <td className="px-4 py-3 text-gh-muted">{v.submitter ?? "-"}</td>
                <td className="px-4 py-3 text-gh-muted">{v.reviewers?.join(", ") || "-"}</td>
                <td className="px-4 py-3">
                  <Badge className={STATUS_COLORS[v.status] ?? "bg-slate-400"}>{v.status}</Badge>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/visits/${v.visit_id}`} className="text-[#58a6ff] hover:underline whitespace-nowrap">
                    Open →
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
        ) : view === "it-assets" ? (
          <Table headers={["Photo", "Branch", "Employee", "Department", "Asset", "Asset Code", "Status", "Remark", "Visit", "Submitted"]}>
            {list.slice(0, 500).map((r: any) => (
              <tr key={r.id} className="hover:bg-white/[0.04]">
                <td className="px-4 py-3">
                  {r.photo?.photo_thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={getMediaUrl(r.photo.photo_thumbnail_url)}
                      alt=""
                      className="h-10 w-10 rounded object-cover"
                    />
                  ) : (
                    <span className="text-gh-faint">—</span>
                  )}
                </td>
                <td className="px-4 py-3 font-medium">{r.branch_name}</td>
                <td className="px-4 py-3">
                  <div className="font-medium">{r.employee_name ?? "-"}</div>
                  <div className="text-xs text-gh-muted">{r.employee_code ?? ""}</div>
                </td>
                <td className="px-4 py-3 text-gh-muted">{r.department ?? "-"}</td>
                <td className="px-4 py-3 text-gh-muted">{r.asset_type_name ?? "-"}</td>
                <td className="px-4 py-3 font-mono text-xs">
                  {r.code ? (
                    <span className="inline-flex items-center gap-1">
                      {r.code}
                      {r.ocr_confirmed && <Badge className="bg-emerald-500">OCR</Badge>}
                    </span>
                  ) : (
                    <span className="text-gh-faint">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge
                    className={
                      r.status === "VERIFIED"
                        ? "bg-emerald-500"
                        : r.status === "NOT_FOUND"
                          ? "bg-red-500"
                          : "bg-amber-500"
                    }
                  >
                    {r.status?.replace("_", " ")}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-gh-muted max-w-[14rem] truncate" title={r.remark ?? ""}>
                  {r.remark ?? "-"}
                </td>
                <td className="px-4 py-3">
                  <Badge className={STATUS_COLORS[r.visit_status] ?? "bg-slate-400"}>{r.visit_status}</Badge>
                </td>
                <td className="px-4 py-3 text-gh-muted whitespace-nowrap">
                  {r.submitted_at ? new Date(r.submitted_at).toLocaleString() : "-"}
                </td>
              </tr>
            ))}
            {list.length > 500 && (
              <tr>
                <td colSpan={10} className="px-4 py-3 text-center text-xs text-gh-muted">
                  Showing first 500 of {list.length} rows — use filters or export to Excel for the full set.
                </td>
              </tr>
            )}
          </Table>
        ) : (
          <Table headers={["Photo", "Branch", "Category", "Name", "Code", "Status", "Visit", "Submitted"]}>
            {list.map((r: any) => (
              <tr key={r.id} className="hover:bg-white/[0.04]">
                <td className="px-4 py-3">
                  {r.photo?.photo_thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={getMediaUrl(r.photo.photo_thumbnail_url)}
                      alt=""
                      className="h-10 w-10 rounded object-cover"
                    />
                  ) : (
                    <span className="text-gh-faint">—</span>
                  )}
                </td>
                <td className="px-4 py-3 font-medium">{r.branch_name}</td>
                <td className="px-4 py-3">{r.category}</td>
                <td className="px-4 py-3 text-gh-muted">{r.name ?? "-"}</td>
                <td className="px-4 py-3 font-mono text-xs">
                  {r.code ? (
                    <span className="inline-flex items-center gap-1">
                      {r.code}
                      {r.ocr_confirmed && <Badge className="bg-emerald-500">OCR</Badge>}
                    </span>
                  ) : (
                    <span className="text-gh-faint">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge
                    className={
                      r.status === "VERIFIED"
                        ? "bg-emerald-500"
                        : r.status === "NOT_FOUND"
                          ? "bg-red-500"
                          : "bg-amber-500"
                    }
                  >
                    {r.status?.replace("_", " ")}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge className={STATUS_COLORS[r.visit_status] ?? "bg-slate-400"}>{r.visit_status}</Badge>
                </td>
                <td className="px-4 py-3 text-gh-muted whitespace-nowrap">
                  {r.submitted_at ? new Date(r.submitted_at).toLocaleString() : "-"}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {list.length > 0 && (
        <p className="text-xs text-gh-muted">
          {list.length} row{list.length === 1 ? "" : "s"} · export reflects the same filters.
        </p>
      )}
    </div>
  );
}