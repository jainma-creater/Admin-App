"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";
import { Card, Badge, Button, Spinner, EmptyState } from "@/components/ui";

async function downloadCsv(id: string) {
  try {
    const res = await api.get(`/reports/visits/${id}/export`, { responseType: "blob" });
    const disposition = res.headers?.["content-disposition"] as string | undefined;
    const match = disposition?.match(/filename="?([^";]+)"?/);
    const filename = match ? match[1] : `visit-report-${id}.csv`;
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch {
    alert("Failed to export CSV.");
  }
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <span className="text-sm text-gh-muted">{label}</span>
      <span className="text-sm font-medium text-gh-text text-right">{value ?? "-"}</span>
    </div>
  );
}

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: report, isLoading, isError } = useQuery({
    queryKey: ["report", id],
    queryFn: async () => (await api.get(`/reports/visits/${id}`)).data,
    enabled: !!id,
  });

  if (isLoading) return <Spinner />;
  if (isError || !report) return <EmptyState message="Report not found." />;

  const branch = report.branch ?? {};
  const visit = report.visit ?? {};
  const complianceScore =
    report.compliance_score ??
    report.compliance_percentage ??
    visit.compliance_percentage ??
    report.compliance ??
    null;
  const sections = report.sections ?? report.section_summaries ?? [];
  const checklistItems =
    report.checklist_items ??
    sections.flatMap((s: any) => s.items ?? []) ??
    [];
  const photos = report.photos ?? [];

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold">Visit Report</h1>
          <Button variant="secondary" onClick={() => downloadCsv(id)}>
            Export CSV
          </Button>
        </div>
        <p className="text-gh-muted text-sm mt-1">
          {branch.name ?? visit.branch_name ?? "Branch"} ·{" "}
          {visit.visit_type_name ?? visit.visit_type ?? "-"} ·{" "}
          {visit.scheduled_date ?? "-"}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="p-5">
          <h3 className="font-semibold text-gh-text mb-3">Branch Info</h3>
          <SummaryRow label="Name" value={branch.name} />
          <SummaryRow label="Code" value={branch.code} />
          <SummaryRow label="City" value={branch.city} />
          <SummaryRow label="State" value={branch.state} />
          <SummaryRow label="Address" value={branch.address} />
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold text-gh-text mb-3">Visit Info</h3>
          <SummaryRow label="Type" value={visit.visit_type_name ?? visit.visit_type} />
          <SummaryRow label="Scheduled" value={visit.scheduled_date} />
          <SummaryRow label="Priority" value={visit.priority} />
          <SummaryRow label="Status" value={visit.status} />
          <SummaryRow label="Visitor" value={visit.visitor_name ?? visit.assigned_to} />
          <SummaryRow label="Reviewer" value={visit.reviewer_name} />
          {visit.instructions && <SummaryRow label="Instructions" value={visit.instructions} />}
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold text-gh-text mb-3">Compliance Score</h3>
          <p className="text-3xl font-bold text-[#58a6ff]">
            {complianceScore != null ? `${complianceScore}%` : "-"}
          </p>
        </Card>
      </div>

      {sections.length > 0 && (
        <Card className="p-5">
          <h3 className="font-semibold text-gh-text mb-4">Section Summaries</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sections.map((s: any, i: number) => (
              <div key={s.id ?? i} className="border border-gh-border rounded-lg p-4">
                <p className="font-medium text-sm">{s.name ?? s.section_name ?? "Section"}</p>
                <p className="text-xs text-gh-faint mt-1">
                  {s.items?.length != null ? `${s.items.length} items · ` : ""}
                  {s.compliance_percentage != null || s.score != null
                    ? `Score: ${s.compliance_percentage ?? s.score}%`
                    : "Score: -"}
                </p>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-5">
        <h3 className="font-semibold text-gh-text mb-4">Checklist Items ({checklistItems.length})</h3>
        {checklistItems.length === 0 ? (
          <EmptyState message="No checklist items." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gh-border">
                  <th className="text-left px-3 py-2 font-semibold text-gh-muted">Item</th>
                  <th className="text-left px-3 py-2 font-semibold text-gh-muted">Status</th>
                  <th className="text-left px-3 py-2 font-semibold text-gh-muted">Remark</th>
                  <th className="text-left px-3 py-2 font-semibold text-gh-muted">Action Required</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {checklistItems.map((item: any, i: number) => (
                  <tr key={item.id ?? i} className={item.status === "NOT_OK" ? "bg-[#f85149]/10" : ""}>
                    <td className="px-3 py-2.5 text-[#c9d1d9]">{item.item ?? item.item_name ?? item.name ?? "-"}</td>
                    <td className="px-3 py-2.5">
                      {item.status ? (
                        <Badge className={
                          item.status === "OK" ? "bg-emerald-500"
                          : item.status === "NOT_OK" ? "bg-red-500"
                          : item.status === "NA" ? "bg-slate-400"
                          : "bg-slate-400"
                        }>
                          {item.status.replace("_", " ")}
                        </Badge>
                      ) : <span className="text-[#484f58]">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-gh-faint">{item.remark ?? "-"}</td>
                    <td className="px-3 py-2.5 text-gh-faint">{item.action_required ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="font-semibold text-gh-text mb-4">Photo Evidence ({photos.length})</h3>
        {photos.length === 0 ? (
          <EmptyState message="No photos." />
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {photos.map((p: any, i: number) => (
              <a key={p.id ?? i} href={p.url ?? p.photo_url} target="_blank" rel="noreferrer">
                <img
                  src={p.thumbnail_url ?? p.url ?? p.photo_url}
                  className="w-full h-24 object-cover rounded-lg border border-gh-border"
                />
              </a>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}