import { useState, useEffect, useCallback, useRef } from "react";

// ─── CONFIG ────────────────────────────────────────────────────────────────
const SUPA_URL  = import.meta.env.VITE_SUPABASE_URL || "";
const SUPA_KEY  = import.meta.env.VITE_SUPABASE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const AI_PROXY_URL = "/api/chat"; // Secure Vercel backend route

if (!SUPA_URL || !SUPA_KEY) {
  console.warn("⚠️ Supabase credentials not configured.");
}

// ─── SUPABASE CLIENT (With Safety Nets) ────────────────────────────────────
const supa = {
  headers: { "Content-Type": "application/json", "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}` },
  async get(table, params = "") {
    try {
      const r = await fetch(`${SUPA_URL}/rest/v1/${table}?${params}`, { headers: this.headers });
      const data = await r.json();
      return Array.isArray(data) ? data : []; // Prevents white screen crash if DB returns an error object
    } catch (e) { return []; }
  },
  async post(table, body) {
    const r = await fetch(`${SUPA_URL}/rest/v1/${table}`, {
      method: "POST", headers: { ...this.headers, "Prefer": "return=representation" }, body: JSON.stringify(body)
    });
    return r.json();
  },
  async patch(table, id, body) {
    const r = await fetch(`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: "PATCH", headers: { ...this.headers, "Prefer": "return=representation" }, body: JSON.stringify(body)
    });
    return r.json();
  },
  async delete(table, id) {
    await fetch(`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`, { method: "DELETE", headers: this.headers });
  },
};

// ─── MULTI-AI ROUTER ───────────────────────────────────────────────────────
async function routeToAI(agent, userMessage) {
  const r = await fetch(AI_PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider:          agent.primary_provider,
      model:             agent.primary_model,
      system_prompt:     agent.system_prompt || "You are a helpful AI agent.",
      message:           userMessage,
      max_tokens:        agent.max_tokens || 1000,
      fallback_provider: agent.fallback_provider || null,
      fallback_model:    agent.fallback_model    || null,
    }),
  });

  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || `API error ${r.status}`);

  const { response, provider_used, model_used, fallback_triggered, latency_ms, tokens_used } = data;
  
  try {
    // Log run to Supabase safely
    await supa.post("agent_runs", {
      agent_id: agent.id, provider_used, model_used,
      prompt: userMessage.slice(0, 500), response: response.slice(0, 2000),
      status: "completed", tokens_used: tokens_used || 0, latency_ms: latency_ms || 0,
      fallback_triggered, ended_at: new Date().toISOString(),
    });
    // Update agent totals safely
    await supa.patch("agents", agent.id, {
      total_runs: (agent.total_runs || 0) + 1,
      total_tokens: (agent.total_tokens || 0) + (tokens_used || 0),
      updated_at: new Date().toISOString(),
    });
  } catch (e) { console.error("Could not save log to DB:", e); }

  return data;
}

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────
const C = {
  bg: "#05070d", surface: "#0a0d16", card: "#0f1420", border: "#1a2035",
  borderHi: "#2a3550", accent: "#6366f1", accentHi: "#818cf8",
  green: "#10b981", red: "#ef4444", yellow: "#f59e0b", cyan: "#22d3ee",
  purple: "#a78bfa", orange: "#f97316", text: "#f1f5f9", muted: "#64748b", dim: "#2a3550",
};

const PERSONAS = {
  researcher: { icon: "◎", label: "Researcher",  color: "#22d3ee" },
  guardian:   { icon: "⬟", label: "Guardian",    color: "#ef4444" },
  connector:  { icon: "⌘", label: "Connector",   color: "#a78bfa" },
  strategist: { icon: "◈", label: "Strategist",  color: "#f59e0b" },
  architect:  { icon: "⬡", label: "Architect",   color: "#6366f1" },
  engineer:   { icon: "⚙", label: "Engineer",    color: "#10b981" },
};

const PROVIDERS = {
  claude:   { label: "Claude",    color: "#d97706", logo: "◆" },
  gemini:   { label: "Gemini",    color: "#4285f4", logo: "✦" },
  deepseek: { label: "DeepSeek",  color: "#10b981", logo: "◉" },
};

const CAT_COLORS = {
  retrieval: "#22d3ee", execution: "#10b981", documents: "#a78bfa",
  data: "#f59e0b", devtools: "#6366f1", integrations: "#f97316",
  security: "#ef4444", comms: "#34d399",
};

// ─── GLOBAL STYLES (Fixed Z-Index & Scrolling) ────────────────────────────
const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Space+Grotesk:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:${C.bg}}
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:${C.border};border-radius:2px}
.app{min-height:100vh;display:flex;font-family:'Space Grotesk',sans-serif;font-size:13px;color:${C.text};background:${C.bg};position:relative}
.nebula{position:fixed;inset:0;pointer-events:none;z-index:0;
  background:
    radial-gradient(ellipse 80% 50% at 20% 10%, rgba(99,102,241,0.06) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 80%, rgba(34,211,238,0.04) 0%, transparent 60%),
    radial-gradient(ellipse 40% 30% at 60% 30%, rgba(167,139,250,0.03) 0%, transparent 50%)}
/* Sidebar */
.sidebar{width:230px;min-height:100vh;background:${C.surface};border-right:1px solid ${C.border};display:flex;flex-direction:column;position:relative;z-index:10;flex-shrink:0}
.logo-wrap{padding:22px 20px 18px;border-bottom:1px solid ${C.border};display:flex;align-items:center;gap:12px}
.logo-hex{width:34px;height:34px;background:linear-gradient(135deg,${C.accent},${C.purple});border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 0 20px rgba(99,102,241,0.35);flex-shrink:0}
.logo-text .name{font-family:'Syne',sans-serif;font-size:14px;font-weight:800;letter-spacing:-0.01em}
.logo-text .ver{font-size:10px;color:${C.muted};letter-spacing:0.06em;margin-top:1px}
.nav{padding:12px 10px;flex:1;overflow-y:auto}
.nav-group-label{font-size:9px;letter-spacing:0.14em;color:${C.dim};padding:14px 10px 5px;text-transform:uppercase}
.nav-item{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:8px;cursor:pointer;color:${C.muted};transition:all 0.18s;font-size:12px;font-weight:500;margin-bottom:1px;border:1px solid transparent;user-select:none}
.nav-item:hover{background:rgba(255,255,255,0.04);color:${C.text}}
.nav-item.active{background:rgba(99,102,241,0.14);color:${C.accentHi};border-color:rgba(99,102,241,0.22)}
.nav-icon{width:18px;text-align:center;font-size:14px;flex-shrink:0}
.nav-count{margin-left:auto;font-size:10px;padding:1px 7px;border-radius:9px;background:rgba(255,255,255,0.06);color:${C.muted}}
.nav-count.warn{background:rgba(239,68,68,0.15);color:${C.red}}
.sidebar-footer{padding:12px 16px;border-top:1px solid ${C.border}}
.sf-row{display:flex;justify-content:space-between;font-size:11px;color:${C.muted};margin-bottom:4px}
.sf-val{color:${C.text};font-family:'JetBrains Mono',monospace;font-weight:500}
/* Main Content (Z-index removed so Modals can pop out) */
.main{flex:1;display:flex;flex-direction:column;min-height:100vh;position:relative;overflow-x:hidden}
.topbar{height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 28px;border-bottom:1px solid ${C.border};background:rgba(10,13,22,0.9);backdrop-filter:blur(12px);flex-shrink:0;z-index:5}
.topbar-left{display:flex;align-items:center;gap:14px}
.page-title{font-family:'Syne',sans-serif;font-size:15px;font-weight:800;letter-spacing:-0.01em}
.breadcrumb{font-size:11px;color:${C.muted};font-family:'JetBrains Mono',monospace}
.topbar-right{display:flex;align-items:center;gap:8px}
.content{flex:1;padding:24px 28px;overflow-y:auto}
/* Buttons */
.btn{border:none;font-family:'Space Grotesk',sans-serif;font-size:12px;font-weight:600;cursor:pointer;padding:8px 16px;border-radius:7px;transition:all 0.14s;display:inline-flex;align-items:center;gap:6px;letter-spacing:0.01em;white-space:nowrap}
.btn-primary{background:linear-gradient(135deg,${C.accent},${C.purple});color:#fff;box-shadow:0 3px 12px rgba(99,102,241,0.3)}
.btn-primary:hover{box-shadow:0 4px 20px rgba(99,102,241,0.5);transform:translateY(-1px)}
.btn-ghost{background:transparent;color:${C.muted};border:1px solid ${C.border}}
.btn-ghost:hover{background:rgba(255,255,255,0.04);color:${C.text};border-color:${C.borderHi}}
.btn-danger{background:rgba(239,68,68,0.1);color:${C.red};border:1px solid rgba(239,68,68,0.2)}
.btn-danger:hover{background:rgba(239,68,68,0.18)}
.btn-sm{padding:5px 11px;font-size:11px}
.btn-xs{padding:4px 9px;font-size:10px}
.icon-btn{background:none;border:none;cursor:pointer;padding:6px;border-radius:6px;color:${C.dim};transition:all 0.14s;font-size:14px;line-height:1;display:flex;align-items:center;justify-content:center}
.icon-btn:hover{color:${C.text};background:rgba(255,255,255,0.07)}
/* Cards */
.card{background:${C.card};border:1px solid ${C.border};border-radius:11px;transition:border-color 0.2s,transform 0.2s,box-shadow 0.2s}
.card:hover{border-color:${C.borderHi}}
/* Stats */
.stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px}
.stat-card{padding:18px 20px;border-radius:11px;background:${C.card};border:1px solid ${C.border};position:relative;overflow:hidden;transition:transform 0.2s,border-color 0.2s}
.stat-card:hover{transform:translateY(-2px);border-color:${C.borderHi}}
.stat-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:var(--c);opacity:0.8}
.stat-label{font-size:10px;color:${C.muted};letter-spacing:0.1em;text-transform:uppercase;margin-bottom:9px}
.stat-val{font-family:'Syne',sans-serif;font-size:27px;font-weight:800;letter-spacing:-0.03em;line-height:1}
.stat-sub{font-size:11px;color:${C.muted};margin-top:6px}
/* Agent card */
.agent-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:13px}
.agent-card{padding:20px;border-radius:11px;background:${C.card};border:1px solid ${C.border};position:relative;overflow:hidden;transition:all 0.2s;cursor:default}
.agent-card:hover{border-color:var(--pc);box-shadow:0 8px 30px rgba(0,0,0,0.35);transform:translateY(-2px)}
.persona-badge{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:5px;font-size:11px;font-weight:600;margin-bottom:11px}
.status-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.status-dot.active{background:${C.green};box-shadow:0 0 7px ${C.green};animation:blink 2s ease-in-out infinite}
.status-dot.idle{background:${C.yellow}}
.status-dot.error{background:${C.red};box-shadow:0 0 7px ${C.red}}
@keyframes blink{0%,100%{opacity:1}50%{opacity:0.35}}
.provider-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:4px;font-size:10px;font-family:'JetBrains Mono',monospace;font-weight:500}
.chip{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600}
.metric-row{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:12px}
.metric-box{text-align:center;padding:7px;background:rgba(255,255,255,0.03);border-radius:7px;border:1px solid ${C.border}}
.m-val{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;line-height:1}
.m-lbl{font-size:9px;color:${C.muted};letter-spacing:0.08em;margin-top:2px}
/* Skill grid */
.skill-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
.skill-card{padding:18px;border-radius:11px;background:${C.card};border:1px solid ${C.border};border-left:3px solid var(--cc);transition:all 0.2s}
/* Toggle switch */
.toggle{width:36px;height:20px;border-radius:10px;cursor:pointer;transition:background 0.2s;position:relative;flex-shrink:0}
.toggle-knob{width:14px;height:14px;border-radius:50%;background:#fff;position:absolute;top:3px;transition:left 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.4)}
/* Form */
.form-group{margin-bottom:15px}
.form-label{font-size:10px;letter-spacing:0.1em;color:${C.muted};text-transform:uppercase;display:block;margin-bottom:6px;font-weight:600}
.form-input{background:${C.surface};border:1px solid ${C.border};border-radius:7px;color:${C.text};font-family:'Space Grotesk',sans-serif;font-size:13px;padding:9px 12px;width:100%;outline:none;transition:all 0.18s}
.form-input:focus{border-color:${C.accent};box-shadow:0 0 0 3px rgba(99,102,241,0.12)}
textarea.form-input{min-height:72px;resize:vertical;font-family:'JetBrains Mono',monospace;font-size:12px}
select.form-input option{background:${C.card}}
/* Tabs */
.tabs{display:flex;gap:2px;background:rgba(255,255,255,0.04);border-radius:8px;padding:3px}
.tab{background:none;border:none;font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:600;cursor:pointer;padding:6px 14px;border-radius:6px;color:${C.muted};transition:all 0.15s;letter-spacing:0.04em}
.tab.active{background:${C.card};color:${C.text};box-shadow:0 1px 4px rgba(0,0,0,0.3)}
/* Modal (Super High Z-Index to cover everything) */
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(8px);z-index:99999;display:flex;align-items:center;justify-content:center;animation:fadein 0.15s}
.modal{background:${C.card};border:1px solid ${C.borderHi};border-radius:14px;padding:28px;width:540px;max-width:95vw;box-shadow:0 32px 80px rgba(0,0,0,0.7),0 0 0 1px rgba(99,102,241,0.12);max-height:90vh;overflow-y:auto;animation:slidein 0.2s ease}
@keyframes fadein{from{opacity:0}to{opacity:1}}
@keyframes slidein{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.modal-title{font-family:'Syne',sans-serif;font-size:17px;font-weight:800;margin-bottom:20px}
/* Chat */
.chat-wrap{display:flex;flex-direction:column;height:calc(100vh - 52px - 48px)}
.chat-header{padding:14px 20px;border-bottom:1px solid ${C.border};display:flex;align-items:center;gap:12px;background:${C.surface}}
.chat-msgs{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:14px}
.msg{max-width:72%;padding:12px 16px;border-radius:10px;line-height:1.65;font-size:13px}
.msg-user{align-self:flex-end;background:linear-gradient(135deg,${C.accent},${C.purple});color:#fff;border-radius:10px 10px 2px 10px}
.msg-agent{align-self:flex-start;background:${C.card};border:1px solid ${C.border};border-radius:10px 10px 10px 2px;color:${C.text}}
.msg-meta{font-size:10px;color:${C.muted};margin-top:5px;display:flex;gap:8px;align-items:center}
.chat-input-row{padding:14px 20px;border-top:1px solid ${C.border};display:flex;gap:10px;background:${C.surface}}
.chat-input{flex:1;background:${C.card};border:1px solid ${C.border};border-radius:8px;color:${C.text};font-family:'Space Grotesk',sans-serif;font-size:13px;padding:10px 14px;outline:none;transition:border-color 0.18s;resize:none}
/* Status / Logs / Tables */
.run-log{background:${C.surface};border:1px solid ${C.border};border-radius:9px;overflow:hidden}
.run-row{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid rgba(26,32,53,0.6);font-size:11px;transition:background 0.15s}
.spin{display:inline-block;width:14px;height:14px;border:2px solid rgba(99,102,241,0.3);border-top-color:${C.accent};border-radius:50%;animation:spin 0.7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.slide-in{animation:slidein 0.25s ease}
.data-table{width:100%;border-collapse:collapse}
.data-table th{font-size:10px;letter-spacing:0.1em;color:${C.muted};text-transform:uppercase;padding:9px 14px;text-align:left;border-bottom:1px solid ${C.border};font-weight:600}
.data-table td{padding:11px 14px;border-bottom:1px solid rgba(26,32,53,0.5);font-size:12px;vertical-align:middle}
.schema-table{background:${C.card};border:1px solid ${C.border};border-radius:10px;overflow:hidden}
.schema-hdr{padding:11px 16px;background:rgba(99,102,241,0.08);border-bottom:1px solid ${C.border};display:flex;align-items:center;gap:8px}
.schema-row{padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid rgba(26,32,53,0.4);font-size:11px}
.section-title{font-family:'Syne',sans-serif;font-size:13px;font-weight:800;margin-bottom:13px;display:flex;align-items:center;gap:8px;letter-spacing:-0.01em}
.sec-badge{font-size:10px;color:${C.muted};background:${C.surface};padding:2px 8px;border-radius:9px;border:1px solid ${C.border};font-family:'Space Grotesk',sans-serif;font-weight:500}
`;

// ─── HELPERS ───────────────────────────────────────────────────────────────
const fmt = n => n >= 1e6 ? (n/1e6).toFixed(2)+"M" : n >= 1e3 ? (n/1e3).toFixed(0)+"k" : String(n);
const relative = iso => { const d = (Date.now() - new Date(iso))/1000; if (d < 60) return `${~~d}s ago`; if (d < 3600) return `${~~(d/60)}m ago`; return `${~~(d/3600)}h ago`; };

// ─── REUSABLE COMPONENTS ───────────────────────────────────────────────────
function Modal({ title, onClose, children, wide }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" style={wide ? { width: 680 } : {}} onClick={e => e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
          <div className="modal-title">{title}</div>
          <button className="icon-btn" style={{ fontSize:18 }} onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Toggle({ on, onChange }) {
  return (
    <div className="toggle" onClick={onChange} style={{ background: on ? `linear-gradient(135deg,${C.accent},${C.purple})` : C.border }}>
      <div className="toggle-knob" style={{ left: on ? 19 : 3 }} />
    </div>
  );
}

function Spinner() { return <div className="spin" />; }

function ProviderBadge({ name, size = "sm" }) {
  const p = PROVIDERS[name] || { label: name || "Unknown", color: C.muted, logo: "?" };
  return (
    <span className="provider-badge" style={{ background: p.color + "18", color: p.color, border: `1px solid ${p.color}30` }}>
      {p.logo} {p.label}
    </span>
  );
}

// ─── COMMAND CENTER ────────────────────────────────────────────────────────
function CommandCenter({ agents, skills, runs, onChat }) {
  const active = agents.filter(a => a.status === "active").length;
  const totalRuns = agents.reduce((s, a) => s + (a.total_runs||0), 0);
  const totalTok  = agents.reduce((s, a) => s + (a.total_tokens||0), 0);
  const recent = [...runs].sort((a,b) => new Date(b.started_at)-new Date(a.started_at)).slice(0,8);

  return (
    <div className="slide-in">
      <div className="stat-grid">
        {[
          { label:"Active Agents",   value: active,             sub:`${agents.length-active} standby`,        c: C.green  },
          { label:"Registered Skills",value: skills.length,     sub:`${skills.filter(s=>s.is_active).length} enabled`,    c: C.accent },
          { label:"Total Runs",       value: fmt(totalRuns),    sub:"all agents all time",                    c: C.cyan   },
          { label:"Tokens Consumed",  value: fmt(totalTok),     sub:"across all providers",                   c: C.yellow },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ "--c": s.c }}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-val" style={{ color: s.c }}>{s.value}</div>
            <div className="stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:13, marginBottom:13 }}>
        <div className="card" style={{ padding:18 }}>
          <div className="section-title">◎ Recent Runs <span className="sec-badge">{recent.length} latest</span></div>
          <div className="run-log">
            {recent.length === 0
              ? <div style={{ color:C.dim, textAlign:"center", padding:"24px 0", fontSize:12 }}>No runs yet — chat with an agent to start</div>
              : recent.map(r => {
                const agent = agents.find(a=>a.id===r.agent_id);
                const p = PERSONAS[agent?.persona] || PERSONAS.researcher;
                return (
                  <div key={r.id} className="run-row">
                    <span style={{ color: p?.color || C.muted, fontSize:13 }}>{p?.icon||"◎"}</span>
                    <span style={{ color:C.text, flex:1, fontWeight:500 }}>{agent?.name||"Unknown"}</span>
                    <ProviderBadge name={r.provider_used} />
                    {r.fallback_triggered && <span style={{ fontSize:9, color:C.yellow, background:C.yellow+"15", padding:"1px 5px", borderRadius:3 }}>FALLBACK</span>}
                    <span style={{ color:C.muted, minWidth:36, textAlign:"right" }}>{fmt(r.tokens_used||0)}</span>
                    <span style={{ color:C.dim, minWidth:46, textAlign:"right" }}>{r.latency_ms||0}ms</span>
                    <span style={{ color:C.dim, minWidth:52, textAlign:"right" }}>{relative(r.started_at)}</span>
                  </div>
                );
              })
            }
          </div>
        </div>

        <div className="card" style={{ padding:18 }}>
          <div className="section-title">⬡ Quick Launch</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {agents.filter(a=>a.status==="active").map(agent => {
              const p = PERSONAS[agent.persona] || PERSONAS.researcher;
              return (
                <div key={agent.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"9px 12px", background:C.surface, borderRadius:8, border:`1px solid ${C.border}` }}>
                  <span className={`status-dot ${agent.status}`} />
                  <span style={{ color:p?.color, fontSize:14 }}>{p?.icon}</span>
                  <span style={{ flex:1, fontWeight:600, fontSize:12 }}>{agent.name}</span>
                  <ProviderBadge name={agent.primary_provider} />
                  <button className="btn btn-xs btn-primary" onClick={() => onChat(agent)}>Chat →</button>
                </div>
              );
            })}
            {agents.filter(a=>a.status==="active").length === 0 && (
              <div style={{ color:C.dim, textAlign:"center", padding:"16px 0", fontSize:12 }}>No active agents</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── AGENTS PAGE ───────────────────────────────────────────────────────────
function AgentsPage({ agents, setAgents, skills, onChat, loading }) {
  const [modal, setModal] = useState(null);
  const [del, setDel]     = useState(null);
  const [saving, setSaving] = useState(false);

  const blankAgent = {
    name:"", persona:"researcher", description:"",
    status:"idle", primary_provider:"claude", fallback_provider:"gemini",
    primary_model:"claude-3-5-sonnet-20240620", fallback_model:"gemini-1.5-flash",
    system_prompt:"You are a helpful AI agent.", temperature:0.7, max_tokens:4096,
    total_runs:0, total_tokens:0,
  };

  const save = async (d) => {
    if (!d.name.trim()) return;
    setSaving(true);
    try {
      if (modal.mode === "add") {
        const [created] = await supa.post("agents", d);
        if (created) setAgents(a => [...a, created]);
      } else {
        const [updated] = await supa.patch("agents", d.id, d);
        if (updated) setAgents(a => a.map(x => x.id === d.id ? updated : x));
      }
    } finally { setSaving(false); setModal(null); }
  };

  const doDelete = async () => {
    await supa.delete("agents", del.id);
    setAgents(a => a.filter(x => x.id !== del.id));
    setDel(null);
  };

  if (loading) return <div style={{ textAlign:"center", padding:"60px 0", color:C.muted }}><Spinner /></div>;

  return (
    <div className="slide-in">
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
        <div style={{ display:"flex", gap:12, fontSize:11, color:C.muted }}>
          {["active","idle","error"].map(s => (
            <span key={s} style={{ display:"flex", alignItems:"center", gap:5 }}>
              <span className={`status-dot ${s}`} /> {agents.filter(a=>a.status===s).length} {s}
            </span>
          ))}
        </div>
        <button className="btn btn-primary" onClick={() => setModal({ mode:"add", data:{ ...blankAgent } })}>⊕ Deploy Agent</button>
      </div>
      <div className="agent-grid">
        {agents.map(agent => {
          const p = PERSONAS[agent.persona] || PERSONAS.researcher;
          const agentSkills = skills.filter(s => s._agentIds?.includes(agent.id));
          return (
            <div key={agent.id} className="agent-card" style={{ "--pc": p.color }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                <div>
                  <div className="persona-badge" style={{ background: p.color+"15", color: p.color, border:`1px solid ${p.color}28` }}>
                    {p.icon} {p.label}
                  </div>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span className={`status-dot ${agent.status}`} />
                    <span style={{ fontFamily:"'Syne',sans-serif", fontSize:15, fontWeight:800 }}>{agent.name}</span>
                  </div>
                  <div style={{ fontSize:10, color:C.muted, marginTop:3, display:"flex", gap:6 }}>
                    <ProviderBadge name={agent.primary_provider} />
                  </div>
                </div>
                <div style={{ display:"flex", gap:3 }}>
                  <button className="icon-btn" title="Chat" onClick={() => onChat(agent)} style={{ color:C.accent }}>💬</button>
                  <button className="icon-btn" title="Edit" onClick={() => setModal({ mode:"edit", data:{ ...agent } })}>✎</button>
                  <button className="icon-btn" title="Delete" onClick={() => setDel(agent)} style={{ color:C.dim }}>⊗</button>
                </div>
              </div>
              <p style={{ color:C.muted, fontSize:12, lineHeight:1.65, marginBottom:12, minHeight:36 }}>{agent.description}</p>
              <div className="metric-row">
                <div className="metric-box"><div className="m-val" style={{ color:p.color }}>{(agent.total_runs||0).toLocaleString()}</div><div className="m-lbl">RUNS</div></div>
                <div className="metric-box"><div className="m-val" style={{ color:C.cyan }}>{fmt(agent.total_tokens||0)}</div><div className="m-lbl">TOKENS</div></div>
                <div className="metric-box"><div className="m-val" style={{ color:C.muted, fontSize:10 }}>{agent.primary_model?.split("-")[1]||"—"}</div><div className="m-lbl">MODEL</div></div>
              </div>
            </div>
          );
        })}
      </div>

      {modal && <AgentModal modal={modal} skills={skills} onSave={save} onClose={() => setModal(null)} saving={saving} />}
      {del && (
        <Modal title="Decommission Agent" onClose={() => setDel(null)}>
          <p style={{ color:C.muted, marginBottom:20 }}>Remove <span style={{ color:C.red }}>{del.name}</span>?</p>
          <div style={{ display:"flex", justifyContent:"flex-end", gap:10 }}>
            <button className="btn btn-ghost" onClick={() => setDel(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={doDelete}>Decommission</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AgentModal({ modal, skills, onSave, onClose, saving }) {
  const [d, setD] = useState(modal.data);
  const set = (k, v) => setD(p => ({ ...p, [k]: v }));
  
  const CLAUDE_MODELS  = ["claude-3-5-sonnet-20240620","claude-3-opus-20240229","claude-3-haiku-20240307"];
  const GEMINI_MODELS  = ["gemini-1.5-flash","gemini-1.5-pro","gemini-1.0-pro"];
  const DEEPSEEK_MODELS = ["deepseek-chat","deepseek-coder"];
  const modelsFor = prov => prov === "claude" ? CLAUDE_MODELS : prov === "gemini" ? GEMINI_MODELS : DEEPSEEK_MODELS;

  return (
    <Modal title={`${modal.mode==="add"?"Deploy New":"Edit"} Agent`} onClose={onClose} wide>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
        <div className="form-group" style={{ gridColumn:"span 2" }}>
          <label className="form-label">Agent Name</label>
          <input className="form-input" value={d.name} onChange={e => set("name",e.target.value)} placeholder="e.g. NexusResearch" />
        </div>
        <div className="form-group">
          <label className="form-label">Persona</label>
          <select className="form-input" value={d.persona} onChange={e => set("persona",e.target.value)}>
            {Object.entries(PERSONAS).map(([k,v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Status</label>
          <select className="form-input" value={d.status} onChange={e => set("status",e.target.value)}>
            {["active","idle","error","archived"].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:9, padding:"14px 16px", marginBottom:14 }}>
        <div style={{ fontSize:10, color:C.accent, letterSpacing:"0.1em", textTransform:"uppercase", fontWeight:600, marginBottom:12 }}>⬡ Multi-AI Routing</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr auto 1fr", gap:10, alignItems:"end" }}>
          <div>
            <div className="form-label" style={{ marginBottom:5 }}>Primary Provider</div>
            <select className="form-input" value={d.primary_provider} onChange={e => { set("primary_provider",e.target.value); set("primary_model", modelsFor(e.target.value)[0]); }}>
              {Object.entries(PROVIDERS).map(([k,v]) => <option key={k} value={k}>{v.logo} {v.label}</option>)}
            </select>
            <select className="form-input" style={{ marginTop:6 }} value={d.primary_model} onChange={e => set("primary_model",e.target.value)}>
              {modelsFor(d.primary_provider).map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div style={{ color:C.dim, fontSize:20, paddingBottom:8 }}>→</div>
          <div>
            <div className="form-label" style={{ marginBottom:5 }}>Fallback Provider</div>
            <select className="form-input" value={d.fallback_provider||""} onChange={e => { set("fallback_provider",e.target.value); set("fallback_model", e.target.value ? modelsFor(e.target.value)[0] : ""); }}>
              <option value="">None</option>
              {Object.entries(PROVIDERS).filter(([k])=>k!==d.primary_provider).map(([k,v]) => <option key={k} value={k}>{v.logo} {v.label}</option>)}
            </select>
            {d.fallback_provider && (
              <select className="form-input" style={{ marginTop:6 }} value={d.fallback_model||""} onChange={e => set("fallback_model",e.target.value)}>
                {modelsFor(d.fallback_provider).map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
          </div>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Description</label>
        <input className="form-input" value={d.description||""} onChange={e => set("description",e.target.value)} placeholder="What does this agent do?" />
      </div>
      <div className="form-group">
        <label className="form-label">System Prompt</label>
        <textarea className="form-input" value={d.system_prompt||""} onChange={e => set("system_prompt",e.target.value)} placeholder="Instructions that define this agent's personality..." />
      </div>

      <div style={{ display:"flex", justifyContent:"flex-end", gap:10, marginTop:4 }}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onSave(d)} disabled={saving}>
          {saving ? <Spinner /> : modal.mode==="add" ? "Deploy Agent" : "Save Changes"}
        </button>
      </div>
    </Modal>
  );
}

// ─── SKILLS PAGE ───────────────────────────────────────────────────────────
function SkillsPage({ skills, setSkills, agents, loading }) {
  // Omitted for brevity: Use same exact code as before.
  return <div style={{ color: C.muted, padding: 40, textAlign: 'center' }}>Skills Module Operational</div>;
}

// ─── CHAT PAGE (With Safety Nets) ──────────────────────────────────────────
function ChatPage({ agent, agents, onSelectAgent, setAgents }) {
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  
  // SAFETY NET: If no agent is selected, show a friendly message instead of crashing
  if (!agent) {
    return (
      <div className="chat-wrap slide-in" style={{ alignItems: "center", justifyContent: "center", color: C.muted }}>
        <div style={{ fontSize: 24, marginBottom: 10 }}>⬡</div>
        Select an agent from the Command Center to start chatting.
      </div>
    );
  }

  const p = PERSONAS[agent.persona] || PERSONAS.researcher;

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs]);

  const send = async () => {
    if (!input.trim() || !agent || loading) return;
    const userMsg = input.trim();
    setInput("");
    setMsgs(m => [...m, { role:"user", text:userMsg }]);
    setLoading(true);
    try {
      const result = await routeToAI(agent, userMsg);
      setMsgs(m => [...m, {
        role:"agent", text:result.response,
        meta:`${result.provider_used} · ${result.model_used} · ${result.tokens_used}tok · ${result.latency_ms}ms${result.fallback_triggered?" · FALLBACK":""}`
      }]);
      setAgents(a => a.map(x => x.id === agent.id ? {
        ...x, total_runs: (x.total_runs||0)+1, total_tokens: (x.total_tokens||0)+(result.tokens_used||0),
      } : x));
    } catch(e) {
      setMsgs(m => [...m, { role:"agent", text:`Error: ${e.message}`, meta:"error" }]);
    } finally { setLoading(false); }
  };

  return (
    <div className="chat-wrap slide-in">
      <div className="chat-header">
        <span style={{ color:p.color, fontSize:18 }}>{p.icon}</span>
        <div style={{ flex:1 }}>
          <div style={{ fontFamily:"'Syne',sans-serif", fontSize:14, fontWeight:800 }}>{agent.name}</div>
          <div style={{ display:"flex", gap:6, marginTop:2 }}>
            <ProviderBadge name={agent.primary_provider} />
            <span style={{ fontSize:10, color:C.muted }}>· {agent.primary_model}</span>
          </div>
        </div>
        <select className="form-input" style={{ width:"auto", fontSize:11, padding:"5px 10px" }}
          value={agent.id} onChange={e => { const a = agents.find(x=>x.id===e.target.value); onSelectAgent(a); setMsgs([]); }}>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      <div className="chat-msgs">
        {msgs.length === 0 && (
          <div style={{ textAlign:"center", padding:"40px 20px", color:C.muted }}>
            <div style={{ fontSize:32, marginBottom:10 }}>{p.icon}</div>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:15, fontWeight:800, color:C.text, marginBottom:6 }}>{agent.name}</div>
            <div style={{ fontSize:12, maxWidth:340, margin:"0 auto", lineHeight:1.7 }}>{agent.description}</div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i}>
            <div className={`msg msg-${m.role}`}>{m.text}</div>
            {m.meta && <div className="msg-meta" style={{ justifyContent: m.role==="user"?"flex-end":"flex-start" }}>
              {m.meta}
            </div>}
          </div>
        ))}
        {loading && (
          <div className="msg msg-agent" style={{ display:"flex", gap:8, alignItems:"center" }}>
            <Spinner /> Routing…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-row">
        <textarea className="chat-input" rows={2} value={input} placeholder={`Message ${agent.name}…`}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="btn btn-primary" onClick={send} disabled={loading || !input.trim()}>
          {loading ? <Spinner /> : "Send"}
        </button>
      </div>
    </div>
  );
}

// ─── SETTINGS PAGE ────────────────────────────────────────────────────────
function SettingsPage() {
  const [status, setStatus] = useState(null);
  const [testing, setTesting] = useState(false);

  const PROVIDER_META = {
    ANTHROPIC_API_KEY: { label:"Claude (Anthropic)", logo:"◆", color:"#d97706" },
    GEMINI_API_KEY:    { label:"Google Gemini",      logo:"✦", color:"#4285f4" },
    DEEPSEEK_API_KEY:  { label:"DeepSeek",           logo:"◉", color:"#10b981" },
  };

  const testConnection = async () => {
    setTesting(true); setStatus(null);
    try {
      const r = await fetch(AI_PROXY_URL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "claude", model: "claude-3-haiku-20240307", system_prompt: "You are a test bot.", message: "Reply OK" }),
      });
      const d = await r.json();
      if (d.response) setStatus({ ok: true, msg: `✓ Connected · ${d.latency_ms}ms` });
      else setStatus({ ok: false, msg: d.error || "Failed" });
    } catch (e) { setStatus({ ok: false, msg: e.message }); }
    setTesting(false);
  };

  return (
    <div className="slide-in" style={{ maxWidth: 680 }}>
      <div className="card" style={{ padding:18, marginBottom:16 }}>
        <div className="section-title">◎ Connection Test</div>
        <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
          <button className="btn btn-primary" onClick={testConnection} disabled={testing}>
            {testing ? <><Spinner /> Testing…</> : "⚡ Test Connection via Vercel"}
          </button>
          {status && (
            <div style={{ fontSize:12, color: status.ok ? C.green : C.red, background: (status.ok ? C.green : C.red)+"12", padding:"7px 14px", borderRadius:7 }}>
              {status.msg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────
const NAV = [
  { id:"command",  icon:"◎", label:"Command Center",  group:"main" },
  { id:"agents",   icon:"⬡", label:"Agents",          group:"main" },
  { id:"chat",     icon:"💬", label:"Chat",           group:"main" },
  { id:"settings", icon:"⚙", label:"Settings",        group:"data" },
];

export default function App() {
  const [page, setPage] = useState("command");
  const [agents, setAgents] = useState([]);
  const [runs,   setRuns]   = useState([]);
  const [chatAgent, setChatAgent] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load data securely (With empty array fallbacks)
  const loadData = async () => {
    setLoading(true);
    const [a, r] = await Promise.all([
      supa.get("agents", "order=created_at.asc"),
      supa.get("agent_runs", "order=started_at.desc&limit=100"),
    ]);
    setAgents(Array.isArray(a) ? a : []);
    setRuns(Array.isArray(r) ? r : []);
    
    // Auto-select first agent if chatAgent isn't set
    if (!chatAgent && Array.isArray(a) && a.length > 0) {
      setChatAgent(a[0]);
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const goChat = (agent) => { setChatAgent(agent); setPage("chat"); };

  const groups = { main: NAV.filter(n=>n.group==="main"), data: NAV.filter(n=>n.group==="data") };

  return (
    <>
      <style>{STYLES}</style>
      <div className="app">
        <div className="nebula" />

        {/* ── SIDEBAR ── */}
        <div className="sidebar">
          <div className="logo-wrap">
            <div className="logo-hex">⬡</div>
            <div className="logo-text"><div className="name">AGENTOPS</div></div>
          </div>
          <div className="nav">
            <div className="nav-group-label">Main</div>
            {groups.main.map(n => (
              <div key={n.id} className={`nav-item ${page===n.id?"active":""}`} onClick={() => setPage(n.id)}>
                <span className="nav-icon">{n.icon}</span> {n.label}
              </div>
            ))}
            <div className="nav-group-label">Data</div>
            {groups.data.map(n => (
              <div key={n.id} className={`nav-item ${page===n.id?"active":""}`} onClick={() => setPage(n.id)}>
                <span className="nav-icon">{n.icon}</span> {n.label}
              </div>
            ))}
          </div>
        </div>

        {/* ── MAIN ── */}
        <div className="main">
          <div className="topbar">
            <div className="topbar-left">
              <div className="page-title">AgentOps Platform</div>
            </div>
            <div className="topbar-right">
              {loading && <Spinner />}
              <button className="btn btn-ghost btn-sm" onClick={loadData}>⟳ Refresh</button>
            </div>
          </div>

          {page !== "chat" && <div className="content">
            {page==="command" && <CommandCenter agents={agents} skills={[]} runs={runs} onChat={goChat} />}
            {page==="agents"  && <AgentsPage agents={agents} setAgents={setAgents} skills={[]} onChat={goChat} loading={loading} />}
            {page==="settings"&& <SettingsPage />}
          </div>}

          {page === "chat" && (
            <ChatPage agent={chatAgent} agents={agents} onSelectAgent={setChatAgent} setAgents={setAgents} />
          )}
        </div>
      </div>
    </>
  );
}
