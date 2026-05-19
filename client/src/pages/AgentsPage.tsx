import React, { useState, useRef } from "react";
import { C, PERSONAS, PROVIDERS, MODELS_BY_PROVIDER, CAT_COLORS } from "../lib/constants";
import { fmt, downloadJSON } from "../lib/utils";
import { db, Agent, Skill } from "../lib/supabase";
import { Modal } from "../components/ui/AgentOpsModal";
import { Spinner } from "../components/ui/AgentOpsSpinner";
import { ProviderBadge } from "../components/ui/AgentOpsProviderBadge";
import { PromptEnhancer } from "../components/ui/AgentOpsPromptEnhancer";

interface AgentsPageProps {
  agents: Agent[];
  setAgents: React.Dispatch<React.SetStateAction<Agent[]>>;
  skills: Skill[];
  onChat: (agent: Agent) => void;
  loading: boolean;
}

export function AgentsPage({ agents, setAgents, skills, onChat, loading }: AgentsPageProps) {
  const [modal, setModal] = useState<{ mode: "add" | "edit"; data: Partial<Agent> } | null>(null);
  const [del, setDel] = useState<Agent | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const blankAgent: Partial<Agent> = {
    name: "", persona: "researcher", description: "", status: "idle",
    primary_provider: "claude", fallback_provider: "gemini",
    provider_chain: ["claude", "gemini"],
    primary_model: "claude-3-5-sonnet-latest", fallback_model: "gemini-1.5-flash",
    system_prompt: "You are a helpful AI agent. When asked to produce reports, analyses, or documents, output the complete final document in a single response — do not ask clarifying questions or provide partial drafts. Format output clearly with headings and sections.", temperature: 0.7, max_tokens: 4096,
    total_runs: 0, total_tokens: 0,
  };

  const save = async (d: Partial<Agent>) => {
    if (!d.name?.trim()) return;
    setSaving(true);
    try {
      if (modal?.mode === "add") {
        const { data: item, error } = await db.agents.create(d);
        if (error) {
          console.error("[AgentOps] Failed to create agent:", error);
          alert("Failed to create agent: " + error.message);
          return;
        }
        if (item) setAgents(a => [...a, item]);
      } else if (d.id) {
        const { data: item, error } = await db.agents.update(d.id, d);
        if (error) {
          console.error("[AgentOps] Failed to update agent:", error);
          alert("Failed to update agent: " + error.message);
          return;
        }
        if (item) setAgents(a => a.map(x => x.id === d.id ? item : x));
      }
      setModal(null);
    } catch (err: any) {
      console.error("[AgentOps] Unexpected error saving agent:", err);
      alert("Unexpected error: " + err.message);
    } finally { setSaving(false); }
  };

  const doDelete = async () => {
    if (!del) return;
    const { error } = await db.agents.remove(del.id);
    if (error) {
      console.error("[AgentOps] Failed to delete agent:", error);
      alert("Failed to delete agent: " + error.message);
      return;
    }
    setAgents(a => a.filter(x => x.id !== del.id));
    setDel(null);
  };

  const exportAgents = () => downloadJSON(agents, `agents-export-${Date.now()}.json`);

  const importAgents = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          const { id, created_at, updated_at, total_runs, total_tokens, ...rest } = item;
          const { data: newItem } = await db.agents.create({ ...rest, total_runs: 0, total_tokens: 0 });
          if (newItem) setAgents(a => [...a, newItem]);
        }
      } catch (err: any) { alert("Import failed: " + err.message); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const filtered = agents.filter(a => !search || a.name?.toLowerCase().includes(search.toLowerCase()));

  if (loading) return <div style={{ textAlign: "center", padding: "60px 0", color: C.muted }}><Spinner /></div>;

  return (
    <div className="slide-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <input className="form-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search agents…" style={{ width: 200, padding: "6px 10px" }} />
          <div style={{ display: "flex", gap: 8, fontSize: 11, color: C.muted }}>
            {["active", "idle", "error"].map(s => (
              <span key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span className={`status-dot ${s}`} /> {agents.filter(a => a.status === s).length} {s}
              </span>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input ref={fileInputRef} type="file" accept=".json" style={{ display: "none" }} onChange={importAgents} />
          <button className="btn btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()}>⊕ Import</button>
          <button className="btn btn-ghost btn-sm" onClick={exportAgents}>↓ Export</button>
          <button className="btn btn-primary" onClick={() => setModal({ mode: "add", data: { ...blankAgent } })}>⊕ Deploy Agent</button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">⬡</div>
          <div className="empty-text">No agents yet.<br />Deploy your first agent to get started.</div>
        </div>
      ) : (
        <div className="agent-grid">
          {filtered.map(agent => {
            const p = (PERSONAS as any)[agent.persona] || PERSONAS.researcher;
            return (
              <div key={agent.id} className="agent-card" style={{ "--pc": p.color } as React.CSSProperties}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 9 }}>
                  <div>
                    <div className="persona-badge" style={{ background: p.color + "15", color: p.color, border: `1px solid ${p.color}28` }}>
                      {p.icon} {p.label}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                      <span className={`status-dot ${agent.status}`} />
                      <span style={{ fontFamily: "'Syne',sans-serif", fontSize: 14, fontWeight: 800 }}>{agent.name}</span>
                    </div>
                    <div style={{ marginTop: 4, display: "flex", gap: 5, flexWrap: "wrap" }}>
                      <ProviderBadge name={agent.primary_provider} />
                      {agent.fallback_provider && <span style={{ fontSize: 10, color: C.muted }}>→</span>}
                      {agent.fallback_provider && <ProviderBadge name={agent.fallback_provider} />}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 2 }}>
                    <button className="icon-btn" title="Chat" onClick={() => onChat(agent)} style={{ color: C.accent }}>💬</button>
                    <button className="icon-btn" title="Edit" onClick={() => setModal({ mode: "edit", data: { ...agent } })}>✎</button>
                    <button className="icon-btn" title="Delete" onClick={() => setDel(agent)} style={{ color: C.dim }}>⊗</button>
                  </div>
                </div>
                <p style={{ color: C.muted, fontSize: 11.5, lineHeight: 1.65, marginBottom: 10, minHeight: 32 }}>{agent.description}</p>
                <div className="metric-row">
                  <div className="metric-box"><div className="m-val" style={{ color: p.color }}>{(agent.total_runs || 0).toLocaleString()}</div><div className="m-lbl">RUNS</div></div>
                  <div className="metric-box"><div className="m-val" style={{ color: C.cyan }}>{fmt(agent.total_tokens || 0)}</div><div className="m-lbl">TOKENS</div></div>
                  <div className="metric-box"><div className="m-val" style={{ color: C.purple }}>{Array.isArray(agent.skill_ids) ? agent.skill_ids.length : 0}</div><div className="m-lbl">SKILLS</div></div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && <AgentModal modal={modal} onSave={save} onClose={() => setModal(null)} saving={saving} skills={skills} />}
      {del && (
        <Modal title="Decommission Agent" onClose={() => setDel(null)}>
          <p style={{ color: C.muted, marginBottom: 18 }}>Remove agent <span style={{ color: C.red }}>{del.name}</span>? This cannot be undone.</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 9 }}>
            <button className="btn btn-ghost" onClick={() => setDel(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={doDelete}>Decommission</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

interface AgentModalProps {
  modal: { mode: "add" | "edit"; data: Partial<Agent> };
  onSave: (data: Partial<Agent>) => void;
  onClose: () => void;
  saving: boolean;
  skills?: Skill[];
}

function AgentModal({ modal, onSave, onClose, saving, skills = [] }: AgentModalProps) {
  const [d, setD] = useState<Partial<Agent>>({ ...modal.data, skill_ids: modal.data.skill_ids || [] });
  const [chain, setChain] = useState<string[]>(d.provider_chain || [d.primary_provider || "claude", d.fallback_provider].filter(Boolean) as string[]);
  const set = (k: string, v: any) => setD(p => ({ ...p, [k]: v }));

  const toggleSkill = (skillId: string) => {
    setD(p => {
      const ids = Array.isArray(p.skill_ids) ? p.skill_ids : [];
      return { ...p, skill_ids: ids.includes(skillId) ? ids.filter(x => x !== skillId) : [...ids, skillId] };
    });
  };

  const moveUp = (i: number) => { if (i === 0) return; const c = [...chain]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; setChain(c); updateChain(c); };
  const moveDown = (i: number) => { if (i === chain.length - 1) return; const c = [...chain]; [c[i], c[i + 1]] = [c[i + 1], c[i]]; setChain(c); updateChain(c); };
  const addProvider = (prov: string) => { if (!chain.includes(prov)) { const c = [...chain, prov]; setChain(c); updateChain(c); } };
  const removeProvider = (i: number) => { if (chain.length <= 1) return; const c = chain.filter((_, idx) => idx !== i); setChain(c); updateChain(c); };
  const updateChain = (c: string[]) => {
    setD(p => ({
      ...p, provider_chain: c, primary_provider: c[0], primary_model: (MODELS_BY_PROVIDER as any)[c[0]]?.[0] || p.primary_model,
      fallback_provider: c[1] || null, fallback_model: c[1] ? (MODELS_BY_PROVIDER as any)[c[1]]?.[0] || "" : null
    }));
  };

  const priorityLabels = ["PRIMARY", "FALLBACK", "TERTIARY", "QUATERNARY"];

  return (
    <Modal title={`${modal.mode === "add" ? "Deploy New" : "Edit"} Agent`} onClose={onClose} wide>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="form-group" style={{ gridColumn: "span 2" }}>
          <label className="form-label">Agent Name</label>
          <input className="form-input" value={d.name || ""} onChange={e => set("name", e.target.value)} placeholder="e.g. NexusResearch" autoFocus />
        </div>
        <div className="form-group">
          <label className="form-label">Persona</label>
          <select className="form-input" value={d.persona || "researcher"} onChange={e => set("persona", e.target.value)}>
            {Object.entries(PERSONAS).map(([k, v]) => <option key={k} value={k}>{(v as any).icon} {(v as any).label}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Status</label>
          <select className="form-input" value={d.status || "idle"} onChange={e => set("status", e.target.value)}>
            {["active", "idle", "error", "archived"].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="provider-routing">
        <div className="routing-title">⬡ AI Provider Chain — drag to reorder priority</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {chain.map((prov, i) => {
            const p = (PROVIDERS as any)[prov] || { label: prov, color: C.muted, logo: "?" };
            return (
              <div key={prov + i} className="provider-slot">
                <span className="drag-handle">⠿</span>
                <span style={{ color: p.color, fontSize: 14 }}>{p.logo}</span>
                <span style={{ flex: 1, fontWeight: 600, fontSize: 12 }}>{p.label}</span>
                <span className="priority-badge" style={{ background: p.color + "18", color: p.color }}>{priorityLabels[i] || `#${i + 1}`}</span>
                <select className="form-input" style={{ width: 200, padding: "4px 8px", fontSize: 11 }}
                  value={i === 0 ? d.primary_model : d.fallback_model || ""}
                  onChange={e => set(i === 0 ? "primary_model" : "fallback_model", e.target.value)}>
                  {((MODELS_BY_PROVIDER as any)[prov] || ["custom"]).map((m: string) => <option key={m} value={m}>{m}</option>)}
                </select>
                {prov === "openrouter" && (
                  <span style={{ fontSize: 10, color: C.green, background: C.green + "15", padding: "2px 7px", borderRadius: 5, whiteSpace: "nowrap" }}>
                    ✓ FREE
                  </span>
                )}
                <div className="order-controls">
                  <button className="order-btn" onClick={() => moveUp(i)} disabled={i === 0}>▲</button>
                  <button className="order-btn" onClick={() => moveDown(i)} disabled={i === chain.length - 1}>▼</button>
                </div>
                {chain.length > 1 && <button className="icon-btn" onClick={() => removeProvider(i)} style={{ color: C.dim, fontSize: 12 }}>✕</button>}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 9, display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>Add provider:</span>
          {Object.entries(PROVIDERS).filter(([k]) => !chain.includes(k)).map(([k, p]) => (
            <button key={k} className="btn btn-ghost btn-xs" style={{ color: (p as any).color, borderColor: (p as any).color + "30" }} onClick={() => addProvider(k)}>
              {(p as any).logo} {(p as any).label}
            </button>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Description</label>
        <input className="form-input" value={d.description || ""} onChange={e => set("description", e.target.value)} placeholder="What does this agent do?" />
      </div>
      <div className="form-group">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
          <label className="form-label" style={{ marginBottom: 0 }}>System Prompt</label>
          <PromptEnhancer value={d.system_prompt || ""} onChange={v => set("system_prompt", v)} context="agent system prompt" />
        </div>
        <textarea className="form-input" value={d.system_prompt || ""} onChange={e => set("system_prompt", e.target.value)} placeholder="Instructions that define this agent's behavior..." rows={4} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Temperature (0-2)</label>
          <input className="form-input" type="number" min="0" max="2" step="0.1" value={d.temperature || 0.7} onChange={e => set("temperature", parseFloat(e.target.value))} />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">Max Tokens
            <span title="Vercel has a 60s timeout. Safe range: 1000–4096. Above 6000 may cause 504 timeout errors on Vercel Hobby plan."
              style={{ marginLeft: 6, color: C.muted, fontSize: 10, cursor: "help" }}>ⓘ</span>
          </label>
          <input className="form-input" type="number" min="100" max="8000" step="100" value={d.max_tokens || 4096} onChange={e => set("max_tokens", parseInt(e.target.value))} />
          {(d.max_tokens || 4096) > 5000 && (
            <div style={{ fontSize: 10, color: "#d97706", marginTop: 3 }}>
              ⚠ Above 5000 may cause 504 timeout on Vercel Hobby. Use 4096 for reliable results.
            </div>
          )}
        </div>
      </div>

      {skills.length > 0 && (
        <div className="provider-routing" style={{ marginTop: 13 }}>
          <div className="routing-title">◈ Assign Skills — select capabilities this agent can use</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {skills.map(skill => {
              const cc = (CAT_COLORS as any)[skill.category] || CAT_COLORS.general;
              const selected = (Array.isArray(d.skill_ids) ? d.skill_ids : []).includes(skill.id);
              return (
                <button key={skill.id} onClick={() => toggleSkill(skill.id)}
                  className="btn btn-xs"
                  style={{
                    background: selected ? cc + "22" : "transparent",
                    color: selected ? cc : C.muted,
                    border: `1px solid ${selected ? cc : C.border}`,
                    opacity: skill.is_active === false ? 0.45 : 1,
                  }}
                  title={skill.description || skill.identifier}>
                  {selected ? "✓ " : ""}{skill.name}
                </button>
              );
            })}
          </div>
          {(Array.isArray(d.skill_ids) ? d.skill_ids : []).length > 0 && (
            <div style={{ fontSize: 10, color: C.muted, marginTop: 7 }}>
              {(Array.isArray(d.skill_ids) ? d.skill_ids : []).length} skill{(Array.isArray(d.skill_ids) ? d.skill_ids : []).length !== 1 ? "s" : ""} assigned — these will be included in the agent's context during chat
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, marginTop: 16 }}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onSave({ ...d, provider_chain: chain })} disabled={saving}>
          {saving ? <Spinner /> : modal.mode === "add" ? "Deploy Agent" : "Save Changes"}
        </button>
      </div>
    </Modal>
  );
}
