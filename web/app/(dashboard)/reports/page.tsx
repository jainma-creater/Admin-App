"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api, STATUS_COLORS } from "@/lib/api";
import { Card, Badge, Table, Spinner, EmptyState } from "@/components/ui";

export default function ReportsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["visits-for-reports"],
    queryFn: async () => (await api.get("/visits")).data,
  });

  const closed = (data ?? []).filter((v: any) =>
    ["APPROVED", "CLOSED"].includes(v.status)
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-gh-muted text-sm mt-1">
          Generate full visit reports including branch info, checklist, evidence, and corrective actions.
        </p>
      </div>

      <Card className="p-6">
        <p className="text-sm text-gh-muted mb-4">
          Pick a visit below to open its full report (JSON/CSV export available from the report page).
        </p>
        {isLoading ? <Spinner /> : (
          <Table headers={["Branch", "Type", "Date", "Compliance", "Status", ""]}>
            {closed.length === 0 && (
              <tr><td colSpan={6}><EmptyState message="No completed visits yet." /></td></tr>
            )}
            {closed.map((v: any) => (
              <tr key={v.id} className="hover:bg-white/[0.04]">
                <td className="px-4 py-3 font-medium">{v.branch_name ?? "Branch"}</td>
                <td className="px-4 py-3 text-gh-muted">{v.visit_type_name ?? "-"}</td>
                <td className="px-4 py-3 text-gh-muted">{v.scheduled_date ?? "-"}</td>
                <td className="px-4 py-3 text-gh-muted">
                  {v.compliance_percentage != null ? `${v.compliance_percentage}%` : "-"}
                </td>
                <td className="px-4 py-3">
                  <Badge className={STATUS_COLORS[v.status] ?? "bg-slate-400"}>{v.status}</Badge>
                </td>
                <td className="px-4 py-3">
                  <Link href={`/reports/${v.id}`} className="text-[#58a6ff] hover:underline">
                    Open report →
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}