"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/lib/api";
import { Card, Badge, Button, Input, Select, Table, Spinner, EmptyState } from "@/components/ui";

type OrgUser = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  is_active: boolean;
  region_id: string | null;
  area_id: string | null;
  branch_id: string | null;
  roles: { id: string; name: string }[];
};

type OrgRole = { id: string; name: string; description?: string | null };
type OrgRegion = { id: string; name: string; code: string };
type OrgArea = { id: string; region_id: string; name: string; code: string };
type OrgBranch = {
  id: string;
  area_id: string;
  region_id: string;
  name: string;
  code: string;
  city?: string | null;
  manager_id?: string | null;
  is_active: boolean;
};

const scopeLabel = (u: OrgUser, indexes: { region?: Map<string, string>; area?: Map<string, string>; branch?: Map<string, string> }) => {
  const parts: string[] = [];
  if (u.region_id && indexes.region?.has(u.region_id)) parts.push(indexes.region.get(u.region_id)!);
  if (u.area_id && indexes.area?.has(u.area_id)) parts.push(indexes.area.get(u.area_id)!);
  if (u.branch_id && indexes.branch?.has(u.branch_id)) parts.push(indexes.branch.get(u.branch_id)!);
  return parts.length ? parts.join(" → ") : null;
};

const roleTone = (name: string) =>
  name.includes("SUPER") || name.includes("ADMIN")
    ? "bg-[#30363d]"
    : name.includes("HOD")
      ? "bg-purple-600"
      : name.includes("REGIONAL")
        ? "bg-blue-600"
        : name.includes("AREA")
          ? "bg-cyan-600"
          : name.includes("BRANCH")
            ? "bg-emerald-600"
            : name.includes("HR")
              ? "bg-pink-600"
              : name.includes("AUDIT")
                ? "bg-amber-600"
                : "bg-slate-500";

