"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, STATUS_COLORS, ACTION_STATUS_COLORS } from "@/lib/api";
import { GlassPanel, Chip, KpiTile } from "@/components/ui";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const IN_PROGRESS_SET = new Set(["DRAFT", "ASSIGNED", "SCHEDULED", "IN_PROGRESS", "REWORK_REQUIRED", "RESUBMITTED"]);
const PENDING_SET = new Set(["SUBMITTED", "UNDER_REVIEW"]);
const DONE_SET = new Set(["APPROVED", "CLOSED"]);
const REVIEW_PIPELINE = new Set(["SUBMITTED", "UNDER_REVIEW", "RESUBMITTED", "REWORK_REQUIRED"]);
const OUTCOME_SET = new Set(["APPROVED", "CLOSED", "REJECTED"]);

const fmt = (n: number) => (n ?? 0).toLocaleString("en-US");

function RegionBadge({ region }: { region: string | null | undefined }) {
  if (!region) return <span className="text-[#7d8590]">—</span>;
  return (
    <span className="inline-flex items-center rounded-md border border-[#bc8cff]/25 bg-[#bc8cff]/10 px-1.5 py-0.5 text-[0.68rem] font-semibold text-[#bc8cff]">
      {region}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? "bg-slate-500";
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[0.68rem] font-semibold text-white ${color}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function ActionPill({ status }: { status: string }) {
  const color = ACTION_STATUS_COLORS[status] ?? "bg-slate-500";
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[0.68rem] font-semibold text-white ${color}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function Ledger({
  columns,
  rows,
  footer,
  lettered = true,
}: {
  columns: string[];
  rows: ReactNode[][];
  footer?: ReactNode[];
  lettered?: boolean;
}) {
  return (
    <div className="gh-scroll overflow-auto rounded-xl border border-white/[0.08]" style={{ maxHeight: 460 }}>
      <table className="ledger w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr>
            {lettered && <th className="px-3 py-2.5 w-10 text-center">#</th>}
            {columns.map((c) => (
              <th key={c} className="px-4 py-2.5 text-left">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={(lettered ? 1 : 0) + columns.length} className="px-4 py-12 text-center text-[#7d8590] text-sm">
                No records for the selection.
              </td>
            </tr>
          )}
          {rows.map((r, ri) => (
            <tr key={ri} className="transition-colors">
              {lettered && (
                <td className="px-3 py-2.5 text-center font-mono mono-num text-[0.7rem] text-[#484f58]">
                  {ri + 1}
                </td>
              )}
              {r.map((cell, ci) => (
                <td key={ci} className="px-4 py-2.5 text-[0.86rem] text-[#c9d1d9]">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && (
          <tfoot>
            <tr className="border-t border-white/[0.12]">
              {lettered && <td className="px-3 py-2.5" />}
              {footer.map((cell, ci) => (
                <td key={ci} className="px-4 py-2.5 text-[0.82rem] font-bold text-[#e6edf3]">
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

const CHART_TOOLTIP_STYLE = {
  background: "rgba(13,17,23,0.92)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "10px",
  fontSize: "12px",
  color: "#e6edf3",
  boxShadow: "0 8px 24px rgba(1,4,9,0.6)",
};

const AXIS = { fill: "#9198a1", fontSize: 11 };
const GRID = "rgba(240,246,252,0.07)";

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

const LEDGER_TABS = ["Coverage", "Visits by User", "Checklist Review", "Approval", "Actions"] as const;
type LedgerTab = (typeof LEDGER_TABS)[number];

export default function DashboardPage() {
  const [region, setRegion] = useState<string>("ALL");
  const [tab, setTab] = useState<LedgerTab>("Coverage");

  const overviewQ = useQuery({
    queryKey: ["branch-overview"],
    queryFn: async () => (await api.get("/dashboard/branch-overview")).data,
  });
  const visitsQ = useQuery({
    queryKey: ["visits-all"],
    queryFn: async () => (await api.get("/visits", { params: { per_page: 200 } })).data,
  });
  const actionsQ = useQuery({
    queryKey: ["actions-all"],
    queryFn: async () => (await api.get("/actions")).data,
  });
  const dashQ = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => (await api.get("/dashboard")).data,
  });
  const liveQ = useQuery({
    queryKey: ["live-field-activity"],
    queryFn: async () => (await api.get("/dashboard/live-field-activity")).data,
    refetchInterval: 12000,
  });

  const overview: any[] = overviewQ.data ?? [];
  const visits: any[] = visitsQ.data ?? [];
  const actions: any[] = actionsQ.data ?? [];
  const dash: any = dashQ.data ?? {};
  const liveData: any = liveQ.data ?? { active_visits: [], activity_feed: [], summary: {} };

  const regions = useMemo(
    () => Array.from(new Set(overview.map((o) => o.region).filter(Boolean))).sort() as string[],
    [overview]
  );

  const branchNameToRegion = useMemo(() => {
    const m: Record<string, string> = {};
    for (const o of overview) m[o.name] = o.region;
    return m;
  }, [overview]);

  const scopedOverview = useMemo(
    () => (region === "ALL" ? overview : overview.filter((o) => o.region === region)),
    [overview, region]
  );
  const scopedVisits = useMemo(
    () =>
      region === "ALL"
        ? visits
        : visits.filter((v) => (v.branch_name ? branchNameToRegion[v.branch_name] === region : false)),
    [visits, region, branchNameToRegion]
  );
  const scopedActions = useMemo(
    () =>
      region === "ALL"
        ? actions
        : actions.filter((a) => (a.branch_name ? branchNameToRegion[a.branch_name] === region : false)),
    [actions, region, branchNameToRegion]
  );

  const kpis = useMemo(() => {
    let branches = 0,
      visits = 0,
      inProcess = 0,
      pending = 0,
      completed = 0;
    for (const o of scopedOverview) {
      branches += 1;
      visits += o.total_visits ?? 0;
      inProcess += o.in_progress ?? 0;
      pending += o.submitted ?? 0;
      completed += o.completed ?? 0;
    }
    return { branches, visits, inProcess, pending, completed };
  }, [scopedOverview]);

  const scopeLabel = region === "ALL" ? "all regions" : region;
  const loading = overviewQ.isLoading || visitsQ.isLoading || actionsQ.isLoading;

  const regionBreakdown = useMemo(() => {
    const map = new Map<string, { branches: number; visits: number; inProcess: number; pending: number; done: number; compSum: number; compN: number }>();
    for (const o of overview) {
      const key = o.region ?? "Unassigned";
      const e = map.get(key) ?? { branches: 0, visits: 0, inProcess: 0, pending: 0, done: 0, compSum: 0, compN: 0 };
      e.branches += 1;
      e.visits += o.total_visits ?? 0;
      e.inProcess += o.in_progress ?? 0;
      e.pending += o.submitted ?? 0;
      e.done += o.completed ?? 0;
      if (o.compliance != null) {
        e.compSum += o.compliance;
        e.compN += 1;
      }
      map.set(key, e);
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v, compliance: v.compN ? Math.round(v.compSum / v.compN) : null }))
      .sort((a, b) => b.visits - a.visits);
  }, [overview]);

  /* ---- Ledger builders ---- */

  const coverageRows = useMemo(
    () =>
      scopedOverview
        .slice()
        .sort((a, b) => (b.compliance ?? -1) - (a.compliance ?? -1))
        .map((o) => [
          <span key="n" className="font-medium text-[#e6edf3]">{o.name}</span>,
          <span key="c" className="font-mono mono-num text-[#7d8590]">{o.code ?? "—"}</span>,
          (o.city ?? "—") as string,
          <RegionBadge key="r" region={o.region} />,
          <span key="v" className="font-mono mono-num text-[#58a6ff]">{fmt(o.total_visits)}</span>,
          <span key="i" className="font-mono mono-num">{fmt(o.in_progress)}</span>,
          <span key="p" className="font-mono mono-num text-[#d29922]">{fmt(o.submitted)}</span>,
          <span key="d" className="font-mono mono-num text-[#3fb950]">{fmt(o.completed)}</span>,
          <ComplianceCell key="cp" value={o.compliance} />,
          <span key="roles" className="text-[0.7rem] text-[#7d8590]">{(o.roles ?? []).join(", ")}</span>,
        ]),
    [scopedOverview]
  );

  const byUserRows = useMemo(() => {
    const map = new Map<string, { visits: number; inProcess: number; pending: number; done: number; compSum: number; compN: number; regions: Set<string> }>();
    for (const v of scopedVisits) {
      const name = v.visitors?.[0]?.name ?? "Unassigned";
      const e = map.get(name) ?? { visits: 0, inProcess: 0, pending: 0, done: 0, compSum: 0, compN: 0, regions: new Set<string>() };
      e.visits += 1;
      if (IN_PROGRESS_SET.has(v.status)) e.inProcess += 1;
      if (PENDING_SET.has(v.status)) e.pending += 1;
      if (DONE_SET.has(v.status)) e.done += 1;
      if (v.compliance_percentage != null) {
        e.compSum += v.compliance_percentage;
        e.compN += 1;
      }
      const r = v.branch_name ? branchNameToRegion[v.branch_name] : null;
      if (r) e.regions.add(r);
      map.set(name, e);
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({
        ...v,
        name,
        regions: Array.from(v.regions),
        compliance: v.compN ? Math.round(v.compSum / v.compN) : null,
      }))
      .sort((a, b) => b.visits - a.visits)
      .map((u) => [
        <span key="n" className="font-medium text-[#e6edf3]">{u.name}</span>,
        <span key="r" className="flex flex-wrap gap-1">{u.regions.map((r) => <RegionBadge key={r} region={r} />)}</span>,
        <span key="v" className="font-mono mono-num text-[#58a6ff]">{fmt(u.visits)}</span>,
        <span key="i" className="font-mono mono-num">{fmt(u.inProcess)}</span>,
        <span key="p" className="font-mono mono-num text-[#d29922]">{fmt(u.pending)}</span>,
        <span key="d" className="font-mono mono-num text-[#3fb950]">{fmt(u.done)}</span>,
        <ComplianceCell key="cp" value={u.compliance} />,
      ]);
  }, [scopedVisits, branchNameToRegion]);

  const reviewRows = useMemo(
    () =>
      scopedVisits
        .filter((v) => REVIEW_PIPELINE.has(v.status))
        .map((v) => [
          <span key="b" className="font-medium text-[#e6edf3]">{v.branch_name ?? "—"}</span>,
          <RegionBadge key="r" region={v.branch_name ? branchNameToRegion[v.branch_name] : null} />,
          <StatusPill key="s" status={v.status} />,
          <span key="rev" className="text-[#9198a1]">{v.reviewers?.[0]?.name ?? "Unassigned"}</span>,
          <span key="sub" className="font-mono mono-num text-[0.78rem] text-[#7d8590]">{shortDate(v.submitted_at ?? v.created_at)}</span>,
          <ComplianceCell key="cp" value={v.compliance_percentage} />,
          <a key="go" href={`/visits/${v.id}`} className="font-semibold text-[#58a6ff] hover:underline">Review →</a>,
        ]),
    [scopedVisits, branchNameToRegion]
  );

  const approvalRows = useMemo(
    () =>
      scopedVisits
        .filter((v) => OUTCOME_SET.has(v.status))
        .map((v) => [
          <span key="b" className="font-medium text-[#e6edf3]">{v.branch_name ?? "—"}</span>,
          <RegionBadge key="r" region={v.branch_name ? branchNameToRegion[v.branch_name] : null} />,
          <StatusPill key="s" status={v.status} />,
          <span key="rev" className="text-[#9198a1]">{v.reviewers?.[0]?.name ?? "—"}</span>,
          <span key="c" className="font-mono mono-num text-[0.78rem] text-[#7d8590]">{shortDate(v.completed_at ?? v.updated_at)}</span>,
          <span key="sc" className="font-mono mono-num">{v.total_score != null ? `${v.total_score}` : "—"}</span>,
          <ComplianceCell key="cp" value={v.compliance_percentage} />,
        ]),
    [scopedVisits, branchNameToRegion]
  );

  const actionsRows = useMemo(
    () =>
      scopedActions
        .slice()
        .sort((a, b) => Number(b.is_overdue) - Number(a.is_overdue))
        .map((a) => [
          <span key="t" className="font-medium text-[#e6edf3]">{a.title ?? "—"}</span>,
          <span key="b" className="text-[#9198a1]">{a.branch_name ?? "—"}</span>,
          <RegionBadge key="r" region={a.branch_name ? branchNameToRegion[a.branch_name] : null} />,
          <span key="p" className={`font-mono mono-num text-[0.7rem] font-bold ${priorityColor(a.priority)}`}>{a.priority}</span>,
          <ActionPill key="s" status={a.status} />,
          <span key="tgt" className="font-mono mono-num text-[0.78rem] text-[#7d8590]">{shortDate(a.target_date)}</span>,
          <span key="od" className={`font-mono mono-num text-[0.78rem] ${a.is_overdue ? "text-[#f85149] font-bold" : "text-[#3fb950]"}`}>
            {a.is_overdue ? "OVERDUE" : "on track"}
          </span>,
        ]),
    [scopedActions, branchNameToRegion]
  );

  const actFooter = useMemo(() => {
    const open = scopedActions.filter((a) => ["OPEN", "IN_PROGRESS", "VERIFICATION_PENDING"].includes(a.status)).length;
    const overdue = scopedActions.filter((a) => a.is_overdue).length;
    return [<span key="t">Total {fmt(scopedActions.length)}</span>, null, null, null, <span key="o" className="text-[#d29922]">Open {fmt(open)}</span>, null, <span key="od" className="text-[#f85149]">Overdue {fmt(overdue)}</span>];
  }, [scopedActions]);

  const byRegionChart = useMemo(
    () =>
      regionBreakdown.map((r) => ({
        name: r.name.length > 14 ? r.name.slice(0, 13) + "…" : r.name,
        InProcess: r.inProcess,
        Pending: r.pending,
        Completed: r.done,
      })),
    [regionBreakdown]
  );

  const complianceChart = useMemo(
    () => regionBreakdown.map((r) => ({ name: r.name, compliance: r.compliance ?? 0 })),
    [regionBreakdown]
  );

  const openActionsByPriority = useMemo(() => {
    const buckets = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
    const open = new Map<string, number>();
    const overdue = new Map<string, number>();
    for (const a of scopedActions) {
      const p = a.priority ?? "MEDIUM";
      if (["OPEN", "IN_PROGRESS", "VERIFICATION_PENDING"].includes(a.status)) open.set(p, (open.get(p) ?? 0) + 1);
      if (a.is_overdue) overdue.set(p, (overdue.get(p) ?? 0) + 1);
    }
    return buckets.map((p) => ({ name: p, Open: open.get(p) ?? 0, Overdue: overdue.get(p) ?? 0 }));
  }, [scopedActions]);

  const failedCategories = useMemo(() => {
    const raw = dash.failed_categories ?? [];
    const max = Math.max(1, ...raw.map((c: any) => c.value ?? 0));
    return raw.slice(0, 6);
  }, [dash]);

  const recentVisits = useMemo(
    () =>
      (dash.recent_visits ?? [])
        .filter((v: any) => region === "ALL" || (v.branch && branchNameToRegion[v.branch] === region))
        .slice(0, 6),
    [dash, region, branchNameToRegion]
  );

  const todayCompliance =
    scopedOverview.length && scopedOverview.some((o) => o.compliance != null)
      ? Math.round(scopedOverview.reduce((s, o) => s + (o.compliance ?? 0), 0) / scopedOverview.filter((o) => o.compliance != null).length)
      : null;

  if (loading) {
    return (
      <div className="relative z-10">
        <div className="flex h-[60vh] items-center justify-center">
          <div className="animate-spin h-9 w-9 rounded-full border-2 border-white/[0.1] border-t-[#2f81f7]" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative z-10 space-y-6 max-w-[1400px]">
      {/* Header */}
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[#58a6ff]">
              Super Admin · Operations Cockpit
            </p>
            <h1 className="mt-1 text-2xl font-bold text-[#e6edf3] tracking-tight">
              Branch Compliance Command Centre
            </h1>
            <p className="mt-1 text-sm text-[#9198a1]">
              Physical branch audit ledger across {fmt(regions.length)} regions · {fmt(kpis.branches)} active branches · all scoped to {scopeLabel}.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {todayCompliance != null && (
              <div className="glass rounded-xl px-3 py-2 text-right">
                <p className="text-[0.62rem] uppercase tracking-[0.12em] text-[#7d8590]">Global compliance</p>
                <p className="font-mono mono-num text-xl font-bold text-[#3fb950]">{todayCompliance}%</p>
              </div>
            )}
          </div>
        </header>

        {/* Region filter */}
        <div className="gh-scroll flex items-center gap-1.5 overflow-x-auto pb-1">
          <span className="mr-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-[#7d8590]">Region</span>
          <Chip active={region === "ALL"} onClick={() => setRegion("ALL")}>
            All <span className="opacity-70">· {fmt(kpis.branches)}</span>
          </Chip>
          {regions.map((r) => (
            <Chip key={r} active={region === r} onClick={() => setRegion(r)}>
              {r}
            </Chip>
          ))}
        </div>

        {/* KPI band */}
        <section>
          <p className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[#7d8590]">Live telemetry</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <KpiTile
              index={1}
              label="Total Branches"
              value={fmt(kpis.branches)}
              sub={`${region === "ALL" ? "physical" : region} branches · active`}
              tone="purple"
              href={region === "ALL" ? "/branches" : `/branches?region=${encodeURIComponent(region)}`}
            />
            <KpiTile
              index={2}
              label="Total Visits"
              value={fmt(kpis.visits)}
              sub="branch inspections logged"
              tone="blue"
              href={region === "ALL" ? "/visits" : `/visits?region=${encodeURIComponent(region)}`}
            />
            <KpiTile
              index={3}
              label="Total Completed"
              value={fmt(kpis.completed)}
              sub="approved & closed"
              tone="green"
              href={`/visits?status=APPROVED${region !== "ALL" ? `&region=${encodeURIComponent(region)}` : ""}`}
            />
            <KpiTile
              index={4}
              label="Pending"
              value={fmt(kpis.pending)}
              sub="submitted · awaiting review"
              tone="amber"
              href={`/visits?status=SUBMITTED${region !== "ALL" ? `&region=${encodeURIComponent(region)}` : ""}`}
            />
            <KpiTile
              index={5}
              label="In Process"
              value={fmt(kpis.inProcess)}
              sub="assigned · in progress"
              tone="cyan"
              href={`/visits?status=IN_PROGRESS${region !== "ALL" ? `&region=${encodeURIComponent(region)}` : ""}`}
            />
          </div>
        </section>

        {/* Live Mobile Field Operations Monitor */}
        <section className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#3fb950] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-[#238636]"></span>
              </span>
              <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <span>Live Mobile Field Operations & Inspector Activity</span>
                <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-white/10 text-gh-muted normal-case">
                  Auto-syncing with mobile app
                </span>
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <a
                href="/employees"
                className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/25 text-[#58a6ff] hover:bg-blue-500/20 transition-colors flex items-center gap-1"
              >
                <span>💻</span>
                <span>Employee Asset Registry →</span>
              </a>
              <a
                href="/gallery"
                className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-purple-500/10 border border-purple-500/25 text-[#bc8cff] hover:bg-purple-500/20 transition-colors flex items-center gap-1"
              >
                <span>📸</span>
                <span>Evidence Gallery →</span>
              </a>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Active Field Visits (Left 2 cols) */}
            <div className="lg:col-span-2 space-y-3">
              <GlassPanel className="p-4 md:p-5">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[#7d8590]">
                    Active Field Inspections ({liveData.active_visits?.filter((v: any) => ["IN_PROGRESS", "DRAFT", "SUBMITTED", "UNDER_REVIEW"].includes(v.status))?.length ?? 0} in progress / review)
                  </p>
                  <span className="text-[0.68rem] text-[#58a6ff]">Live checklist & photo sync</span>
                </div>

                {(!liveData.active_visits || liveData.active_visits.length === 0) ? (
                  <div className="py-8 text-center text-gh-muted text-sm">
                    No field inspections recorded yet today.
                  </div>
                ) : (
                  <div className="space-y-2.5 max-h-[360px] overflow-y-auto gh-scroll pr-1">
                    {liveData.active_visits.slice(0, 6).map((v: any) => {
                      const isLive = ["IN_PROGRESS", "DRAFT", "ASSIGNED"].includes(v.status);
                      const isReview = ["SUBMITTED", "UNDER_REVIEW"].includes(v.status);

                      return (
                        <div
                          key={v.id}
                          className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.08] hover:border-white/20 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-white text-sm truncate">{v.branch_name}</span>
                              <span className="font-mono text-[10px] text-gh-muted px-1.5 py-0.5 rounded bg-white/5 border border-white/10">
                                {v.branch_code}
                              </span>
                              {v.region && <RegionBadge region={v.region} />}
                              <span
                                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  isLive
                                    ? "bg-amber-500/20 text-[#d29922] border border-amber-500/30 animate-pulse"
                                    : isReview
                                    ? "bg-purple-500/20 text-[#bc8cff] border border-purple-500/30"
                                    : "bg-emerald-500/20 text-[#3fb950] border border-emerald-500/30"
                                }`}
                              >
                                {v.status.replace("_", " ")}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 text-xs text-gh-muted">
                              <span>👤 Inspector: <strong className="text-[#c9d1d9]">{v.inspector_name}</strong></span>
                              {v.started_at && (
                                <>
                                  <span>·</span>
                                  <span>Started: {new Date(v.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                </>
                              )}
                            </div>

                            {/* Progress bar */}
                            <div className="pt-1.5">
                              <div className="flex items-center justify-between text-[11px] mb-1">
                                <span className="text-gh-muted">Checklist Progress</span>
                                <span className="font-mono font-bold text-[#58a6ff]">
                                  {v.checklist_answered}/{v.checklist_total} ({v.checklist_progress_pct}%)
                                </span>
                              </div>
                              <div className="w-full bg-white/10 h-1.5 rounded-full overflow-hidden">
                                <div
                                  className="bg-gradient-to-r from-blue-500 to-emerald-400 h-full rounded-full transition-all duration-500"
                                  style={{ width: `${Math.min(100, Math.max(5, v.checklist_progress_pct))}%` }}
                                />
                              </div>
                            </div>
                          </div>

                          {/* Evidence stats & Action button */}
                          <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 border-white/5">
                            <div className="flex items-center gap-2 text-[11px]">
                              <span className="px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-[#58a6ff] font-mono">
                                📸 {v.photos_count} photos
                              </span>
                              {v.it_assets_total > 0 && (
                                <span className="px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-mono">
                                  💻 {v.it_assets_verified}/{v.it_assets_total} IT
                                </span>
                              )}
                            </div>
                            <a
                              href={`/visits/${v.id}`}
                              className="px-3 py-1.5 rounded-lg bg-[#21262d] hover:bg-[#30363d] border border-[#30363d] text-xs font-semibold text-[#58a6ff] hover:text-white transition-colors"
                            >
                              Inspect Visit →
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </GlassPanel>
            </div>

            {/* Live Activity Stream (Right 1 col) */}
            <div className="space-y-3">
              <GlassPanel className="p-4 md:p-5 h-full flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[#7d8590]">
                    Mobile Audit Trail
                  </p>
                  <span className="text-[0.68rem] text-emerald-400 font-mono">● LIVE</span>
                </div>

                {(!liveData.activity_feed || liveData.activity_feed.length === 0) ? (
                  <div className="py-8 text-center text-gh-muted text-xs">
                    No recent events logged.
                  </div>
                ) : (
                  <div className="space-y-2.5 overflow-y-auto gh-scroll pr-1 max-h-[360px] flex-1">
                    {liveData.activity_feed.slice(0, 10).map((log: any) => {
                      const actionLabel = (log.action || "EVENT").replace(/_/g, " ");
                      return (
                        <div
                          key={log.id}
                          className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.06] text-xs space-y-1 hover:border-white/10 transition-colors"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-white truncate max-w-[140px]">
                              {log.user_name}
                            </span>
                            <span className="text-[10px] text-gh-faint font-mono">
                              {log.created_at ? new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "now"}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-[#58a6ff]/10 text-[#58a6ff] border border-[#58a6ff]/20">
                              {actionLabel}
                            </span>
                            <span className="text-[11px] text-gh-muted truncate">
                              {log.entity_type}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </GlassPanel>
            </div>
          </div>
        </section>

        {/* Regional compliance strip */}
        {regionBreakdown.length > 0 && (
          <GlassPanel className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[#7d8590]">
                Regional audit board
              </p>
              <span className="text-[0.68rem] text-[#7d8590]">click a region to scope the whole cockpit</span>
            </div>
            <div className="gh-scroll grid grid-cols-1 gap-3 overflow-x-auto sm:grid-cols-2 lg:grid-cols-4">
              {regionBreakdown.map((r) => {
                const active = region === r.name;
                return (
                  <button
                    key={r.name}
                    onClick={() => setRegion(active ? "ALL" : r.name)}
                    className={`glass-hover rounded-xl border p-3 text-left transition-colors ${
                      active ? "border-[#2f81f7] bg-[#2f81f7]/10" : "border-white/[0.08]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#e6edf3]">{r.name}</span>
                      <span className="font-mono mono-num text-[0.66rem] text-[#7d8590]">{fmt(r.branches)} br</span>
                    </div>
                    <div className="mt-2 flex items-baseline gap-1.5">
                      <span
                        className={`font-mono mono-num text-2xl font-bold ${
                          r.compliance == null ? "text-[#7d8590]" : r.compliance >= 85 ? "text-[#3fb950]" : r.compliance >= 60 ? "text-[#d29922]" : "text-[#f85149]"
                        }`}
                      >
                        {r.compliance == null ? "—" : `${r.compliance}%`}
                      </span>
                      <span className="text-[0.66rem] text-[#7d8590]">compliance</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.7rem] text-[#9198a1]">
                      <span><b className="text-[#58a6ff]">{fmt(r.visits)}</b> visits</span>
                      <span><b className="text-[#d29922]">{fmt(r.pending)}</b> pending</span>
                      <span><b className="text-[#3fb950]">{fmt(r.done)}</b> done</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </GlassPanel>
        )}

        {/* Ledger tabs */}
        <GlassPanel className="p-4 md:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[#7d8590]">
              Spreadsheet ledger · {scopeLabel}
            </p>
            <div className="flex items-center gap-1">
              {LEDGER_TABS.map((t) => (
                <Chip key={t} active={tab === t} onClick={() => setTab(t)}>
                  {t}
                </Chip>
              ))}
            </div>
          </div>

          {tab === "Coverage" && (
            <Ledger
              columns={["Branch", "Code", "City", "Region", "Visits", "In Process", "Pending", "Completed", "Compliance", "Coverage"]}
              rows={coverageRows}
              footer={[
                <span key="t">Total {fmt(kpis.branches)}</span>,
                null,
                null,
                null,
                <span key="v" className="text-[#58a6ff]">{fmt(kpis.visits)}</span>,
                <span key="i">{fmt(kpis.inProcess)}</span>,
                <span key="p" className="text-[#d29922]">{fmt(kpis.pending)}</span>,
                <span key="d" className="text-[#3fb950]">{fmt(kpis.completed)}</span>,
                <span key="c" className="text-[#e6edf3]">{todayCompliance != null ? `${todayCompliance}%` : "—"}</span>,
                null,
              ]}
            />
          )}

          {tab === "Visits by User" && (
            <Ledger
              columns={["Inspector / User", "Regions", "Visits", "In Process", "Pending", "Completed", "Avg Compliance"]}
              rows={byUserRows}
              footer={[
                <span key="t">Total {fmt(scopedVisits.length)}</span>,
                null,
                <span key="v" className="text-[#58a6ff]">{fmt(kpis.visits)}</span>,
                <span key="i">{fmt(kpis.inProcess)}</span>,
                <span key="p" className="text-[#d29922]">{fmt(kpis.pending)}</span>,
                <span key="d" className="text-[#3fb950]">{fmt(kpis.completed)}</span>,
                null,
              ]}
            />
          )}

          {tab === "Checklist Review" && (
            <Ledger
              columns={["Branch", "Region", "Stage", "Reviewer", "Submitted", "Compliance", ""]}
              rows={reviewRows}
              footer={[<span key="t">Total {fmt(reviewRows.length)} awaiting action</span>, null, null, null, null, null, null]}
            />
          )}

          {tab === "Approval" && (
            <Ledger
              columns={["Branch", "Region", "Outcome", "Reviewer", "Completed", "Score", "Compliance"]}
              rows={approvalRows}
              footer={[<span key="t">Total {fmt(approvalRows.length)} outcomes</span>, null, null, null, null, null, null]}
            />
          )}

          {tab === "Actions" && (
            <Ledger
              columns={["Corrective Action", "Branch", "Region", "Priority", "Status", "Target", "Health"]}
              rows={actionsRows}
              footer={actFooter}
            />
          )}
        </GlassPanel>

        {/* Performance */}
        <section className="space-y-4">
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[#7d8590]">Performance analytics</p>
            <h2 className="mt-0.5 text-lg font-bold text-[#e6edf3]">Regional performance</h2>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <GlassPanel className="p-4">
              <p className="mb-3 text-xs font-semibold text-[#c9d1d9]">Visit pipeline by region</p>
              <div style={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byRegionChart} barSize={22}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} />
                    <YAxis tick={AXIS} axisLine={false} tickLine={false} width={28} />
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                    <Bar dataKey="InProcess" stackId="a" fill="#58a6ff" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="Pending" stackId="a" fill="#d29922" />
                    <Bar dataKey="Completed" stackId="a" fill="#3fb950" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.68rem] text-[#9198a1]">
                <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#58a6ff]" />In process</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#d29922]" />Pending review</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#3fb950]" />Completed</span>
              </div>
            </GlassPanel>

            <GlassPanel className="p-4">
              <p className="mb-3 text-xs font-semibold text-[#c9d1d9]">Average compliance by region</p>
              <div style={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={complianceChart} barSize={26}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={AXIS} axisLine={false} tickLine={false} width={32} />
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={{ fill: "rgba(255,255,255,0.04)" }} formatter={(v: any) => [`${v}%`, "Compliance"]} />
                    <Bar dataKey="compliance" radius={[3, 3, 0, 0]}>
                      {complianceChart.map((c) => (
                        <Cell key={c.name} fill={c.name === region ? "#2f81f7" : c.compliance >= 85 ? "#3fb950" : c.compliance >= 60 ? "#d29922" : "#f85149"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-[0.68rem] text-[#7d8590]">≥85% green · 60–84% amber · &lt;60% red</p>
            </GlassPanel>

            <GlassPanel className="p-4">
              <p className="mb-3 text-xs font-semibold text-[#c9d1d9]">Corrective action health · {scopeLabel}</p>
              <div style={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={openActionsByPriority} barSize={18}>
                    <CartesianGrid stroke={GRID} vertical={false} />
                    <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} />
                    <YAxis tick={AXIS} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
                    <Tooltip contentStyle={CHART_TOOLTIP_STYLE} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
                    <Bar dataKey="Open" fill="#d29922" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="Overdue" fill="#f85149" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.68rem] text-[#9198a1]">
                <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#d29922]" />Open</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-[#f85149]" />Overdue</span>
              </div>
            </GlassPanel>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {/* Failing checkpoints */}
            <GlassPanel className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-[#c9d1d9]">Top failing checkpoints <span className="text-[#7d8590]">(nationwide)</span></p>
              </div>
              {failedCategories.length === 0 ? (
                <p className="py-10 text-center text-sm text-[#7d8590]">No failing checkpoints on record.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {failedCategories.map((f: any) => {
                    const max = Math.max(1, ...failedCategories.map((c: any) => c.value ?? 0));
                    return (
                      <div key={f.label}>
                        <div className="mb-1 flex items-baseline justify-between gap-2">
                          <span className="truncate text-[0.78rem] text-[#c9d1d9]">{f.label}</span>
                          <span className="font-mono mono-num text-[0.7rem] text-[#f85149]">{fmt(f.value)}</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-[#f85149] to-[#f0883e]"
                            style={{ width: `${Math.max(4, (f.value / max) * 100)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </GlassPanel>

            {/* Compliance Gauges per bucket */}
            <GlassPanel className="p-4">
              <p className="text-xs font-semibold text-[#c9d1d9]">Pipeline posture · {scopeLabel}</p>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <PipelineGauge label="In process" value={kpis.inProcess} max={Math.max(1, kpis.visits)} color="#58a6ff" />
                <PipelineGauge label="Pending" value={kpis.pending} max={Math.max(1, kpis.visits)} color="#d29922" />
                <PipelineGauge label="Completed" value={kpis.completed} max={Math.max(1, kpis.visits)} color="#3fb950" />
              </div>
              <div className="mt-5 border-t border-white/[0.06] pt-3">
                {recentVisits.length === 0 ? (
                  <p className="py-4 text-center text-[0.78rem] text-[#7d8590]">No recent visits in scope.</p>
                ) : (
                  <div className="space-y-2">
                    {recentVisits.map((v: any) => (
                      <a key={v.id} href={`/visits/${v.id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.04]">
                        <span className="truncate text-[0.78rem] text-[#c9d1d9]">{v.branch}</span>
                        <span className="flex items-center gap-2">
                          <span className="font-mono mono-num text-[0.7rem] text-[#7d8590]">
                            {v.compliance_percentage != null ? `${v.compliance_percentage}%` : "—"}
                          </span>
                          <StatusPill status={v.status} />
                        </span>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </GlassPanel>

            {/* Regional ledger summary card */}
            <GlassPanel className="p-4">
              <p className="text-xs font-semibold text-[#c9d1d9]">Regional ledger · audit trail</p>
              <div className="mt-4 space-y-1.5">
                {regionBreakdown.map((r) => (
                  <button
                    key={r.name}
                    onClick={() => setRegion(r.name)}
                    className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/[0.04] ${
                      region === r.name ? "border border-[#2f81f7]/40" : "border border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ background: r.compliance == null ? "transparent" : r.compliance >= 85 ? "#3fb950" : r.compliance >= 60 ? "#d29922" : "#f85149" }} />
                      <span className="text-[0.8rem] font-medium text-[#c9d1d9]">{r.name}</span>
                    </div>
                    <span className="font-mono mono-num text-[0.7rem] text-[#7d8590]">
                      {fmt(r.visits)} visits · {fmt(r.pending)} pending · {fmt(r.done)} done
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-4 border-t border-white/[0.06] pt-3 text-[0.7rem] text-[#7d8590]">
                Every metric above re-scopes to the selected region. Full cross-region rollup shown under All.
              </p>
            </GlassPanel>
          </div>
        </section>

        <footer className="pt-4 text-center text-[0.7rem] text-[#484f58]">
          Branch Visit Inspection · Photo Evidence & Compliance Management System · Super Admin cockpit
        </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small presentational pieces                                         */
/* ------------------------------------------------------------------ */

function ComplianceCell({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-[#7d8590]">—</span>;
  const color = value >= 85 ? "text-[#3fb950]" : value >= 60 ? "text-[#d29922]" : "text-[#f85149]";
  return <span className={`font-mono mono-num font-semibold ${color}`}>{Math.round(value)}%</span>;
}

function PipelineGauge({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="rounded-xl border border-white/[0.07] p-3 text-center">
      <p className="text-[0.62rem] uppercase tracking-[0.1em] text-[#7d8590]">{label}</p>
      <p className="mt-1 font-mono mono-num text-xl font-bold" style={{ color }}>{fmt(value)}</p>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <p className="mt-1.5 text-[0.62rem] text-[#7d8590]">{pct}% of visits</p>
    </div>
  );
}

function priorityColor(p: string) {
  return p === "CRITICAL" ? "text-[#f85149]" : p === "HIGH" ? "text-[#db6d28]" : p === "MEDIUM" ? "text-[#d29922]" : "text-[#9198a1]";
}

function shortDate(v: string | null | undefined) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v).slice(0, 10);
  return d.toISOString().slice(0, 10);
}