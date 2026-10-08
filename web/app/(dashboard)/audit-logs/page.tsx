"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, Table, Spinner, EmptyState } from "@/components/ui";

export default function AuditLogsPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["audit-logs"],
    queryFn: async () => (await api.get("/dashboard/audit-logs")).data,
  });

  const formatTimestamp = (ts: string | undefined | null) => {
    if (!ts) return "-";
    const date = new Date(ts);
    if (isNaN(date.getTime())) return ts;
    return date.toLocaleString();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Audit Logs</h1>
        <p className="text-gh-muted text-sm mt-1">Track all system activity and changes.</p>
      </div>

      {isLoading ? <Spinner /> : (
        <Card>
          <Table headers={["Timestamp", "User", "Action", "Entity Type", "Entity ID"]}>
            {(data ?? []).length === 0 && (
              <tr><td colSpan={5}><EmptyState message="No audit logs." /></td></tr>
            )}
            {(data ?? []).map((log: any, i: number) => (
              <tr key={log?.id ?? i} className="hover:bg-white/[0.04]">
                <td className="px-4 py-3 text-gh-muted whitespace-nowrap">{formatTimestamp(log?.created_at ?? log?.timestamp)}</td>
                <td className="px-4 py-3 text-gh-muted">{log?.user ?? "-"}</td>
                <td className="px-4 py-3 text-gh-muted">{log?.action ?? "-"}</td>
                <td className="px-4 py-3 text-gh-muted">{log?.entity_type ?? "-"}</td>
                <td className="px-4 py-3 text-gh-muted">{log?.entity_id ?? "-"}</td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}