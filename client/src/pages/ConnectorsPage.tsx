import React, { useState } from "react";
import { C } from "../lib/constants";
import { relative } from "../lib/utils";
import { db } from "../lib/supabase";
import { Modal } from "../components/ui/AgentOpsModal";
import { Spinner } from "../components/ui/AgentOpsSpinner";

const CONNECTOR_TYPES = {
  email: { label: "Email", color: "#4285f4", icon: "✉", fields: [{ k: "smtp_host", l: "SMTP Host" }, { k: "username", l: "Username" }, { k: "password", l: "Password / App Key", secret: true }, { k: "from_name", l: "From Name" }] },
  whatsapp: { label: "WhatsApp", color: "#25d366", icon: "📱", fields: [{ k: "phone_number_id", l: "Phone Number ID" }, { k: "access_token", l: "Access Token", secret: true }, { k: "verify_token", l: "Webhook Verify Token" }] },
  slack: { label: "Slack", color: "#4a154b", icon: "💬", fields: [{ k: "bot_token", l: "Bot Token", secret: true }, { k: "channel", l: "Default Channel" }] },
  webhook: { label: "Webhook", color: "#f59e0b", icon: "⚡", fields: [{ k: "url", l: "Endpoint URL" }, { k: "secret", l: "Secret / Auth Header", secret: true }, { k: "method", l: "HTTP Method (GET/POST)" }] },
  github: { label: "GitHub", color: "#6e40c9", icon: "⊕", fields: [{ k: "token", l: "Personal Access Token", secret: true }, { k: "owner", l: "Owner / Org" }, { k: "repo", l: "Repository" }] },
  googledrive: { label: "Google Drive", color: "#fbbc04", icon: "▦", fields: [{ k: "client_id", l: "Client ID" }, { k: "client_secret", l: "Client Secret", secret: true }, { k: "refresh_token", l: "Refresh Token", secret: true }] },
  telegram: { label: "Telegram", color: "#0088cc", icon: "✈", fields: [{ k: "bot_token", l: "Bot Token", secret: true }, { k: "chat_id", l: "Chat ID" }] },
  custom: { label: "Custom API", color: "#8b5cf6", icon: "✳", fields: [{ k: "url", l: "Base URL" }, { k: "api_key", l: "API Key", secret: true }, { k: "headers", l: "Extra Headers (JSON)" }] },
};

export interface Connector {
  id: string;
  name: string;
  type: string;
  status: "active" | "inactive" | "error";
  config: Record<string, string>;
  notes?: string;
  created_at: string;
}

interface ConnectorModalProps {
  modal: { mode: "add" | "edit"; data: Partial<Connector> };
  onSave: (data: Partial<Connector>) => void;
  onClose: () => void;
  saving: boolean;
}

