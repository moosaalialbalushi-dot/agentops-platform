import React, { useState, useRef } from "react";
import { C, CAT_COLORS, PROVIDERS, MODELS_BY_PROVIDER } from "../lib/constants";
import { downloadJSON } from "../lib/utils";
import { db, Skill } from "../lib/supabase";
import { Modal } from "../components/ui/AgentOpsModal";
import { Spinner } from "../components/ui/AgentOpsSpinner";
import { Toggle } from "../components/ui/AgentOpsToggle";
import { PromptEnhancer } from "../components/ui/AgentOpsPromptEnhancer";

interface SkillsPageProps {
  skills: Skill[];
  setSkills: React.Dispatch<React.SetStateAction<Skill[]>>;
  loading: boolean;
}

export function SkillsPage({ skills, setSkills, loading }: SkillsPageProps) {
  const [modal, setModal] = useState<{ mode: "add" | "edit"; data: Partial<Skill> } | null>(null);
  const [del, setDel] = useState<Skill | null>(null);
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [importText, setImportText] = useState("");
  const [showImportModal, setShowImportModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const blankSkill: Partial<Skill> = {
    name: "", identifier: "", category: "retrieval", version: "1.0.0",
    description: "", permissions: "read", rate_limit: 100, is_active: true, parameters: {}, tags: [],
    output_type: "text" as any, pipeline_steps: [],
  };

  const saveSkill = async (d: Partial<Skill>) => {
    if (!d.name?.trim()) return;
    setSaving(true);
    try {
      if (modal?.mode === "add") {
        const { data: item } = await db.skills.create(d);
        if (item) setSkills(s => [...s, item]);
      } else if (d.id) {
        const { data: item } = await db.skills.update(d.id, d);
        if (item) setSkills(s => s.map(x => x.id === d.id ? item : x));
      }
    } finally { setSaving(false); setModal(null); }
  };

  const toggleActive = async (skill: Skill) => {
    const updated = { ...skill, is_active: !skill.is_active };
    await db.skills.update(skill.id, { is_active: updated.is_active });
    setSkills(s => s.map(x => x.id === skill.id ? updated : x));
  };

  const doDelete = async () => {
    if (!del) return;
    await db.skills.remove(del.id);
    setSkills(s => s.filter(x => x.id !== del.id));
    setDel(null);
  };

  const exportSkills = () => downloadJSON(skills, `skills-export-${Date.now()}.json`);

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { setImportText(ev.target?.result as string); setShowImportModal(true); };
    reader.readAsText(file);
    e.target.value = "";
  };

  const processImport = async () => {
    try {
      let data;
      try { data = JSON.parse(importText); }
      catch {
        data = [{
          name: "Imported Skill",
          identifier: "imported_skill_" + Date.now(),
          category: "general",
          description: importText.slice(0, 2000),
          version: "1.0.0", permissions: "read", rate_limit: 100, is_active: true,
        }];
      }
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const { id, created_at, ...rest } = item;
        const { data: newItem } = await db.skills.create(rest);
        if (newItem) setSkills(s => [...s, newItem]);
      }
      setShowImportModal(false);
      setImportText("");
    } catch (err: any) { alert("Import failed: " + err.message); }
  };

  const cats: string[] = Array.from(new Set(skills.map(s => (s.category || "general") as string)));
  const filtered = skills.filter(s => {
    const matchTab = tab === "all" || (tab === "active" && s.is_active) || (tab === "inactive" && !s.is_active) || s.category === tab;
    const matchSearch = !search || s.name?.toLowerCase().includes(search.toLowerCase()) || s.description?.toLowerCase().includes(search.toLowerCase());
    return matchTab && matchSearch;
  });

  if (loading) return <div style={{ textAlign: "center", padding: "60px 0", color: C.muted }}><Spinner /></div>;

  return (
    <div className="slide-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 10, flexWrap: "wrap" }}>
        <input className="form-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search skills…" style={{ width: 220, padding: "6px 10px" }} />
        <div style={{ display: "flex", gap: 7 }}>
          <input ref={fileInputRef} type="file" accept=".json,.txt,.md" style={{ display: "none" }} onChange={handleFileImport} />
          <button className="btn btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()}>⊕ Import File</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setImportText(""); setShowImportModal(true); }}>✎ Paste Import</button>
          <button className="btn btn-ghost btn-sm" onClick={exportSkills}>↓ Export JSON</button>
          <button className="btn btn-primary" onClick={() => setModal({ mode: "add", data: { ...blankSkill } })}>⊕ Register Skill</button>
        </div>
      </div>

      <div className="tabs">
        {["all", "active", "inactive", ...cats].map(t => (
          <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t} {t === "all" ? `(${skills.length})` : t === "active" ? `(${skills.filter(s => s.is_active).length})` : t === "inactive" ? `(${skills.filter(s => !s.is_active).length})` : `(${skills.filter(s => s.category === t).length})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">◈</div>
          <div className="empty-text">No skills found.<br />Register a skill or import one from a file.</div>
        </div>
      ) : (
        <div className="skill-grid">
          {filtered.map(skill => {
            const cc = (CAT_COLORS as any)[skill.category] || CAT_COLORS.general;
            return (
              <div key={skill.id} className="skill-card" style={{ "--cc": cc, opacity: skill.is_active ? 1 : .55 } as React.CSSProperties}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 7 }}>
                  <div>
                    <span className="badge" style={{ background: cc + "18", color: cc, border: `1px solid ${cc}28`, marginBottom: 6 }}>{skill.category || "general"}</span>
                    <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 800 }}>{skill.name}</div>
                    <div style={{ fontSize: 10, color: C.muted, fontFamily: "'JetBrains Mono',monospace" }}>{skill.identifier} · v{skill.version || "1.0.0"}</div>
                  </div>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <Toggle on={skill.is_active} onChange={() => toggleActive(skill)} />
                    <button className="icon-btn" onClick={() => setModal({ mode: "edit", data: { ...skill } })}>✎</button>
                    <button className="icon-btn" onClick={() => setDel(skill)} style={{ color: C.dim }}>⊗</button>
                  </div>
                </div>
                <p style={{ color: C.muted, fontSize: 11.5, lineHeight: 1.65, marginBottom: 10 }}>{skill.description || "No description"}</p>
                <div style={{ display: "flex", gap: 8, fontSize: 10, color: C.dim }}>
                  <span>🔒 {skill.permissions || "read"}</span>
                  <span>⚡ {skill.rate_limit || 100} req/min</span>
                  {skill.tags?.length > 0 && <span>🏷 {skill.tags.join(", ")}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <Modal title={`${modal.mode === "add" ? "Register New" : "Edit"} Skill`} onClose={() => setModal(null)} wide>
          <SkillForm data={modal.data} onSave={saveSkill} onClose={() => setModal(null)} saving={saving} />
        </Modal>
      )}

      {showImportModal && (
        <Modal title="Import Skills" onClose={() => setShowImportModal(false)} wide>
          <p style={{ color: C.muted, fontSize: 12, marginBottom: 12 }}>
            Paste JSON (array or single skill), a skill description in plain text, or any structured format. The system will auto-parse it.
          </p>
          <textarea className="form-input" value={importText} onChange={e => setImportText(e.target.value)}
            placeholder='[{"name":"MySkill","identifier":"my_skill","category":"retrieval","description":"..."}]'
            rows={10} style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 } as React.CSSProperties} />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, marginTop: 13 }}>
            <button className="btn btn-ghost" onClick={() => setShowImportModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={processImport} disabled={!importText.trim()}>Import Skills</button>
          </div>
        </Modal>
      )}

      {del && (
        <Modal title="Delete Skill" onClose={() => setDel(null)}>
          <p style={{ color: C.muted, marginBottom: 18 }}>Delete skill <span style={{ color: C.red }}>{del.name}</span>?</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 9 }}>
            <button className="btn btn-ghost" onClick={() => setDel(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={doDelete}>Delete</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

const OUTPUT_TYPES = ["text", "image", "presentation", "code", "analysis", "pipeline"];

function SkillForm({ data, onSave, onClose, saving }: { data: Partial<Skill>; onSave: (d: Partial<Skill>) => void; onClose: () => void; saving: boolean }) {
  const [d, setD] = useState<Partial<Skill>>({ output_type: "text" as any, pipeline_steps: [], ...data });
  const set = (k: string, v: any) => setD(p => ({ ...p, [k]: v }));

  const addStep = () => setD(p => ({
    ...p, pipeline_steps: [...(p.pipeline_steps || []), {
      label: `Step ${(p.pipeline_steps || []).length + 1}`,
      provider: "claude",
      model: "claude-sonnet-4-6",
      prompt_template: "{{input}}",
      system_prompt: "You are a helpful AI assistant.",
      max_tokens: 2048,
    }]
  }));
  const removeStep = (i: number) => setD(p => ({ ...p, pipeline_steps: (p.pipeline_steps || []).filter((_, idx) => idx !== i) }));
  const setStep = (i: number, k: string, v: any) => setD(p => ({
    ...p,
    pipeline_steps: (p.pipeline_steps || []).map((s, idx) => idx === i ? { ...s, [k]: v } : s)
  }));

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="form-group" style={{ gridColumn: "span 2" }}>
          <label className="form-label">Skill Name</label>
          <input className="form-input" value={d.name || ""} onChange={e => set("name", e.target.value)} placeholder="e.g. Semantic Search" autoFocus />
        </div>
        <div className="form-group">
          <label className="form-label">Identifier</label>
          <input className="form-input" value={d.identifier || ""} onChange={e => set("identifier", e.target.value.toLowerCase().replace(/\s+/g, "_"))} placeholder="e.g. semantic_search" />
        </div>
        <div className="form-group">
          <label className="form-label">Version</label>
          <input className="form-input" value={d.version || "1.0.0"} onChange={e => set("version", e.target.value)} placeholder="1.0.0" />
        </div>
        <div className="form-group">
          <label className="form-label">Category</label>
          <select className="form-input" value={d.category || "retrieval"} onChange={e => set("category", e.target.value)}>
            {Object.keys(CAT_COLORS).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Output Type</label>
          <select className="form-input" value={d.output_type || "text"} onChange={e => set("output_type", e.target.value)}>
            {OUTPUT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Permissions</label>
          <select className="form-input" value={d.permissions || "read"} onChange={e => set("permissions", e.target.value)}>
            {["read", "write", "execute", "admin"].map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Rate Limit (req/min)</label>
          <input className="form-input" type="number" value={d.rate_limit || 100} onChange={e => set("rate_limit", parseInt(e.target.value))} />
        </div>
        <div className="form-group" style={{ gridColumn: "span 2" }}>
          <label className="form-label">Tags (comma separated)</label>
          <input className="form-input" value={(d.tags || []).join(",")} onChange={e => set("tags", e.target.value.split(",").map(t => t.trim()).filter(Boolean))} placeholder="search, nlp, vectors" />
        </div>
      </div>
      <div className="form-group">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
          <label className="form-label" style={{ marginBottom: 0 }}>Description / Single-step Prompt</label>
          <PromptEnhancer value={d.description || ""} onChange={v => set("description", v)} context="skill description and prompt" />
        </div>
        <textarea className="form-input" value={d.description || ""} onChange={e => set("description", e.target.value)} placeholder="What does this skill do? For single-step skills this is the base prompt sent to the AI." rows={3} />
      </div>

      <div className="provider-routing">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 11 }}>
          <div className="routing-title" style={{ marginBottom: 0 }}>⬡ Pipeline Steps — chain multiple AI providers</div>
          <button className="btn btn-xs btn-ghost" onClick={addStep}>⊕ Add Step</button>
        </div>
        {(d.pipeline_steps || []).length === 0 ? (
          <div style={{ fontSize: 11, color: C.dim, textAlign: "center", padding: "10px 0" }}>
            No pipeline steps — skill runs as a single-step using the description above.
            {" "}<span style={{ color: C.accent, cursor: "pointer" }} onClick={addStep}>Add a step →</span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {(d.pipeline_steps || []).map((step, i) => {
              const pp = (PROVIDERS as any)[step.provider] || { color: C.muted, logo: "?" };
              return (
                <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "11px 13px" }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 9 }}>
                    <span style={{ color: pp.color, fontSize: 13 }}>{pp.logo}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.text }}>Step {i + 1}</span>
                    <input className="form-input" value={step.label || ""} onChange={e => setStep(i, "label", e.target.value)}
                      placeholder="Step label" style={{ flex: 1, padding: "3px 8px", fontSize: 11 }} />
                    <button className="icon-btn" style={{ color: C.red, fontSize: 11 }} onClick={() => removeStep(i)}>✕</button>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                    <div>
                      <label className="form-label">Provider</label>
                      <select className="form-input" style={{ padding: "4px 8px", fontSize: 11 }} value={step.provider || "claude"}
                        onChange={e => { setStep(i, "provider", e.target.value); setStep(i, "model", (MODELS_BY_PROVIDER as any)[e.target.value]?.[0] || ""); }}>
                        {Object.entries(PROVIDERS).map(([k, p]) => <option key={k} value={k}>{(p as any).logo} {(p as any).label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="form-label">Model</label>
                      <select className="form-input" style={{ padding: "4px 8px", fontSize: 11 }} value={step.model || ""}
                        onChange={e => setStep(i, "model", e.target.value)}>
                        {((MODELS_BY_PROVIDER as any)[step.provider] || ["custom"]).map((m: string) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="form-group" style={{ marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                      <label className="form-label" style={{ marginBottom: 0 }}>Prompt Template</label>
                      <PromptEnhancer value={step.prompt_template || ""} onChange={v => setStep(i, "prompt_template", v)} context="step prompt template" compact />
                    </div>
                    <textarea className="form-input" rows={2} value={step.prompt_template || "{{input}}"}
                      onChange={e => setStep(i, "prompt_template", e.target.value)}
                      placeholder="Use {{input}} for user input, {{prev}} for previous step output" />
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <div className="form-group" style={{ marginBottom: 0, flex: 1 }}>
                      <label className="form-label">System Prompt (optional)</label>
                      <input className="form-input" style={{ fontSize: 11 }} value={step.system_prompt || ""} onChange={e => setStep(i, "system_prompt", e.target.value)}
                        placeholder="Override system prompt for this step…" />
                    </div>
                    <div style={{ flexShrink: 0, paddingTop: 14 }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: C.muted, cursor: "pointer" }}>
                        <Toggle on={!!step.parallel} onChange={() => setStep(i, "parallel", !step.parallel)} />
                        Run in parallel
                      </label>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {(d.pipeline_steps || []).length > 0 && (
          <div style={{ fontSize: 10, color: C.muted, marginTop: 8 }}>
            Steps run in sequence by default. Toggle <strong style={{ color: C.accent }}>Run in parallel</strong> on consecutive steps to execute them simultaneously.
            Use <code style={{ color: C.accent }}>{"{{prev}}"}</code> for previous output.
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <Toggle on={d.is_active !== false} onChange={() => set("is_active", !d.is_active)} />
        <span style={{ fontSize: 12, color: C.muted }}>Skill is {d.is_active !== false ? "active" : "inactive"}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 9 }}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onSave(d)} disabled={saving}>
          {saving ? <Spinner /> : (data as any).id ? "Save Changes" : "Register Skill"}
        </button>
      </div>
    </>
  );
}

export function isSlideOutput(text = "") {
  return text.includes("\n---\n") || text.includes("\n---") || text.startsWith("---");
}

export function SlidesDeck({ text }: { text: string }) {
  const rawSlides = text.split(/\n---+\n?/).map(s => s.trim()).filter(Boolean);
  const slides = rawSlides.map(slide => {
    const lines = slide.split("\n");
    const titleLine = lines.find(l => /^#{1,3}\s/.test(l));
    const title = titleLine ? titleLine.replace(/^#{1,3}\s+/, "") : "";
    const notesIdx = lines.findIndex(l => /^notes?:/i.test(l));
    const notes = notesIdx >= 0 ? lines.slice(notesIdx).join("\n").replace(/^notes?:\s*/i, "") : "";
    const body = lines
      .filter((l, i) => l !== titleLine && (notesIdx < 0 || i < notesIdx))
      .join("\n").trim();
    return { title, body, notes };
  });

  return (
    <div className="slides-deck">
      {slides.map((slide, i) => (
        <div key={i} className="slide-card">
          <span className="slide-num">Slide {i + 1} / {slides.length}</span>
          {slide.title && <div className="slide-title">{slide.title}</div>}
          {slide.body && <div className="slide-body">{slide.body}</div>}
          {slide.notes && <div className="slide-notes">🎤 {slide.notes}</div>}
        </div>
      ))}
    </div>
  );
}
