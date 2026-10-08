"use client";

/* -------------------------------------------------------------------------- */
/* DataTable — Excel-like dense grid for admin lists                          */
/*                                                                            */
/* - Sticky header + row numbers (like a spreadsheet)                         */
/* - Per-column filter row: text "contains" or dropdown "equals"              */
/* - Click a column header to sort (asc → desc → off)                         */
/* - Batch pagination: rows split into batches of `pageSize` (default 100)    */
/*   with chip navigation 1-100 · 101-200 · 201-300 …                         */
/* -------------------------------------------------------------------------- */

import { useMemo, useState } from "react";
import { EmptyState, Input } from "@/components/ui";

export type ColumnDef = {
  key: string;
  label: string;
  /** Render the cell content for a row (defaults to row[key]). */
  render?: (row: any, index: number) => React.ReactNode;
  /** Dropdown filter options (keyed off the raw cell value). */
  options?: string[];
  /** Align the cell content. */
  align?: "left" | "right" | "center";
  /** Column width class, e.g. "w-40". */
  width?: string;
  /** Skip filtering for this column. */
  noFilter?: boolean;
};

type SortState = { key: string; dir: "asc" | "desc" } | null;

/** Escape a cell for CSV (quotes, commas, newlines; Excel formula-injection guard). */
function csvCell(value: any): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t]/.test(s)) s = `'${s}`; // neutralize = / + / - / @ leading chars
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportCsv(filename: string, columns: ColumnDef[], rows: any[]) {
  const header = columns.map((c) => csvCell(c.label)).join(",");
  const lines = rows.map((r) =>
    columns
      .map((c) => {
        // Prefer a plain-text extraction: if render exists we still export the
        // raw value (render is presentation-only); fall back to row[key].
        const v = r[c.key];
        if (v != null && typeof v === "object") return csvCell(JSON.stringify(v));
        return csvCell(v);
      })
      .join(",")
  );
  // BOM so Excel opens UTF-8 (Indian names) correctly on double-click.
  const blob = new Blob(["\uFEFF" + header + "\n" + lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function compareCells(a: any, b: any): number {
  const na = typeof a === "number" ? a : parseFloat(String(a ?? ""));
  const nb = typeof b === "number" ? b : parseFloat(String(b ?? ""));
  if (!Number.isNaN(na) && !Number.isNaN(nb) && String(a ?? "").trim() !== "" && String(b ?? "").trim() !== "") {
    return na - nb;
  }
  return String(a ?? "").toLowerCase().localeCompare(String(b ?? "").toLowerCase());
}

export function DataTable({
  columns,
  rows,
  pageSize = 100,
  onRowClick,
  emptyMessage = "No records found.",
  dense = true,
  initialFilters,
  exportName = "export",
}: {
  columns: ColumnDef[];
  rows: any[];
  /** Batch size. Pagination chips render as 1-100 · 101-200 · … */
  pageSize?: number;
  onRowClick?: (row: any) => void;
  emptyMessage?: string;
  dense?: boolean;
  /** Pre-applied filters, e.g. { region_name: "East Rajasthan" } from a deep link. */
  initialFilters?: Record<string, string>;
  /** File name stem for CSV exports, e.g. "employees" → employees-filtered-2026-09-30.csv */
  exportName?: string;
}) {
  const [filters, setFilters] = useState<Record<string, string>>(initialFilters ?? {});
  const [sort, setSort] = useState<SortState>(null);
  const [batch, setBatch] = useState(0);

  const filtered = useMemo(() => {
    let out = rows;
    for (const col of columns) {
      const raw = filters[col.key]?.trim();
      if (!raw) continue;
      if (col.options) {
        // Dropdown filter: exact match on the raw cell value (case-sensitive —
        // option labels come from the data itself).
        out = out.filter((r) => String(r[col.key] ?? "") === raw);
      } else {
        const f = raw.toLowerCase();
        out = out.filter((r) => String(r[col.key] ?? "").toLowerCase().includes(f));
      }
    }
    if (sort) {
      const { key, dir } = sort;
      out = [...out].sort((a, b) => (dir === "asc" ? compareCells(a[key], b[key]) : -compareCells(a[key], b[key])));
    }
    return out;
  }, [rows, columns, filters, sort]);

  const batches = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safeBatch = Math.min(batch, batches - 1);
  const pageRows = filtered.slice(safeBatch * pageSize, (safeBatch + 1) * pageSize);

  const setFilter = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setBatch(0);
  };

  const toggleSort = (key: string) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  };

  const hasActiveFilters = Object.values(filters).some((v) => v?.trim());
  const doExport = (scope: "filtered" | "all") => {
    const rowsToExport = scope === "filtered" ? filtered : rows;
    exportCsv(`${exportName}-${scope}-${new Date().toISOString().slice(0, 10)}.csv`, columns, rowsToExport);
  };

  return (
    <div className="rounded-xl border border-gh-border bg-gh-panel overflow-hidden">
      {/* Toolbar */}
      <div className="px-4 py-2.5 border-b border-gh-border flex items-center justify-between gap-3 flex-wrap bg-gh-canvas/60">
        <div className="flex items-center gap-2 text-xs text-gh-muted">
          <span className="font-mono mono-num">
            {filtered.length.toLocaleString("en-IN")}
          </span>
          <span>record{filtered.length === 1 ? "" : "s"}</span>
          {filtered.length !== rows.length && (
            <span className="text-gh-faint">(of {rows.length.toLocaleString("en-IN")})</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* CSV export: current filtered view + full dataset, both client-side */}
          <button
            onClick={() => doExport("filtered")}
            disabled={filtered.length === 0}
            title={`Download ${filtered.length.toLocaleString("en-IN")} rows${hasActiveFilters ? " (current filters applied)" : ""}`}
            className="px-2.5 py-1 rounded-md text-xs font-semibold bg-[#238636] hover:bg-[#2ea043] text-white disabled:opacity-40 transition-colors"
          >
            ⬇ CSV{hasActiveFilters ? ` · ${filtered.length.toLocaleString("en-IN")}` : ""}
          </button>
          {hasActiveFilters && rows.length !== filtered.length && (
            <button
              onClick={() => doExport("all")}
              title={`Download all ${rows.length.toLocaleString("en-IN")} rows (ignore filters)`}
              className="px-2.5 py-1 rounded-md text-xs bg-[#21262d] border border-white/[0.12] text-[#c9d1d9] hover:bg-[#30363d] transition-colors"
            >
              ⬇ All {rows.length.toLocaleString("en-IN")}
            </button>
          )}
          {batches > 1 && (
            <>
              <button
                onClick={() => setBatch(Math.max(0, safeBatch - 1))}
                disabled={safeBatch === 0}
                className="px-2 py-1 rounded-md text-xs bg-[#21262d] border border-white/[0.12] text-[#c9d1d9] hover:bg-[#30363d] disabled:opacity-40"
              >
                ‹ Prev
              </button>
              {Array.from({ length: batches }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setBatch(i)}
                  className={`px-2 py-1 rounded-md text-xs font-mono mono-num transition-colors ${
                    i === safeBatch
                      ? "bg-[#2f81f7] text-white"
                      : "bg-[#21262d] border border-white/[0.12] text-[#9198a1] hover:bg-[#30363d]"
                  }`}
                >
                  {i * pageSize + 1}-{Math.min((i + 1) * pageSize, filtered.length)}
                </button>
              ))}
              <button
                onClick={() => setBatch(Math.min(batches - 1, safeBatch + 1))}
                disabled={safeBatch === batches - 1}
                className="px-2 py-1 rounded-md text-xs bg-[#21262d] border border-white/[0.12] text-[#c9d1d9] hover:bg-[#30363d] disabled:opacity-40"
              >
                Next ›
              </button>
            </>
          )}
        </div>
      </div>

      {/* Grid */}
      <div className="overflow-auto max-h-[70vh]">
        <table className="w-full text-[13px] border-collapse">
          <thead className="sticky top-0 z-10">
            {/* Header row */}
            <tr className="bg-[#161b22]">
              <th className="px-2 py-2 text-right text-[10px] font-semibold text-gh-faint border-b border-r border-gh-border select-none w-10">
                #
              </th>
              {columns.map((col) => {
                const active = sort?.key === col.key;
                return (
                  <th
                    key={col.key}
                    onClick={() => !col.noFilter && toggleSort(col.key)}
                    className={`px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide border-b border-gh-border whitespace-nowrap select-none ${
                      col.width ?? ""
                    } ${col.noFilter ? "" : "cursor-pointer hover:text-[#58a6ff]"} ${
                      active ? "text-[#58a6ff]" : "text-gh-muted"
                    } ${col.align === "right" ? "text-right" : ""}`}
                  >
                    {col.label}
                    {active && <span className="ml-1">{sort!.dir === "asc" ? "▲" : "▼"}</span>}
                  </th>
                );
              })}
            </tr>
            {/* Filter row */}
            <tr className="bg-[#161b22]">
              <th className="px-2 py-1.5 border-b border-r border-gh-border">
                <button
                  onClick={() => {
                    setFilters({});
                    setBatch(0);
                  }}
                  title="Clear all filters"
                  className="text-[10px] text-gh-faint hover:text-[#f85149] whitespace-nowrap"
                >
                  ✕ clear
                </button>
              </th>
              {columns.map((col) => (
                <th key={col.key} className="px-2 py-1.5 border-b border-gh-border font-normal">
                  {!col.noFilter && (col.options ? (
                    <select
                      value={filters[col.key] ?? ""}
                      onChange={(e) => setFilter(col.key, e.target.value)}
                      className="w-full min-w-[80px] bg-gh-canvas border border-[#30363d] rounded px-1.5 py-1 text-[11px] text-gh-text focus:outline-none focus:ring-1 focus:ring-[#2f81f7]"
                    >
                      <option value="">All</option>
                      {col.options.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      value={filters[col.key] ?? ""}
                      onChange={(e) => setFilter(col.key, e.target.value)}
                      placeholder="Filter…"
                      className="!min-w-0 !w-full !px-1.5 !py-1 !text-[11px] !bg-gh-canvas"
                    />
                  ))}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05]">
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1}>
                  <EmptyState message={emptyMessage} />
                </td>
              </tr>
            )}
            {pageRows.map((row, i) => (
              <tr
                key={row.id ?? i}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`transition-colors ${
                  onRowClick ? "cursor-pointer" : ""
                } ${i % 2 === 1 ? "bg-white/[0.015]" : ""} hover:bg-[#58a6ff]/[0.07]`}
              >
                <td className="px-2 text-right text-[10px] font-mono mono-num text-gh-faint border-r border-gh-border bg-[#161b22]/60 sticky left-0">
                  {safeBatch * pageSize + i + 1}
                </td>
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-3 ${dense ? "py-1.5" : "py-2.5"} whitespace-nowrap ${
                      col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : ""
                    }`}
                  >
                    {col.render ? col.render(row, safeBatch * pageSize + i) : (row[col.key] ?? "-")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-gh-border flex items-center justify-between text-[11px] text-gh-faint bg-gh-canvas/60">
        <span>
          Batch {safeBatch + 1} of {batches} · showing {pageRows.length} rows
          {filtered.length > 0 && (
            <>
              {" "}· rows {safeBatch * pageSize + 1}–{safeBatch * pageSize + pageRows.length}
            </>
          )}
        </span>
        <span>Click a header to sort · type in a column to filter</span>
      </div>
    </div>
  );
}
