"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { api, getErrorMessage } from "@/lib/api";
import {
  Button,
  Card,
  Input,
  Select,
  Badge,
  Table,
  Spinner,
  EmptyState,
} from "@/components/ui";

type SettingsTab = "account" | "users" | "mapping" | "checklists" | "audit-logs";

/* -------------------------------------------------------------------------- */
/* Helper Functions                                                           */
/* -------------------------------------------------------------------------- */
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

const scopeLabel = (u: any, indexes: { region?: Map<string, string>; area?: Map<string, string>; branch?: Map<string, string> }) => {
  const parts: string[] = [];
  if (u.region_id && indexes.region?.has(u.region_id)) parts.push(indexes.region.get(u.region_id)!);
  if (u.area_id && indexes.area?.has(u.area_id)) parts.push(indexes.area.get(u.area_id)!);
  if (u.branch_id && indexes.branch?.has(u.branch_id)) parts.push(indexes.branch.get(u.branch_id)!);
  return parts.length ? parts.join(" → ") : null;
};

/* -------------------------------------------------------------------------- */
/* User Creation & Editing Modal                                              */
/* -------------------------------------------------------------------------- */
function UserFormModal({
  editing,
  onClose,
  onDone,
}: {
  editing: any | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [email, setEmail] = useState(editing?.email ?? "");
  const [firstName, setFirstName] = useState(editing?.first_name ?? "");
  const [lastName, setLastName] = useState(editing?.last_name ?? "");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState(editing?.phone ?? "");
  const [isActive, setIsActive] = useState(editing?.is_active ?? true);
  const [roleIds, setRoleIds] = useState<string[]>((editing?.roles ?? []).map((r: any) => r.id));
  const [regionId, setRegionId] = useState<string | null>(editing?.region_id ?? null);
  const [areaId, setAreaId] = useState<string | null>(editing?.area_id ?? null);
  const [branchId, setBranchId] = useState<string | null>(editing?.branch_id ?? null);
  const [error, setError] = useState<string | null>(null);

  const roles = useQuery({ queryKey: ["roles"], queryFn: async () => (await api.get("/roles")).data });
  const regions = useQuery({ queryKey: ["regions"], queryFn: async () => (await api.get("/branches/regions")).data });
  const areas = useQuery({ queryKey: ["org-areas"], queryFn: async () => (await api.get("/branches/areas")).data });
  const branches = useQuery({ queryKey: ["org-branches"], queryFn: async () => (await api.get("/branches")).data });

  const regionAreas = useMemo(() => (areas.data ?? []).filter((a: any) => a.region_id === regionId), [areas.data, regionId]);
  const areaBranches = useMemo(() => (branches.data ?? []).filter((b: any) => b.area_id === areaId), [branches.data, areaId]);
  const [regionSearch, setRegionSearch] = useState("");
  const [areaSearch, setAreaSearch] = useState("");
  const [branchSearch, setBranchSearch] = useState("");

  const filteredRegions = useMemo(() => {
    const q = regionSearch.trim().toLowerCase();
    return (regions.data ?? []).filter((r: any) => !q || `${r.name} ${r.code ?? ""}`.toLowerCase().includes(q));
  }, [regions.data, regionSearch]);
  const filteredAreas = useMemo(() => {
    const q = areaSearch.trim().toLowerCase();
    return regionAreas.filter((a: any) => !q || `${a.name} ${a.code ?? ""}`.toLowerCase().includes(q));
  }, [regionAreas, areaSearch]);
  const filteredBranches = useMemo(() => {
    const q = branchSearch.trim().toLowerCase();
    return areaBranches.filter((b: any) => !q || `${b.name} ${b.code ?? ""}`.toLowerCase().includes(q));
  }, [areaBranches, branchSearch]);

  const toggleRole = (id: string) =>
    setRoleIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gh-panel border border-gh-border rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-2xl">
        <h2 className="text-lg font-bold text-white mb-1">{editing ? "Edit User Account" : "Create New User"}</h2>
        <p className="text-xs text-gh-muted mb-4">
          Assign role rights and specify geographical branch/area/region inspection visibility.
        </p>
        {error && <p className="text-[#f85149] text-sm mb-3 bg-red-950/40 p-2.5 rounded-lg border border-red-800/40">{error}</p>}
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="First Name *" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            <Input label="Last Name *" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
          <Input label="Email Address *" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            {!editing ? (
              <Input label="Password *" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            ) : (
              <div className="flex items-end pb-2">
                <label className="flex items-center gap-2 text-sm text-gh-muted cursor-pointer">
                  <input type="checkbox" className="accent-[#58a6ff]" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                  Active Account
                </label>
              </div>
            )}
          </div>

          {/* Role Checkboxes */}
          <div>
            <p className="text-xs font-semibold text-gh-muted uppercase tracking-wide mb-2">Assigned Roles</p>
            {roles.isLoading ? (
              <Spinner />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {(roles.data ?? []).map((r: any) => {
                  const checked = roleIds.includes(r.id);
                  return (
                    <label
                      key={r.id}
                      className={`flex items-center gap-2 border rounded-lg px-3 py-2 cursor-pointer text-xs ${
                        checked ? "border-[#2f81f7] bg-[#2f81f7]/10 text-[#58a6ff]" : "border-gh-border text-gh-muted hover:bg-white/[0.04]"
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

          {/* Org Scoping */}
          <div className="space-y-2 rounded-xl border border-gh-border bg-white/[0.02] p-3">
            <p className="text-xs font-semibold text-gh-muted uppercase tracking-wide">Inspection Geographical Scope</p>
            <Input placeholder="Search region..." value={regionSearch} onChange={(e) => setRegionSearch(e.target.value)} />
            <Select
              label="Region"
              value={regionId ?? ""}
              onChange={(e) => {
                setRegionId(e.target.value || null);
                setAreaId(null);
                setBranchId(null);
              }}
            >
              <option value="">— All Regions / Unrestricted —</option>
              {filteredRegions.map((r: any) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </Select>
            <Input placeholder="Search area..." value={areaSearch} onChange={(e) => setAreaSearch(e.target.value)} disabled={!regionId} />
            <Select
              label="Area"
              disabled={!regionId}
              value={areaId ?? ""}
              onChange={(e) => {
                setAreaId(e.target.value || null);
                setBranchId(null);
              }}
            >
              <option value="">— All Areas in Region —</option>
              {filteredAreas.map((a: any) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
            <Input placeholder="Search branch..." value={branchSearch} onChange={(e) => setBranchSearch(e.target.value)} disabled={!areaId} />
            <Select
              label="Branch"
              disabled={!areaId}
              value={branchId ?? ""}
              onChange={(e) => setBranchId(e.target.value || null)}
            >
              <option value="">— All Branches in Area —</option>
              {filteredBranches.map((b: any) => (
                <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
              ))}
            </Select>
          </div>

          <div className="flex gap-3 pt-3">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => saveMut.mutate()}
              disabled={!email || !firstName || !lastName || (!editing && !password) || saveMut.isPending}
              className="flex-1"
            >
              {saveMut.isPending ? "Saving..." : editing ? "Save Changes" : "Create User"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main Settings Page Component                                               */
/* -------------------------------------------------------------------------- */
export default function SettingsPage() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();

  const isSuper = !!user && ["SUPER_ADMIN", "ADMIN"].some((r) =>
    (user.roles ?? []).some((x: any) => x.name === r)
  );

  const [activeTab, setActiveTab] = useState<SettingsTab>("account");

  // Account tab state
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null);
  const [pwdError, setPwdError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    first_name: user?.first_name || "",
    last_name: user?.last_name || "",
    phone: user?.phone || "",
    current_password: "",
    new_password: "",
    confirm_password: "",
  });

  // Users tab state
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [creatingUser, setCreatingUser] = useState(false);

  // Queries for Org & Mapping
  const usersQ = useQuery({ queryKey: ["settings-users"], queryFn: async () => (await api.get("/users")).data, enabled: isSuper });
  const regionsQ = useQuery({ queryKey: ["settings-regions"], queryFn: async () => (await api.get("/branches/regions")).data, enabled: isSuper });
  const areasQ = useQuery({ queryKey: ["settings-areas"], queryFn: async () => (await api.get("/branches/areas")).data, enabled: isSuper });
  const branchesQ = useQuery({ queryKey: ["settings-branches"], queryFn: async () => (await api.get("/branches?limit=500")).data, enabled: isSuper });
  const checklistsQ = useQuery({ queryKey: ["settings-templates"], queryFn: async () => (await api.get("/checklists/templates")).data, enabled: isSuper });
  const auditLogsQ = useQuery({ queryKey: ["settings-audit-logs"], queryFn: async () => (await api.get("/dashboard/audit-logs?limit=100")).data, enabled: isSuper });

  const idx = useMemo<{ region: Map<string, string>; area: Map<string, string>; branch: Map<string, string> }>(() => {
    const region = new Map<string, string>((regionsQ.data ?? []).map((r: any) => [String(r.id), String(r.name)]));
    const area = new Map<string, string>((areasQ.data ?? []).map((a: any) => [String(a.id), String(a.name)]));
    const branch = new Map<string, string>((branchesQ.data ?? []).map((b: any) => [String(b.id), String(b.name)]));
    return { region, area, branch };
  }, [regionsQ.data, areasQ.data, branchesQ.data]);

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileLoading(true);
    setProfileError(null);
    try {
      await api.patch("/users/me", {
        first_name: formData.first_name,
        last_name: formData.last_name,
        phone: formData.phone,
      });
      setProfileSuccess("Profile updated successfully");
    } catch (e: any) {
      setProfileError(await getErrorMessage(e));
    } finally {
      setProfileLoading(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError(null);
    setPwdSuccess(null);
    if (formData.new_password !== formData.confirm_password) {
      setPwdError("New passwords do not match");
      return;
    }
    if (formData.new_password.length < 8) {
      setPwdError("Password must be at least 8 characters");
      return;
    }
    setPwdLoading(true);
    try {
      await api.post("/auth/change-password", {
        current_password: formData.current_password,
        new_password: formData.new_password,
      });
      setFormData({ ...formData, current_password: "", new_password: "", confirm_password: "" });
      setPwdSuccess("Password changed successfully");
    } catch (e: any) {
      setPwdError(await getErrorMessage(e));
    } finally {
      setPwdLoading(false);
    }
  };

  const deactivateMut = useMutation({
    mutationFn: async (id: string) => api.delete(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings-users"] }),
    onError: async (e: any) => alert(await getErrorMessage(e)),
  });

  const roles = user?.roles?.map((r: any) => r.name).join(", ") || "User";

  return (
    <div className="space-y-6 max-w-[1280px]">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">System Settings & Administration</h1>
        <p className="text-sm text-gh-muted mt-1">
          Manage your profile, system users, organizational hierarchy scopes, checklists, and security audit logs.
        </p>
      </div>

      {/* Tabs Header */}
      <div className="flex border-b border-white/[0.08] gap-2 overflow-x-auto pb-px gh-scroll">
        <button
          onClick={() => setActiveTab("account")}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${
            activeTab === "account" ? "border-[#2f81f7] text-[#58a6ff] bg-white/[0.03]" : "border-transparent text-gh-muted hover:text-white"
          }`}
        >
          <span>👤</span>
          <span>My Account</span>
        </button>

        {isSuper && (
          <>
            <button
              onClick={() => setActiveTab("users")}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${
                activeTab === "users" ? "border-[#2f81f7] text-[#58a6ff] bg-white/[0.03]" : "border-transparent text-gh-muted hover:text-white"
              }`}
            >
              <span>👥</span>
              <span>Users & Roles</span>
            </button>
            <button
              onClick={() => setActiveTab("mapping")}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${
                activeTab === "mapping" ? "border-[#2f81f7] text-[#58a6ff] bg-white/[0.03]" : "border-transparent text-gh-muted hover:text-white"
              }`}
            >
              <span>🗺️</span>
              <span>Org Scope Tree</span>
            </button>
            <button
              onClick={() => setActiveTab("checklists")}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${
                activeTab === "checklists" ? "border-[#2f81f7] text-[#58a6ff] bg-white/[0.03]" : "border-transparent text-gh-muted hover:text-white"
              }`}
            >
              <span>📝</span>
              <span>Checklist Templates</span>
            </button>
            <button
              onClick={() => setActiveTab("audit-logs")}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${
                activeTab === "audit-logs" ? "border-[#2f81f7] text-[#58a6ff] bg-white/[0.03]" : "border-transparent text-gh-muted hover:text-white"
              }`}
            >
              <span>🔒</span>
              <span>Security Audit Logs</span>
            </button>
          </>
        )}
      </div>

      {/* ==================================================================== */}
      {/* TAB 1: MY ACCOUNT                                                    */}
      {/* ==================================================================== */}
      {activeTab === "account" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="p-6 space-y-4">
            <h2 className="text-lg font-bold text-white">Profile Information</h2>
            <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.06] flex items-center justify-between">
              <div>
                <p className="text-xs text-gh-muted">Signed in as</p>
                <p className="font-semibold text-white">{user?.email}</p>
              </div>
              <Badge className="bg-[#2f81f7]/20 border border-[#2f81f7]/40 text-[#58a6ff] font-mono">
                {roles}
              </Badge>
            </div>

            <form onSubmit={handleProfileUpdate} className="space-y-3 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="First Name"
                  value={formData.first_name}
                  onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                  required
                />
                <Input
                  label="Last Name"
                  value={formData.last_name}
                  onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                  required
                />
              </div>
              <Input
                label="Phone Number"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
              {profileError && <p className="text-[#f85149] text-xs">{profileError}</p>}
              {profileSuccess && <p className="text-[#3fb950] text-xs">{profileSuccess}</p>}
              <Button type="submit" variant="primary" disabled={profileLoading} className="w-full">
                {profileLoading ? "Saving..." : "Save Profile Details"}
              </Button>
            </form>
          </Card>

          <Card className="p-6 space-y-4">
            <h2 className="text-lg font-bold text-white">Change Password</h2>
            <form onSubmit={handlePasswordChange} className="space-y-3">
              <Input
                label="Current Password"
                type="password"
                value={formData.current_password}
                onChange={(e) => setFormData({ ...formData, current_password: e.target.value })}
                required
              />
              <Input
                label="New Password"
                type="password"
                value={formData.new_password}
                onChange={(e) => setFormData({ ...formData, new_password: e.target.value })}
                required
                minLength={8}
              />
              <Input
                label="Confirm New Password"
                type="password"
                value={formData.confirm_password}
                onChange={(e) => setFormData({ ...formData, confirm_password: e.target.value })}
                required
              />
              {pwdError && <p className="text-[#f85149] text-xs">{pwdError}</p>}
              {pwdSuccess && <p className="text-[#3fb950] text-xs">{pwdSuccess}</p>}
              <Button type="submit" variant="secondary" disabled={pwdLoading} className="w-full">
                {pwdLoading ? "Updating..." : "Update Password"}
              </Button>
            </form>

            <div className="pt-4 border-t border-white/[0.08] flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-white">End Session</p>
                <p className="text-[11px] text-gh-muted">Sign out of this computer</p>
              </div>
              <Button
                variant="danger"
                onClick={async () => {
                  await logout();
                  router.replace("/login");
                }}
              >
                Sign Out
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 2: USERS & ROLES                                                 */}
      {/* ==================================================================== */}
      {activeTab === "users" && isSuper && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gh-muted">
              Active users registered in the system with their geographical inspection scope.
            </p>
            <Button onClick={() => setCreatingUser(true)}>+ Add User</Button>
          </div>

          <Card className="overflow-hidden">
            {usersQ.isLoading ? (
              <Spinner />
            ) : (
              <Table headers={["Name", "Email", "Phone", "Roles & Rights", "Geographical Scope", "Status", "Actions"]}>
                {(usersQ.data ?? []).map((u: any) => (
                  <tr key={u.id} className="hover:bg-white/[0.03]">
                    <td className="px-4 py-3 font-semibold text-white">{u.first_name} {u.last_name}</td>
                    <td className="px-4 py-3 text-xs text-gh-muted font-mono">{u.email}</td>
                    <td className="px-4 py-3 text-xs text-gh-muted">{u.phone ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {(u.roles ?? []).map((r: any) => (
                          <Badge key={r.id} className={roleTone(r.name)}>
                            {r.name.replace("_", " ")}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-gh-muted">
                      {scopeLabel(u, idx) ?? <span className="text-[#484f58] italic">Global Scope</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={u.is_active ? "bg-emerald-600" : "bg-slate-500"}>
                        {u.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setEditingUser(u)}
                          className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-[#58a6ff] font-semibold"
                        >
                          Edit
                        </button>
                        {u.is_active && (
                          <button
                            onClick={() => {
                              if (confirm(`Deactivate ${u.first_name} ${u.last_name}?`)) deactivateMut.mutate(u.id);
                            }}
                            className="px-2.5 py-1 rounded-lg bg-red-500/10 text-xs text-red-400 font-semibold hover:bg-red-500/20"
                          >
                            Off
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 3: ORG SCOPE TREE                                                */}
      {/* ==================================================================== */}
      {activeTab === "mapping" && isSuper && (
        <div className="space-y-4">
          <p className="text-sm text-gh-muted">
            Hierarchy tree showing which regional administrators, area managers, and branch managers oversee each physical branch.
          </p>
          <div className="grid grid-cols-1 gap-4">
            {(regionsQ.data ?? []).map((region: any) => {
              const rgAreas = (areasQ.data ?? []).filter((a: any) => a.region_id === region.id);
              const rgBranches = (branchesQ.data ?? []).filter((b: any) => b.region_id === region.id);

              return (
                <Card key={region.id} className="p-5 space-y-3">
                  <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
                    <div>
                      <h3 className="text-base font-bold text-white">{region.name}</h3>
                      <p className="text-xs text-gh-muted">{rgAreas.length} Areas · {rgBranches.length} Physical Branches</p>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/25 text-[#58a6ff] font-mono text-xs font-bold">
                      {region.code}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
                    {rgAreas.map((area: any) => {
                      const areaBrList = (branchesQ.data ?? []).filter((b: any) => b.area_id === area.id);
                      return (
                        <div key={area.id} className="p-3 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-2">
                          <p className="font-semibold text-white text-xs">{area.name} ({area.code})</p>
                          <div className="space-y-1">
                            {areaBrList.slice(0, 6).map((b: any) => (
                              <div key={b.id} className="flex items-center justify-between text-[11px] text-gh-muted">
                                <span>{b.name}</span>
                                <span className="font-mono text-gh-faint">{b.code}</span>
                              </div>
                            ))}
                            {areaBrList.length > 6 && (
                              <p className="text-[10px] text-gh-faint">+{areaBrList.length - 6} more branches</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 4: CHECKLIST TEMPLATES                                           */}
      {/* ==================================================================== */}
      {activeTab === "checklists" && isSuper && (
        <div className="space-y-4">
          <p className="text-sm text-gh-muted">
            Master checklist templates that dictate questions, evidence requirements, and compliance scoring on mobile.
          </p>
          <Card className="overflow-hidden">
            {checklistsQ.isLoading ? (
              <Spinner />
            ) : (
              <Table headers={["Template Name", "Version", "Sections", "Total Checkpoints", "Status", "Actions"]}>
                {(checklistsQ.data ?? []).map((t: any) => {
                  const itemCount = (t.sections ?? []).reduce((acc: number, s: any) => acc + (s.items?.length ?? 0), 0);
                  return (
                    <tr key={t.id} className="hover:bg-white/[0.03]">
                      <td className="px-4 py-3 font-semibold text-white">{t.name}</td>
                      <td className="px-4 py-3 text-xs text-gh-muted font-mono">v{t.version}</td>
                      <td className="px-4 py-3 text-xs text-gh-muted">{t.sections?.length ?? 0}</td>
                      <td className="px-4 py-3 text-xs text-gh-muted font-bold text-[#58a6ff]">{itemCount} items</td>
                      <td className="px-4 py-3">
                        <Badge className={t.is_published ? "bg-emerald-600" : "bg-amber-600"}>
                          {t.is_published ? "Published" : "Draft"}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <a
                          href="/checklists"
                          className="px-2.5 py-1 rounded-lg bg-blue-500/10 border border-blue-500/25 text-[#58a6ff] text-xs font-semibold hover:bg-blue-500/20"
                        >
                          Open Editor →
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </Card>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 5: SECURITY AUDIT LOGS                                           */}
      {/* ==================================================================== */}
      {activeTab === "audit-logs" && isSuper && (
        <Card className="overflow-hidden">
          {auditLogsQ.isLoading ? (
            <Spinner />
          ) : (
            <Table headers={["Timestamp", "User", "Action", "Entity Type", "Entity ID", "IP Address"]}>
              {(auditLogsQ.data ?? []).map((log: any, i: number) => (
                <tr key={log.id ?? i} className="hover:bg-white/[0.03]">
                  <td className="px-4 py-3 text-xs text-gh-muted font-mono whitespace-nowrap">
                    {log.created_at ? new Date(log.created_at).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold text-white">{log.user ?? "System / Mobile"}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-500/10 border border-blue-500/20 text-[#58a6ff]">
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gh-muted">{log.entity_type}</td>
                  <td className="px-4 py-3 text-xs text-gh-faint font-mono">{log.entity_id ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-gh-faint font-mono">{log.ip_address ?? "—"}</td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}

      {/* User Create/Edit Modal */}
      {(creatingUser || editingUser) && (
        <UserFormModal
          editing={editingUser}
          onClose={() => {
            setCreatingUser(false);
            setEditingUser(null);
          }}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["settings-users"] });
          }}
        />
      )}
    </div>
  );
}
