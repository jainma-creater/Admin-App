"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api, getErrorMessage } from "@/lib/api";
import { Card, Badge, Button, Input, Select, Table, Spinner, EmptyState } from "@/components/ui";

function CreateTemplateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [version, setVersion] = useState("1.0");
  const [visitTypeId, setVisitTypeId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const visitTypes = useQuery({ queryKey: ["visit-types"], queryFn: async () => (await api.get("/checklists/visit-types")).data });

  const createMut = useMutation({
    mutationFn: async () =>
      (await api.post("/checklists/templates", { name, version, visit_type_id: visitTypeId || null, sections: [] })).data,
    onSuccess: () => { onCreated(); onClose(); },
    onError: async (e: any) => setError(await getErrorMessage(e)),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gh-panel border border-gh-border rounded-xl p-6 w-full max-w-md">
        <h2 className="text-lg font-bold mb-4">New Checklist Template</h2>
        {error && <p className="text-[#f85149] text-sm mb-3">{error}</p>}
        <div className="space-y-3">
          <Input label="Template Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Branch Visit Checklist" />
          <Input label="Version" value={version} onChange={(e) => setVersion(e.target.value)} />
          <Select label="Visit Type" value={visitTypeId} onChange={(e) => setVisitTypeId(e.target.value)}>
            <option value="">None</option>
            {(visitTypes.data ?? []).map((t: any) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => createMut.mutate()} disabled={!name || createMut.isPending} className="flex-1">Create</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AddSectionModal({ templateId, onClose, onAdded }: { templateId: string; onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addSectionMut = useMutation({
    mutationFn: async () =>
      (await api.post(`/checklists/templates/${templateId}/sections`, { name, sort_order: 99, items: [] })).data,
    onSuccess: () => { onAdded(); onClose(); },
    onError: async (e: any) => setError(await getErrorMessage(e)),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gh-panel border border-gh-border rounded-xl p-6 w-full max-w-md">
        <h2 className="text-lg font-bold mb-4">Add Section</h2>
        {error && <p className="text-[#f85149] text-sm mb-3">{error}</p>}
        <Input label="Section Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Signage & Branding" />
        <div className="flex gap-3 pt-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => addSectionMut.mutate()} disabled={!name || addSectionMut.isPending} className="flex-1">
            {addSectionMut.isPending ? "Adding..." : "Add Section"}
          </Button>
        </div>
      </div>
    </div>
  );
}

const ROLE_OPTIONS = ["ADMIN", "HR", "OPS", "OTHERS"];

function AddItemModal({ sectionId, sectionName, onClose, onAdded }: { sectionId: string; sectionName: string; onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [roleTags, setRoleTags] = useState<string[]>([]);
  const [photoAllowed, setPhotoAllowed] = useState(true);
  const [isRequired, setIsRequired] = useState(true);
  const [sampleRefs, setSampleRefs] = useState("");
  const [error, setError] = useState<string | null>(null);

  const toggleRole = (tag: string) =>
    setRoleTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));

  const addItemMut = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/checklists/sections/${sectionId}/items`, {
          name,
          description: description || null,
          response_type: "STATUS",
          options: [],
          photo_allowed: photoAllowed,
          role_tags: roleTags,
          sample_refs: sampleRefs.split(",").map((s) => s.trim()).filter(Boolean),
          is_required: isRequired,
          weight: 1,
          sort_order: 99,
        })
      ).data,
    onSuccess: () => { onAdded(); onClose(); },
    onError: async (e: any) => setError(await getErrorMessage(e)),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gh-panel border border-gh-border rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold mb-1">Add Checkpoint</h2>
        <p className="text-xs text-gh-faint mb-4">Section: <span className="font-medium text-gh-muted">{sectionName}</span></p>
        {error && <p className="text-[#f85149] text-sm mb-3">{error}</p>}
        <div className="space-y-3">
          <Input label="Checkpoint Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Franchise Signage Board" />
          <Input label="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div>
            <p className="text-xs font-semibold text-gh-muted uppercase tracking-wide mb-2">
              Visible To Roles <span className="normal-case font-normal text-gh-faint">(blank = everyone)</span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              {ROLE_OPTIONS.map((tag) => {
                const checked = roleTags.includes(tag);
                return (
                  <label
                    key={tag}
                    className={`flex items-center gap-2 border rounded-lg px-3 py-2 cursor-pointer text-sm ${
                      checked ? "border-[#2f81f7] bg-[#2f81f7]/10 text-[#58a6ff]" : "border-gh-border text-gh-muted hover:bg-white/[0.05]"
                    }`}
                  >
                    <input type="checkbox" className="accent-[#58a6ff]" checked={checked} onChange={() => toggleRole(tag)} />
                    {tag}
                  </label>
                );
              })}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gh-text cursor-pointer">
            <input type="checkbox" className="accent-[#58a6ff]" checked={photoAllowed} onChange={(e) => setPhotoAllowed(e.target.checked)} />
            Photo evidence allowed
          </label>
          <label className="flex items-center gap-2 text-sm text-gh-text cursor-pointer">
            <input type="checkbox" className="accent-[#58a6ff]" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} />
            Required checkpoint
          </label>
          <Input label="Sample photos (filename(s), comma-separated)" value={sampleRefs} onChange={(e) => setSampleRefs(e.target.value)} placeholder="e.g. notice-board.pdf, ujjain-asset.pdf" />
          <div className="flex gap-3 pt-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => addItemMut.mutate()} disabled={!name || addItemMut.isPending} className="flex-1">
              {addItemMut.isPending ? "Adding..." : "Add Checkpoint"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ChecklistsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [openTemplate, setOpenTemplate] = useState<string | null>(null);
  const [sectionTarget, setSectionTarget] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["templates"],
    queryFn: async () => (await api.get("/checklists/templates")).data,
  });

  const publishMut = useMutation({
    mutationFn: async ({ id, is_published }: { id: string; is_published: boolean }) =>
      (await api.patch(`/checklists/templates/${id}`, { is_published })).data,
    onSuccess: () => refetch(),
    onError: async (e: any) => alert(await getErrorMessage(e)),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Checklist Management</h1>
        <Button onClick={() => setShowCreate(true)}>+ New Template</Button>
      </div>

      {isLoading ? <Spinner /> : (
        <Card>
          <Table headers={["Template", "Version", "Sections", "Items", "Status", ""]}>
            {(data ?? []).length === 0 && (
              <tr><td colSpan={6}><EmptyState message="No templates yet." /></td></tr>
            )}
            {(data ?? []).map((t: any) => {
              const itemCount = (t.sections ?? []).reduce((acc: number, s: any) => acc + (s.items?.length ?? 0), 0);
              return (
                <tr key={t.id} className="hover:bg-white/[0.04]">
                  <td className="px-4 py-3 font-medium">{t.name}</td>
                  <td className="px-4 py-3 text-gh-muted">v{t.version}</td>
                  <td className="px-4 py-3 text-gh-muted">{t.sections?.length ?? 0}</td>
                  <td className="px-4 py-3 text-gh-muted">{itemCount}</td>
                  <td className="px-4 py-3">
                    {t.is_published ? <Badge className="bg-emerald-500">Published</Badge> : <Badge className="bg-amber-500">Draft</Badge>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Button variant="ghost" onClick={() => setSectionTarget(t.id)}>+ Section</Button>
                    <Button variant="ghost" onClick={() => setOpenTemplate(openTemplate === t.id ? null : t.id)}>
                      {openTemplate === t.id ? "Hide" : "View"}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => publishMut.mutate({ id: t.id, is_published: !t.is_published })}
                      disabled={publishMut.isPending}
                    >
                      {t.is_published ? "Unpublish" : "Publish"}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}

      {openTemplate && (
        <TemplateDetail
          templateId={openTemplate}
          onClose={() => setOpenTemplate(null)}
          onChanged={() => refetch()}
        />
      )}

      {showCreate && (
        <CreateTemplateModal onClose={() => setShowCreate(false)} onCreated={() => refetch()} />
      )}

      {sectionTarget && (
        <AddSectionModal
          templateId={sectionTarget}
          onClose={() => setSectionTarget(null)}
          onAdded={() => refetch()}
        />
      )}
    </div>
  );
}

function TemplateDetail({ templateId, onClose, onChanged }: { templateId: string; onClose: () => void; onChanged: () => void }) {
  const [sectionTarget, setSectionTarget] = useState(false);
  const [itemTarget, setItemTarget] = useState<string | null>(null);

  const { data: template, isLoading, refetch } = useQuery({
    queryKey: ["template", templateId],
    queryFn: async () => (await api.get(`/checklists/templates/${templateId}`)).data,
  });

  if (isLoading) return <Spinner />;
  if (!template) return null;

  const itemCount = (template.sections ?? []).reduce((acc: number, s: any) => acc + (s.items?.length ?? 0), 0);
  const targetSection = itemTarget ? (template.sections ?? []).find((s: any) => s.id === itemTarget) : null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
<div className="bg-gh-panel border border-gh-border rounded-xl w-full max-w-3xl max-h-[85vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">{template.name} <span className="text-gh-faint text-sm">v{template.version}</span></h2>
          <button onClick={onClose} className="text-gh-faint hover:text-gh-muted">✕</button>
        </div>
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-gh-muted">{itemCount} checkpoints across {template.sections?.length ?? 0} sections</p>
          <Button variant="secondary" onClick={() => setSectionTarget(true)}>+ Section</Button>
        </div>
        <div className="space-y-4">
          {(template.sections ?? []).map((s: any) => (
            <Card key={s.id} className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-semibold">{s.name}</h4>
                <Button variant="ghost" onClick={() => setItemTarget(s.id)}>+ Checkpoint</Button>
              </div>
              <div className="space-y-2">
                {(s.items ?? []).map((i: any) => (
                  <div key={i.id} className="flex items-center justify-between bg-white/[0.04] rounded-lg px-3 py-2">
                    <div>
                      <p className="text-sm">{i.name}</p>
                      {(i.role_tags ?? []).length > 0 && (
                        <p className="text-[10px] text-gh-faint mt-0.5">Roles: {(i.role_tags ?? []).join(", ")}</p>
                      )}
                    </div>
                    <span className="text-xs text-gh-faint">{i.response_type} · photo:{i.photo_allowed ? "✓" : "✕"}{i.sample_refs?.length ? ` · samples:${i.sample_refs.length}` : ""}</span>
                  </div>
                ))}
                {!s.items?.length && <p className="text-xs text-gh-faint">No checkpoints in this section.</p>}
              </div>
            </Card>
          ))}
          {!template.sections?.length && <EmptyState message="No sections yet. Add a section to start building this checklist." />}
        </div>
      </div>

      {sectionTarget && (
        <AddSectionModal
          templateId={templateId}
          onClose={() => setSectionTarget(false)}
          onAdded={() => refetch()}
        />
      )}

      {itemTarget && targetSection && (
        <AddItemModal
          sectionId={targetSection.id}
          sectionName={targetSection.name}
          onClose={() => setItemTarget(null)}
          onAdded={() => refetch()}
        />
      )}
    </div>
  );
}