function ScopeFields({
  regionId,
  areaId,
  branchId,
  onChange,
  regions,
  areas,
  branches,
  disabled = false,
}: {
  regionId: string | null;
  areaId: string | null;
  branchId: string | null;
  onChange: (patch: { region_id: string | null; area_id: string | null; branch_id: string | null }) => void;
  regions: OrgRegion[];
  areas: OrgArea[];
  branches: OrgBranch[];
  disabled?: boolean;
}) {
  const regionAreas = useMemo(() => areas.filter((a) => a.region_id === regionId), [areas, regionId]);
  const areaBranches = useMemo(() => branches.filter((b) => b.area_id === areaId), [branches, areaId]);

  return (
    <div className="space-y-3 rounded-xl border border-gh-border bg-white/[0.03] p-3">
      <p className="text-xs font-semibold text-gh-muted uppercase tracking-wide">Branch / Area / Region Mapping</p>
      <Select
        label="Region"
        disabled={disabled}
        value={regionId ?? ""}
        onChange={(e) => onChange({ region_id: e.target.value || null, area_id: null, branch_id: null })}
      >
        <option value="">— Not mapped —</option>
        {regions.map((r) => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
      </Select>
      <Select
        label="Area"
        disabled={disabled || !regionId}
        value={areaId ?? ""}
        onChange={(e) => onChange({ region_id: regionId, area_id: e.target.value || null, branch_id: null })}
      >
        <option value="">— Not mapped —</option>
        {regionAreas.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </Select>
      <Select
        label="Branch"
        disabled={disabled || !areaId}
        value={branchId ?? ""}
        onChange={(e) => onChange({ region_id: regionId, area_id: areaId, branch_id: e.target.value || null })}
      >
        <option value="">— Not mapped —</option>
        {areaBranches.map((b) => (
          <option key={b.id} value={b.id}>{b.name}</option>
        ))}
      </Select>
      <p className="text-[10px] text-gh-faint">
        Mapping a user to a Region / Area / Branch defines their inspection scope (managers see only their units).
      </p>
    </div>
  );
}

function UserFormModal({
  editing,
  onClose,
  onDone,
}: {
  editing: OrgUser | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [email, setEmail] = useState(editing?.email ?? "");
  const [firstName, setFirstName] = useState(editing?.first_name ?? "");
  const [lastName, setLastName] = useState(editing?.last_name ?? "");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState(editing?.phone ?? "");
  const [isActive, setIsActive] = useState(editing?.is_active ?? true);
  const [roleIds, setRoleIds] = useState<string[]>((editing?.roles ?? []).map((r) => r.id));
  const [regionId, setRegionId] = useState<string | null>(editing?.region_id ?? null);
  const [areaId, setAreaId] = useState<string | null>(editing?.area_id ?? null);
  const [branchId, setBranchId] = useState<string | null>(editing?.branch_id ?? null);
  const [error, setError] = useState<string | null>(null);

  const roles = useQuery({ queryKey: ["roles"], queryFn: async () => (await api.get("/roles")).data });
  const regions = useQuery({ queryKey: ["regions"], queryFn: async () => (await api.get("/branches/regions")).data });
  const areas = useQuery({ queryKey: ["org-areas"], queryFn: async () => (await api.get("/branches/areas")).data });
  const branches = useQuery({ queryKey: ["org-branches"], queryFn: async () => (await api.get("/branches")).data });

  const toggleRole = (id: string) =>
    setRoleIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const applyPreset = (name: string, roleNames: string[]) => {
    const all = (roles.data ?? []) as OrgRole[];
    const ids = all.filter((r) => roleNames.includes(r.name)).map((r) => r.id);
    setRoleIds(ids);
    setRolePreset(name);
  };

  const [rolePreset, setRolePreset] = useState<string>(
    editing
      ? (editing.roles ?? []).map((r) => r.name).join(",")
      : ""
  );

  const PRESETS: { name: string; label: string; roles: string[] }[] = [
    { name: "HR", label: "👥 HR", roles: ["HR"] },
    { name: "REGIONAL_ADMIN", label: "🏢 Regional Admin", roles: ["REGIONAL_ADMIN"] },
    { name: "OPS", label: "⚙️ Ops", roles: ["AUDITOR", "AREA_MANAGER", "BRANCH_MANAGER"] },
    { name: "OTHER", label: "🎛 Other", roles: [] },
  ];

  const saveMut = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        email,
        first_name: firstName,
        last_name: lastName,
        phone: phone || null,
        role_ids: roleIds,
        region_id: regionId,
        area_id: areaId,
        branch_id: branchId,
      };
      if (!editing) {
        body.password = password;
        return (await api.post("/users", body)).data;
      }
      body.is_active = isActive;
      return (await api.patch(`/users/${editing.id}`, body)).data;
    },
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: async (e: unknown) => setError(await getErrorMessage(e)),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gh-panel border border-gh-border rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold mb-1">{editing ? "Edit User" : "Create User"}</h2>
        <p className="text-xs text-gh-faint mb-4">
          {editing ? editing.email : "Add a user and assign roles + organizational scope."}
        </p>
        {error && <p className="text-[#f85149] text-sm mb-3">{error}</p>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="First Name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            <Input label="Last Name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            {!editing && <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />}
            {editing && (
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-sm text-gh-muted">
                  <input type="checkbox" className="accent-[#58a6ff]" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                  Active
                </label>
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold text-gh-muted uppercase tracking-wide mb-2">Role (preset)</p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {PRESETS.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  onClick={() => (p.roles.length ? applyPreset(p.name, p.roles) : setRolePreset("OTHER"))}
                  className={`border rounded-lg px-3 py-2 text-sm transition-colors ${
                    rolePreset === p.name
                      ? "border-[#2f81f7] bg-[#2f81f7]/10 text-[#58a6ff]"
                      : "border-gh-border text-gh-muted hover:bg-white/[0.05]"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="text-xs font-semibold text-gh-muted uppercase tracking-wide mb-2">Roles (rights)</p>
            {roles.isLoading ? (
              <Spinner />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {(roles.data ?? []).map((r: OrgRole) => {
                  const checked = roleIds.includes(r.id);
                  return (
                    <label
                      key={r.id}
                      className={`flex items-center gap-2 border rounded-lg px-3 py-2 cursor-pointer text-sm ${
                        checked ? "border-[#2f81f7] bg-[#2f81f7]/10 text-[#58a6ff]" : "border-gh-border text-gh-muted hover:bg-white/[0.05]"
                      }`}
                    >
                      <input type="checkbox" className="accent-[#58a6ff]" checked={checked} onChange={() => toggleRole(r.id)} />
                      {r.name.replace("_", " ")}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          <ScopeFields
            regionId={regionId}
            areaId={areaId}
            branchId={branchId}
            onChange={(p) => {
              setRegionId(p.region_id);
              setAreaId(p.area_id);
              setBranchId(p.branch_id);
            }}
            regions={regions.data ?? []}
            areas={areas.data ?? []}
            branches={branches.data ?? []}
            disabled={areas.isLoading || branches.isLoading}
          />

          <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => saveMut.mutate()}
              disabled={!email || !firstName || !lastName || (!editing && !password)}
              className="flex-1"
            >
              {editing ? "Save Changes" : "Create User"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RightsTab() {
  const roles = useQuery({ queryKey: ["roles"], queryFn: async () => (await api.get("/roles")).data });
  const permList = useQuery({ queryKey: ["permissions"], queryFn: async () => (await api.get("/roles/permissions")).data });
  const [expanded, setExpanded] = useState<string | null>(null);

  const roleDetails = useQuery({
    queryKey: ["role-detail", expanded],
    queryFn: async () => (expanded ? (await api.get(`/roles/${expanded}`)).data : null),
    enabled: !!expanded,
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-gh-muted">
        Every role carries a fixed set of rights. Click a role to inspect its permissions.
      </p>
      {roles.isLoading ? (
        <Spinner />
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {(roles.data ?? []).map((r: OrgRole) => (
            <Card key={r.id} className="space-y-0">
              <button
                className="w-full text-left flex items-center justify-between p-4"
                onClick={() => setExpanded(expanded === r.id ? null : r.id)}
              >
                <div className="flex items-center gap-2">
                  <Badge className={roleTone(r.name)}>{r.name.replace("_", " ")}</Badge>
                  {r.description && <span className="text-xs text-gh-faint truncate">{r.description}</span>}
                </div>
                <span className="text-gh-faint text-sm">{expanded === r.id ? "▾" : "▸"}</span>
              </button>
              {expanded === r.id && (
                <div className="px-4 pb-4">
                  {roleDetails.isLoading ? (
                    <Spinner />
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {(roleDetails.data?.permissions ?? []).map((p: { id: string; name: string }) => (
                        <span key={p.id} className="text-[11px] font-mono bg-white/[0.07] text-gh-muted rounded px-2 py-1 border border-gh-border">
                          {p.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
      <p className="text-xs text-gh-faint">
        {permList.data?.length ?? 0} permissions defined across the system.
      </p>
    </div>
  );
}

function MappingTab({
  users,
  regions,
  areas,
  branches,
}: {
  users: OrgUser[];
  regions: OrgRegion[];
  areas: OrgArea[];
  branches: OrgBranch[];
}) {
  const idx = useMemo(() => {
    const region = new Map(regions.map((r) => [r.id, r.name]));
    const area = new Map(areas.map((a) => [a.id, `${a.name} (${a.code})`]));
    const branch = new Map(branches.map((b) => [b.id, b.name]));
    return { region, area, branch };
  }, [regions, areas, branches]);

  const userChips = (list: OrgUser[]) =>
    list.length ? (
      <div className="flex flex-wrap gap-1.5 mt-1">
        {list.map((u) => (
          <span key={u.id} className="text-[11px] bg-[#2f81f7]/12 text-[#58a6ff] border border-[#58a6ff]/25 rounded-full px-2 py-0.5">
            {u.first_name} {u.last_name}
          </span>
        ))}
      </div>
    ) : (
      <p className="text-xs text-gh-faint mt-1">No user mapped</p>
    );

  const unmapped = users.filter((u) => !u.region_id && !u.area_id && !u.branch_id);

  if (regions.length === 0) {
    return <EmptyState message="No regions defined yet. Add regions under Branches first." />;
  }

  return (
    <div className="space-y-6">
      {regions.map((region) => {
        const rgUsers = users.filter((u) => u.region_id === region.id);
        const rgAreas = areas.filter((a) => a.region_id === region.id);
        return (
          <Card key={region.id} className="divide-y divide-white/[0.06]">
            <div className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="font-bold text-gh-text">{region.name}</p>
                <p className="text-xs text-gh-faint">{region.code} · {rgAreas.length} area(s) · {branches.filter((b) => b.region_id === region.id).length} branch(es)</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wide text-gh-faint">Region in-charge</p>
                {userChips(rgUsers)}
              </div>
            </div>

            {rgAreas.map((area) => {
              const arUsers = users.filter((u) => u.area_id === area.id);
              const arBranches = branches.filter((b) => b.area_id === area.id);
              return (
                <div key={area.id} className="px-5 py-3 pl-10">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-[#c9d1d9]">{area.name}</p>
                      <p className="text-xs text-gh-faint">{area.code} · {arBranches.length} branch(es)</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-wide text-gh-faint">Area in-charge</p>
                      {userChips(arUsers)}
                    </div>
                  </div>

                  {arBranches.map((branch) => {
                    const brUsers = users.filter((u) => u.branch_id === branch.id);
                    const manager = users.find((u) => u.id === branch.manager_id);
                    return (
                      <div key={branch.id} className="mt-2 rounded-lg border border-gh-border bg-white/[0.03] px-4 py-2.5 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-[#c9d1d9]">
                            {branch.name} <span className="text-[10px] text-gh-faint ml-1">{branch.code}</span>
                            {!branch.is_active && <Badge className="bg-slate-400 ml-2">Inactive</Badge>}
                          </p>
                          <p className="text-[11px] text-gh-faint">
                            {branch.city ?? "—"}
                            {manager && <span className="ml-2">Manager: <b className="text-gh-muted">{manager.first_name} {manager.last_name}</b></span>}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] uppercase tracking-wide text-gh-faint">Users mapped here</p>
                          {userChips(brUsers)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </Card>
        );
      })}

      <Card>
        <div className="px-5 py-4 flex items-center justify-between">
          <div>
            <p className="font-bold text-gh-text">Unmapped Users</p>
            <p className="text-xs text-gh-faint">Have no Region / Area / Branch scope — review and assign them.</p>
          </div>
          <Badge className={unmapped.length ? "bg-amber-500" : "bg-emerald-500"}>{unmapped.length}</Badge>
        </div>
        {unmapped.length > 0 && (
          <div className="px-5 pb-4 flex flex-wrap gap-2">
            {unmapped.map((u) => (
              <span key={u.id} className="text-xs border border-[#d29922]/30 bg-[#d29922]/10 text-[#d29922] rounded-full px-3 py-1">
                {u.first_name} {u.last_name} · {u.email}
              </span>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Org Tree tab: Region → Area → Branch → Employees, with reassign           */
/* -------------------------------------------------------------------------- */
type OrgEmployee = {
  id: string;
  emp_code: string;
  name: string;
  department: string | null;
  branch_id: string;
  branch_name: string | null;
  hr_manager_name: string | null;
  is_active: boolean;
};

function ReassignModal({
  employee,
  regions,
  areas,
  branches,
  onClose,
  onDone,
}: {
  employee: OrgEmployee;
  regions: OrgRegion[];
  areas: OrgArea[];
  branches: OrgBranch[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [branchId, setBranchId] = useState(employee.branch_id);
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: async () => (await api.patch(`/employees/${employee.id}`, { branch_id: branchId })).data,
    onSuccess: () => {
      onDone();
      onClose();
    },
    onError: async (e: unknown) => setError(await getErrorMessage(e)),
  });

  const areasByRegion = useMemo(() => {
    const m = new Map<string, OrgArea[]>();
    for (const a of areas) m.set(a.region_id, [...(m.get(a.region_id) ?? []), a]);
    return m;
  }, [areas]);
  const branchesByArea = useMemo(() => {
    const m = new Map<string, OrgBranch[]>();
    for (const b of branches) m.set(b.area_id, [...(m.get(b.area_id) ?? []), b]);
    return m;
  }, [branches]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gh-panel border border-gh-border rounded-xl p-6 w-full max-w-md">
        <h2 className="text-lg font-bold mb-1">Reassign Employee</h2>
        <p className="text-xs text-gh-faint mb-4">
          {employee.name} ({employee.emp_code}) · current: {employee.branch_name ?? "—"}
        </p>
        {error && <p className="text-[#f85149] text-sm mb-3">{error}</p>}
        <Select label="New Branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
          {regions.map((r) => {
            const rgAreas = areasByRegion.get(r.id) ?? [];
            return (
              <optgroup key={r.id} label={r.name}>
                {rgAreas.map((a) => {
                  const arBranches = branchesByArea.get(a.id) ?? [];
                  if (arBranches.length === 0) return null;
                  return (
                    <optgroup key={a.id} label={`↳ ${a.name}`}>
                      {arBranches.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </optgroup>
                  );
                })}
              </optgroup>
            );
          })}
        </Select>
        <p className="text-[11px] text-gh-faint mt-2">
          Reassignment is instant — the employee's IT asset records and visit history stay attached to them.
        </p>
        <div className="flex gap-3 pt-4">
          <Button variant="secondary" onClick={onClose} className="flex-1">Cancel</Button>
          <Button
            onClick={() => mut.mutate()}
            disabled={!branchId || branchId === employee.branch_id || mut.isPending}
            className="flex-1"
          >
            {mut.isPending ? "Moving…" : "Reassign"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function OrgTreeTab({
  users,
  regions,
  areas,
  branches,
}: {
  users: OrgUser[];
  regions: OrgRegion[];
  areas: OrgArea[];
  branches: OrgBranch[];
}) {
  const qc = useQueryClient();
  const [openRegions, setOpenRegions] = useState<Set<string>>(new Set());
  const [openBranches, setOpenBranches] = useState<Set<string>>(new Set());
  const [reassignEmp, setReassignEmp] = useState<OrgEmployee | null>(null);
  const [search, setSearch] = useState("");

  const employees = useQuery({
    queryKey: ["org-tree-employees"],
    queryFn: async () => (await api.get("/employees", { params: { limit: 20000 } })).data as OrgEmployee[],
  });

  const byBranch = useMemo(() => {
    const m = new Map<string, OrgEmployee[]>();
    for (const e of employees.data ?? []) {
      if (!m.has(e.branch_id)) m.set(e.branch_id, []);
      m.get(e.branch_id)!.push(e);
    }
    return m;
  }, [employees.data]);

  const needle = search.trim().toLowerCase();
  const match = (e: OrgEmployee) =>
    !needle || e.name.toLowerCase().includes(needle) || e.emp_code.toLowerCase().includes(needle);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const branchCount = (regionId: string) => branches.filter((b) => b.region_id === regionId).length;
  const empCount = (regionId: string) =>
    branches.filter((b) => b.region_id === regionId).reduce((n, b) => n + (byBranch.get(b.id)?.length ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Input
          placeholder="Search employee name or code across the tree…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        {(employees.data ?? []).length > 0 && (
          <span className="text-xs text-gh-faint">{(employees.data ?? []).length} employees in scope</span>
        )}
      </div>

      {employees.isLoading ? (
        <Spinner />
      ) : regions.length === 0 ? (
        <EmptyState message="No regions defined yet. Import employees as super admin or add regions under Branches." />
      ) : (
        regions.map((region) => {
          const regionOpen = needle.length > 0 || openRegions.has(region.id);
          const rgAreas = areas.filter((a) => a.region_id === region.id);
          const inCharge = users.filter((u) => u.region_id === region.id);
          return (
            <Card key={region.id} className="divide-y divide-white/[0.06]">
              <button
                className="w-full text-left px-5 py-3 flex items-center justify-between"
                onClick={() => toggle(openRegions, setOpenRegions, region.id)}
              >
                <div>
                  <p className="font-bold text-gh-text">
                    🏛 {region.name} <span className="text-xs text-gh-faint font-normal ml-1">{region.code}</span>
                  </p>
                  <p className="text-xs text-gh-faint">
                    {rgAreas.length} area(s) · {branchCount(region.id)} branch(es) · {empCount(region.id)} employee(s)
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {inCharge.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {inCharge.map((u) => (
                        <span key={u.id} className="text-[11px] bg-[#2f81f7]/12 text-[#58a6ff] border border-[#58a6ff]/25 rounded-full px-2 py-0.5">
                          {u.first_name} {u.last_name}
                        </span>
                      ))}
                    </div>
                  )}
                  <span className="text-gh-faint text-sm">{regionOpen ? "▾" : "▸"}</span>
                </div>
              </button>

              {regionOpen &&
                rgAreas.map((area) => {
                  const arBranches = branches.filter((b) => b.area_id === area.id);
                  return (
                    <div key={area.id} className="px-5 py-2 pl-10">
                      <p className="font-semibold text-[#c9d1d9] text-sm">
                        ↳ {area.name} <span className="text-[11px] text-gh-faint">{arBranches.length} branch(es)</span>
                      </p>
                      {arBranches.map((branch) => {
                        const all = byBranch.get(branch.id) ?? [];
                        const emps = all.filter(match);
                        const open = needle.length > 0 || openBranches.has(branch.id);
                        return (
                          <div key={branch.id} className="mt-1.5 rounded-lg border border-gh-border bg-white/[0.03]">
                            <button
                              className="w-full text-left px-4 py-2 flex items-center justify-between"
                              onClick={() => toggle(openBranches, setOpenBranches, branch.id)}
                            >
                              <div>
                                <p className="text-sm font-medium text-[#c9d1d9]">
                                  ↳ {branch.name} <span className="text-[10px] text-gh-faint ml-1">{branch.code}</span>
                                </p>
                                <p className="text-[11px] text-gh-faint">{all.length} employee(s)</p>
                              </div>
                              <span className="text-gh-faint text-xs">{open ? "▾" : "▸"}</span>
                            </button>
                            {open && (
                              <div className="px-4 pb-3 flex flex-wrap gap-2">
                                {emps.length === 0 ? (
                                  <p className="text-xs text-gh-faint italic">{needle ? "No matches here" : "No employees here"}</p>
                                ) : (
                                  emps.map((e) => (
                                    <span key={e.id} className="inline-flex items-center gap-2 text-[11px] bg-white/[0.05] border border-gh-border rounded-full pl-2.5 pr-1.5 py-0.5">
                                      <span>
                                        <b className="text-gh-text font-semibold">{e.name}</b>
                                        <span className="font-mono text-gh-faint ml-1">{e.emp_code}</span>
                                        {e.hr_manager_name && (
                                          <span className="text-pink-400/80 ml-1.5" title="HR Manager">HR: {e.hr_manager_name}</span>
                                        )}
                                        {!e.is_active && <span className="text-gh-faint ml-1.5">(inactive)</span>}
                                      </span>
                                      <button
                                        className="text-[#58a6ff] hover:underline font-semibold px-1"
                                        title={`Move ${e.name} to another branch`}
                                        onClick={(ev) => {
                                          ev.stopPropagation();
                                          setReassignEmp(e);
                                        }}
                                      >
                                        Reassign
                                      </button>
                                    </span>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
            </Card>
          );
        })
      )}

      {reassignEmp && (
        <ReassignModal
          employee={reassignEmp}
          regions={regions}
          areas={areas}
          branches={branches}
          onClose={() => setReassignEmp(null)}
          onDone={() => qc.invalidateQueries({ queryKey: ["org-tree-employees"] })}
        />
      )}
    </div>
  );
}

export default function OrganizationPage() {
  const [tab, setTab] = useState<"users" | "mapping" | "tree" | "rights">("users");
  const [editing, setEditing] = useState<OrgUser | null>(null);
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();

  const users = useQuery({ queryKey: ["users"], queryFn: async () => (await api.get("/users")).data });
  const regions = useQuery({ queryKey: ["regions"], queryFn: async () => (await api.get("/branches/regions")).data });
  const areas = useQuery({ queryKey: ["org-areas"], queryFn: async () => (await api.get("/branches/areas")).data });
  const branches = useQuery({ queryKey: ["org-branches"], queryFn: async () => (await api.get("/branches")).data });

  const deactivateMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
    onError: async (e: unknown) => alert(await getErrorMessage(e)),
  });

  const idx = useMemo<{ region: Map<string, string>; area: Map<string, string>; branch: Map<string, string> }>(() => {
    const region = new Map<string, string>((regions.data ?? []).map((r: OrgRegion) => [r.id, r.name]));
    const area = new Map<string, string>((areas.data ?? []).map((a: OrgArea) => [a.id, a.name]));
    const branch = new Map<string, string>((branches.data ?? []).map((b: OrgBranch) => [b.id, b.name]));
    return { region, area, branch };
  }, [regions.data, areas.data, branches.data]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["users"] });
    queryClient.invalidateQueries({ queryKey: ["regions"] });
    queryClient.invalidateQueries({ queryKey: ["org-areas"] });
    queryClient.invalidateQueries({ queryKey: ["org-branches"] });
  };

  const tabs = [
    { id: "users", label: "Users & Rights" },
    { id: "mapping", label: "Org Mapping" },
    { id: "tree", label: "Org Tree & Reassign" },
    { id: "rights", label: "Role Rights" },
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Organization</h1>
        <Button onClick={() => setCreating(true)}>+ Add User</Button>
      </div>

      <div className="flex gap-1 border-b border-gh-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id ? "border-[#2f81f7] text-[#58a6ff]" : "border-transparent text-gh-faint hover:text-gh-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "rights" ? (
        <RightsTab />
      ) : tab === "tree" ? (
        regions.isLoading || areas.isLoading || branches.isLoading || users.isLoading ? (
          <Spinner />
        ) : (
          <OrgTreeTab users={users.data ?? []} regions={regions.data ?? []} areas={areas.data ?? []} branches={branches.data ?? []} />
        )
      ) : tab === "mapping" ? (
        regions.isLoading || areas.isLoading || branches.isLoading || users.isLoading ? (
          <Spinner />
        ) : (
          <MappingTab users={users.data ?? []} regions={regions.data ?? []} areas={areas.data ?? []} branches={branches.data ?? []} />
        )
      ) : users.isLoading ? (
        <Spinner />
      ) : (
        <Card>
          <Table headers={["Name", "Email", "Phone", "Rights", "Scope", "Status", "Actions"]}>
            {(users.data ?? []).length === 0 && (
              <tr>
                <td colSpan={7}>
                  <EmptyState message="No users yet." />
                </td>
              </tr>
            )}
            {(users.data ?? []).map((u: OrgUser) => (
              <tr key={u.id} className="hover:bg-white/[0.04]">
                <td className="px-4 py-3 font-medium text-gh-text">{u.first_name} {u.last_name}</td>
                <td className="px-4 py-3 text-gh-muted">{u.email}</td>
                <td className="px-4 py-3 text-gh-muted">{u.phone ?? "-"}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1 flex-wrap">
                    {(u.roles ?? []).map((r: OrgRole) => (
                      <Badge key={r.id} className={roleTone(r.name)}>{r.name.replace("_", " ")}</Badge>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-gh-muted">{scopeLabel(u, idx) ?? <span className="text-[#484f58]">—</span>}</span>
                </td>
                <td className="px-4 py-3">
                  <Badge className={u.is_active ? "bg-emerald-500" : "bg-slate-400"}>{u.is_active ? "Active" : "Inactive"}</Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setEditing(u)}>Edit</Button>
                    {u.is_active && (
                      <button
                        className="text-xs text-[#f85149] hover:underline"
                        onClick={() => {
                          if (confirm(`Deactivate ${u.first_name} ${u.last_name}?`)) deactivateMut.mutate(u.id);
                        }}
                      >
                        Deactivate
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}

      {(creating || editing) && (
        <UserFormModal editing={editing} onClose={() => { setCreating(false); setEditing(null); }} onDone={refresh} />
      )}
    </div>
  );
}