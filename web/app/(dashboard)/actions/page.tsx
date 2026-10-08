"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, getErrorMessage, ACTION_STATUS_COLORS } from "@/lib/api";
import { Card, Badge, Table, Spinner, EmptyState, Select } from "@/components/ui";

const STATUSES = ["OPEN", "IN_PROGRESS", "COMPLETED", "VERIFICATION_PENDING", "CLOSED", "OVERDUE"];

export default function ActionsPage() {
  const [branchId, setBranchId] = useState("");
  const [status, setStatus] = useState("");

  const branches = useQuery({
    queryKey: ["branches"],
    queryFn: async () => (await api.get("/branches?limit=200")).data,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["actions", branchId, status],
    queryFn: async () =>
      (
        await api.get("/actions", {
          params: { limit: 200, status: status || undefined, branch_id: branchId || undefined },
        })
      ).data,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Corrective Actions</h1>
        <p className="text-gh-muted text-sm mt-1">Track all pending actions until closure.</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="max-w-xs">
          <option value="">All branches</option>
          {(branches.data ?? []).map((b: any) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="max-w-xs">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s.replace("_", " ")}</option>
          ))}
        </Select>
      </div>

      {isLoading ? (
        <Spinner />
      ) : (
        <Card>
          <Table headers={["Action", "Branch", "Priority", "Responsible", "Target Date", "Status"]}>
            {(data ?? []).length === 0 && (
              <tr><td colSpan={6}><EmptyState message="No corrective actions match." /></td></tr>
            )}
            {(data ?? []).map((a: any) => (
              <tr key={a.id} className="hover:bg-white/[0.04]">
                <td className="px-4 py-3 font-medium max-w-xs truncate">{a.title}</td>
                <td className="px-4 py-3 text-gh-muted text-sm">{a.branch_name ?? "-"}</td>
                <td className="px-4 py-3">
                  <Badge className={a.priority === "CRITICAL" ? "bg-red-600" : a.priority === "HIGH" ? "bg-orange-500" : a.priority === "MEDIUM" ? "bg-amber-500" : "bg-slate-400"}>
                    {a.priority}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-gh-muted">{a.responsible_person_name ?? "Unassigned"}</td>
                <td className="px-4 py-3 text-gh-muted">{a.target_date ?? "-"}</td>
                <td className="px-4 py-3">
                  <Badge className={ACTION_STATUS_COLORS[a.status] ?? "bg-slate-400"}>{a.status.replace("_", " ")}</Badge>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}