function ConnectorModal({ modal, onSave, onClose, saving }: ConnectorModalProps) {
  const [d, setD] = useState<Partial<Connector>>(modal.data);
  const set = (k: string, v: any) => setD((p: any) => ({ ...p, [k]: v }));
  const setConf = (k: string, v: string) => setD((p: any) => ({ ...p, config: { ...(p.config || {}), [k]: v } }));
  const ct = (CONNECTOR_TYPES as any)[d.type || "webhook"] || CONNECTOR_TYPES.custom;
  return (
    <Modal title={`${modal.mode === "add" ? "New" : "Edit"} Connector`} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="form-group" style={{ gridColumn: "span 2" }}>
          <label className="form-label">Name</label>
          <input className="form-input" value={d.name || ""} onChange={e => set("name", e.target.value)} placeholder="e.g. My WhatsApp Bot" autoFocus />
        </div>
        <div className="form-group">
          <label className="form-label">Type</label>
          <select className="form-input" value={d.type || "webhook"} onChange={e => set("type", e.target.value)}>
            {Object.entries(CONNECTOR_TYPES).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Status</label>
          <select className="form-input" value={d.status || "inactive"} onChange={e => set("status", e.target.value)}>
            {["active", "inactive", "error"].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      {ct.fields.map((f: any) => (
        <div key={f.k} className="form-group">
          <label className="form-label">{f.l}</label>
          <input className="form-input" type={f.secret ? "password" : "text"}
            value={(d.config || {})[f.k] || ""} onChange={e => setConf(f.k, e.target.value)} placeholder={`Enter ${f.l}…`} />
        </div>
      ))}
      <div className="form-group">
        <label className="form-label">Notes</label>
        <textarea className="form-input" rows={2} value={d.notes || ""} onChange={e => set("notes", e.target.value)} placeholder="Purpose, linked agents, instructions…" />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 9, marginTop: 12 }}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onSave(d)} disabled={saving || !d.name?.trim()}>
          {saving ? <Spinner /> : modal.mode === "add" ? "Add Connector" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

interface ConnectorsPageProps {
  connectors: Connector[];
  setConnectors: React.Dispatch<React.SetStateAction<Connector[]>>;
  loading: boolean;
}

export function ConnectorsPage({ connectors, setConnectors, loading }: ConnectorsPageProps) {
  const [modal, setModal] = useState<{ mode: "add" | "edit"; data: Partial<Connector> } | null>(null);
  const [del, setDel] = useState<Connector | null>(null);
  const [saving, setSaving] = useState(false);
  const blank: Partial<Connector> = { name: "", type: "webhook", status: "inactive", config: {}, notes: "" };

  const save = async (d: Partial<Connector>) => {
    if (!d.name?.trim()) return;
    setSaving(true);
    try {
      if (modal?.mode === "add") {
        const { data: item } = await db.supabase.from("connectors").insert(d).select().single();
        if (item) setConnectors(p => [...p, item]);
      } else if (d.id) {
        const { data: item } = await db.supabase.from("connectors").update(d).eq("id", d.id).select().single();
        if (item) setConnectors(p => p.map(x => x.id === d.id ? item : x));
      }
    } finally { setSaving(false); setModal(null); }
  };

  const doDelete = async () => {
    if (!del) return;
    await db.supabase.from("connectors").delete().eq("id", del.id);
    setConnectors(p => p.filter(x => x.id !== del.id));
    setDel(null);
  };

  if (loading) return <div style={{ textAlign: "center", padding: "60px 0", color: C.muted }}><Spinner /></div>;

  return (
    <div className="slide-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: C.muted }}>Connect external services so agents can read, write, and act on your data.</div>
        <button className="btn btn-primary" onClick={() => setModal({ mode: "add", data: { ...blank } })}>⊕ Add Connector</button>
      </div>

      {connectors.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">⌘</div>
          <div className="empty-text">No connectors yet.<br />Add your first integration to get started.</div>
        </div>
      ) : (
        <div className="connector-grid">
          {connectors.map(c => {
            const ct = (CONNECTOR_TYPES as any)[c.type] || CONNECTOR_TYPES.custom;
            const statusColor = c.status === "active" ? C.green : c.status === "error" ? C.red : C.muted;
            return (
              <div key={c.id} className="connector-card" style={{ "--tc": ct.color } as React.CSSProperties}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div>
                    <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 3, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", background: ct.color + "18", color: ct.color, border: `1px solid ${ct.color}28`, display: "inline-flex", alignItems: "center", gap: 4, marginBottom: 6 }}>
                      {ct.icon} {ct.label}
                    </span>
                    <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 800 }}>{c.name}</div>
                  </div>
                  <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
                    <span className={`status-dot ${c.status}`} style={{ width: 7, height: 7, background: statusColor, boxShadow: c.status === "active" ? `0 0 7px ${C.green}` : undefined }} />
                    <button className="icon-btn" onClick={() => setModal({ mode: "edit", data: { ...c } })}>✎</button>
                    <button className="icon-btn" style={{ color: C.dim }} onClick={() => setDel(c)}>⊗</button>
                  </div>
                </div>
                {c.notes && <p style={{ color: C.muted, fontSize: 11, lineHeight: 1.6, marginBottom: 8 }}>{c.notes}</p>}
                <div style={{ fontSize: 10, color: C.dim }}>Added {relative(c.created_at)}</div>
              </div>
            );
          })}
        </div>
      )}

      {modal && <ConnectorModal modal={modal} onSave={save} onClose={() => setModal(null)} saving={saving} />}
      {del && (
        <Modal title="Delete Connector" onClose={() => setDel(null)}>
          <p style={{ color: C.muted, marginBottom: 18 }}>Delete connector <span style={{ color: C.red }}>{del.name}</span>?</p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 9 }}>
            <button className="btn btn-ghost" onClick={() => setDel(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={doDelete}>Delete</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
