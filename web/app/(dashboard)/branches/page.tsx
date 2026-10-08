"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/lib/api";
import { Badge, Button, Input, Select } from "@/components/ui";
import { DataTable, type ColumnDef } from "@/components/DataTable";

function CreateBranchModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [regionId, setRegionId] = useState("");
  const [areaId, setAreaId] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [error, setError] = useState<string | null>(null);

  const regions = useQuery({ queryKey: ["regions"], queryFn: async () => (await api.get("/branches/regions")).data });
  const areas = useQuery({
    queryKey: ["areas", regionId],
    queryFn: async () => (await api.get("/branches/areas", { params: regionId ? { region_id: regionId } : {} })).data,
    enabled: true,
  });

  const createMut = useMutation({
    mutationFn: async () =>
      (await api.post("/branches", { name, code, region_id: regionId, area_id: areaId, address: address || null, city: city || null, state: state || null })).data,
    onSuccess: () => { alert("Branch created"); onClose(); },
    onError: async (e: any) => setError(await getErrorMessage(e)),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gh-panel border border-gh-border rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold mb-4">Create Branch</h2>
        {error && <p className="text-[#f85149] text-sm mb-3">{error}</p>}
        <div className="space-y-3">
          <Input label="Branch Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Branch Code" value={code} onChange={(e) => setCode(e.target.value)} />
          <Select label="Region" value={regionId} onChange={(e) => setRegionId(e.target.value)}>
            <option value="">Select region...</option>
            {(regions.data ?? []).map((r: any) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </Select>
          <Select label="Area" value={areaId} onChange={(e) => setAreaId(e.target.value)}>
            <option value="">Select area...</option>
            {(areas.data ?? []).map((a: any) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
          <Input label="Address" value={address} onChange={(e) => setAddress(e.target.value)} />
          <Input label="City" value={city} onChange={(e) => setCity(e.target.value)} />
          <Input label="State" value={state} onChange={(e) => setState(e.target.value)} />
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => createMut.mutate()} disabled={!name || !code || !regionId || !areaId} className="flex-1">Create</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ImportBranchModal({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const importMut = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("No file selected");
      const formData = new FormData();
      formData.append("file", file);
      return (await api.post("/branches/import", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })).data;
    },
    onSuccess: (res) => {
      alert(`Import complete: ${res.created} created, ${res.updated} updated, ${res.skipped} skipped${res.errors.length ? `\nErrors: ${res.errors.slice(0, 5).join("; ")}` : ""}`);
      onClose();
    },
    onError: async (e: any) => setError(await getErrorMessage(e)),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gh-panel border border-gh-border rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold mb-4">Import Branches from Excel/CSV</h2>
        <p className="text-sm text-gh-muted mb-4">
          Upload .xlsx or .csv file with columns: Branch Name (required), Branch Code, Region, Area, City, State, Pincode, Address, GST Number, Status
        </p>
        {error && <p className="text-[#f85149] text-sm mb-3">{error}</p>}
        <div className="space-y-3">
          <div className="border-2 border-dashed border-gh-border rounded-lg p-6 text-center hover:border-[#2f81f7] transition-colors">
            <input
              type="file"
              accept=".xlsx,.csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="hidden"
              id="branch-import-file"
            />
            <label htmlFor="branch-import-file" className="cursor-pointer">
              <div className="text-gh-muted">Drag & drop or click to select</div>
              <div className="text-sm text-gh-muted">.xlsx, .csv files</div>
              {file && <div className="text-[#2f81f7] mt-1">{file.name}</div>}
            </label>
          </div>
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
            <Button onClick={() => importMut.mutate()} disabled={!file || loading} className="flex-1">
              {loading ? "Importing..." : "Import"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function BranchesPage() {
  const searchParams = useSearchParams();
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  // Deep-link support: dashboard "Total Branches" KPI links with
  // ?region=<name>; the DataTable's Region dropdown starts pre-selected.
  const regionParam = searchParams.get("region") ?? "";
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["branches"],
    queryFn: async () => (await api.get("/branches")).data,
  });

  const regions = Array.from(new Set((data ?? []).map((b: any) => b.region_name).filter(Boolean))) as string[];
  const areas = Array.from(new Set((data ?? []).map((b: any) => b.area_name).filter(Boolean))) as string[];
  const states = Array.from(new Set((data ?? []).map((b: any) => b.state).filter(Boolean))) as string[];

  const columns: ColumnDef[] = [
    {
      key: "name",
      label: "Branch",
      render: (b) => <span className="font-medium text-gh-text">{b.name}</span>,
    },
    {
      key: "code",
      label: "Code",
      render: (b) => <span className="font-mono text-[13px] text-[#58a6ff]">{b.code}</span>,
    },
    {
      key: "region_name",
      label: "Region",
      options: regions.sort(),
      render: (b) => <span className="text-gh-muted">{b.region_name ?? "-"}</span>,
    },
    {
      key: "area_name",
      label: "Area",
      options: areas.sort(),
      render: (b) => <span className="text-gh-muted">{b.area_name ?? "-"}</span>,
    },
    {
      key: "city",
      label: "City",
      render: (b) => <span className="text-gh-muted">{b.city ?? "-"}</span>,
    },
    {
      key: "state",
      label: "State",
      options: states.sort(),
      render: (b) => <span className="text-gh-muted">{b.state ?? "-"}</span>,
    },
    {
      key: "status",
      label: "Status",
      options: ["Active", "Inactive"],
      render: (b) => (
        <Badge className={b.is_active ? "bg-emerald-600" : "bg-slate-500"}>
          {b.is_active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Branches</h1>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowImport(true)}>Import from Excel</Button>
          <Button onClick={() => setShowCreate(true)}>+ Add Branch</Button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 flex justify-center">
          <div className="animate-spin h-8 w-8 border-4 border-[#2f81f7] border-t-transparent rounded-full" />
        </div>
      ) : (
        <DataTable
          columns={columns}
          rows={data ?? []}
          pageSize={100}
          initialFilters={regionParam ? { region_name: regionParam } : undefined}
          emptyMessage="No branches yet."
          exportName="branches"
        />
      )}

      {showCreate && <CreateBranchModal onClose={() => { setShowCreate(false); refetch(); }} />}
      {showImport && <ImportBranchModal onClose={() => { setShowImport(false); refetch(); }} />}
    </div>
  );
}
