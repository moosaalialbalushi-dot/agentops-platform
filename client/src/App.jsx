import { useState, useEffect, useCallback, useRef } from "react";

// ─── CONFIG ────────────────────────────────────────────────────────────────
// Environment variables are loaded from Vercel for security
const SUPA_URL  = import.meta.env.VITE_SUPABASE_URL || "https://dqsriohrazmlikwjwbot.supabase.co";
const SUPA_KEY  = import.meta.env.VITE_SUPABASE_KEY || "";
// ─── EDGE FUNCTION PROXY — API keys live in Supabase secrets, never in browser
const AI_PROXY_URL = `${SUPA_URL}/functions/v1/ai-proxy`;

// Validate that required environment variables are set
if (!SUPA_URL || !SUPA_KEY) {
  console.warn("⚠️ Supabase credentials not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_KEY environment variables.");
}

// ─── SUPABASE CLIENT ───────────────────────────────────────────────────────
const supa = {
  headers: { "Content-Type": "application/json", "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}` },
  async get(table, params = "") {
    const r = await fetch(`${SUPA_URL}/rest/v1/${table}?${params}`, { headers: this.headers });
    return r.json();
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

// ─── MULTI-AI ROUTER — calls Supabase Edge Function (keys stored server-side)
async function routeToAI(agent, userMessage) {
  const r = await fetch(AI_PROXY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPA_KEY,
    },
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
  if (!r.ok) throw new Error(data?.error || `Edge function error ${r.status}`);

  const { response, provider_used, model_used, fallback_triggered, latency_ms, tokens_used } = data;
  const latencyMs  = latency_ms  || 0;
  const tokensUsed = tokens_used || 0;
  const providerUsed      = provider_used;
  const modelUsed         = model_used;
  const fallbackTriggered = fallback_triggered;

  // Log run to Supabase
  await supa.post("agent_runs", {
    agent_id: agent.id,
    provider_used: providerUsed,
    model_used: modelUsed,
    prompt: userMessage.slice(0, 500),
    response: response.slice(0, 2000),
    status: "completed",
    tokens_used: tokensUsed,
    latency_ms: latencyMs,
    fallback_triggered: fallbackTriggered,
    ended_at: new Date().toISOString(),
  });

  // Update agent totals
  await supa.patch("agents", agent.id, {
    total_runs: (agent.total_runs || 0) + 1,
    total_tokens: (agent.total_tokens || 0) + tokensUsed,
    updated_at: new Date().toISOString(),
  });

  return { response, providerUsed, modelUsed, fallbackTriggered, latencyMs, tokensUsed };
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

// ─── GLOBAL STYLES ────────────────────────────────────────────────────────
const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Space+Grotesk:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:${C.bg}}
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:${C.border};border-radius:2px}
.app{min-height:100vh;display:flex;font-family:'Space Grotesk',sans-serif;font-size:13px;color:${C.text};background:${C.bg};position:relative}
/* Nebula bg */
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
/* Main */
.main{flex:1;display:flex;flex-direction:column;min-height:100vh;position:relative;z-index:1;overflow:hidden}
.topbar{height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 28px;border-bottom:1px solid ${C.border};background:rgba(10,13,22,0.9);backdrop-filter:blur(12px);flex-shrink:0}
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
.card-glow{background:${C.card};border:1px solid rgba(99,102,241,0.2);border-radius:11px;box-shadow:0 0 0 1px rgba(99,102,241,0.05),inset 0 1px 0 rgba(255,255,255,0.04)}
/* Stats */
.stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px}
.stat-card{padding:18px 20px;border-radius:11px;background:${C.card};border:1px solid ${C.border};position:relative;overflow:hidden;transition:transform 0.2s,border-color 0.2s}
.stat-card:hover{transform:translateY(-2px);border-color:${C.borderHi}}
.stat-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:var(--c);opacity:0.8}
.stat-label{font-size:10px;color:${C.muted};letter-spacing:0.1em;text-transform:uppercase;margin-bottom:9px}
.stat-val{font-family:'Syne',sans-serif;font-size:27px;font-weight:800;letter-spacing:-0.03em;line-height:1}
.stat-sub{font-size:11px;color:${C.muted};margin-top:6px}
.stat-delta{display:inline-flex;align-items:center;gap:3px;font-size:10px;padding:2px 7px;border-radius:4px;margin-top:5px;background:var(--c-bg);color:var(--c)}
/* Agent card */
.agent-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:13px}
.agent-card{padding:20px;border-radius:11px;background:${C.card};border:1px solid ${C.border};position:relative;overflow:hidden;transition:all 0.2s;cursor:default}
.agent-card::after{content:'';position:absolute;top:-20px;right:-20px;width:80px;height:80px;border-radius:50%;background:radial-gradient(circle,var(--pc) 0%,transparent 70%);opacity:0.08;pointer-events:none}
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
.skill-card:hover{transform:translateY(-1px);box-shadow:0 6px 24px rgba(0,0,0,0.3)}
/* Toggle switch */
.toggle{width:36px;height:20px;border-radius:10px;cursor:pointer;transition:background 0.2s;position:relative;flex-shrink:0}
.toggle-knob{width:14px;height:14px;border-radius:50%;background:#fff;position:absolute;top:3px;transition:left 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.4)}
/* Form */
.form-group{margin-bottom:15px}
.form-label{font-size:10px;letter-spacing:0.1em;color:${C.muted};text-transform:uppercase;display:block;margin-bottom:6px;font-weight:600}
.form-input{background:${C.surface};border:1px solid ${C.border};border-radius:7px;color:${C.text};font-family:'Space Grotesk',sans-serif;font-size:13px;padding:9px 12px;width:100%;outline:none;transition:all 0.18s}
.form-input:focus{border-color:${C.accent};box-shadow:0 0 0 3px rgba(99,102,241,0.12)}
.form-input::placeholder{color:${C.dim}}
textarea.form-input{min-height:72px;resize:vertical;font-family:'JetBrains Mono',monospace;font-size:12px}
select.form-input option{background:${C.card}}
/* Tabs */
.tabs{display:flex;gap:2px;background:rgba(255,255,255,0.04);border-radius:8px;padding:3px}
.tab{background:none;border:none;font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:600;cursor:pointer;padding:6px 14px;border-radius:6px;color:${C.muted};transition:all 0.15s;letter-spacing:0.04em}
.tab.active{background:${C.card};color:${C.text};box-shadow:0 1px 4px rgba(0,0,0,0.3)}
/* Modal */
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,0.75);backdrop-filter:blur(8px);z-index:100;display:flex;align-items:center;justify-content:center;animation:fadein 0.15s}
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
.chat-input:focus{border-color:${C.accent}}
/* Run log */
.run-log{background:${C.surface};border:1px solid ${C.border};border-radius:9px;overflow:hidden}
.run-row{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid rgba(26,32,53,0.6);font-size:11px;transition:background 0.15s}
.run-row:last-child{border-bottom:none}
.run-row:hover{background:rgba(255,255,255,0.02)}
/* Provider router */
.router-card{padding:20px;border-radius:11px;background:${C.card};border:1px solid ${C.border}}
.provider-flow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.pf-node{padding:10px 16px;border-radius:8px;border:1px solid;text-align:center;min-width:90px}
.pf-arrow{color:${C.dim};font-size:16px}
/* Status bar */
.status-bar{padding:3px 14px;font-size:10px;letter-spacing:0.08em;display:inline-flex;align-items:center;gap:5px;border-radius:5px}
/* Activity log */
.act-log{background:${C.surface};border:1px solid ${C.border};border-radius:9px;padding:14px;font-size:11px;color:${C.muted};height:180px;overflow-y:auto;font-family:'JetBrains Mono',monospace}
.log-line{display:flex;gap:10px;padding:1px 0}
/* Loading spinner */
.spin{display:inline-block;width:14px;height:14px;border:2px solid rgba(99,102,241,0.3);border-top-color:${C.accent};border-radius:50%;animation:spin 0.7s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
/* Slide in */
.slide-in{animation:slidein 0.25s ease}
/* Table */
.data-table{width:100%;border-collapse:collapse}
.data-table th{font-size:10px;letter-spacing:0.1em;color:${C.muted};text-transform:uppercase;padding:9px 14px;text-align:left;border-bottom:1px solid ${C.border};font-weight:600}
.data-table td{padding:11px 14px;border-bottom:1px solid rgba(26,32,53,0.5);font-size:12px;vertical-align:middle}
.data-table tr:last-child td{border-bottom:none}
.data-table tr:hover td{background:rgba(255,255,255,0.02)}
/* Donut */
.donut-wrap{position:relative;display:inline-flex;align-items:center;justify-content:center}
.donut-inner{position:absolute;display:flex;flex-direction:column;align-items:center;justify-content:center}
/* Schema */
.schema-table{background:${C.card};border:1px solid ${C.border};border-radius:10px;overflow:hidden}
.schema-hdr{padding:11px 16px;background:rgba(99,102,241,0.08);border-bottom:1px solid ${C.border};display:flex;align-items:center;gap:8px}
.schema-row{padding:8px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid rgba(26,32,53,0.4);font-size:11px}
.schema-row:last-child{border-bottom:none}
/* Step builder */
.step-rail{display:flex;flex-direction:column;gap:4px}
.step-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;cursor:pointer;border:1px solid transparent;transition:all 0.18s}
.step-item.done{border-color:rgba(16,185,129,0.25);background:rgba(16,185,129,0.06)}
.step-item.active{border-color:rgba(99,102,241,0.3);background:rgba(99,102,241,0.1)}
.step-item.pending{opacity:0.45}
.step-num{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0}
.step-num.done{background:${C.green};color:#fff}
.step-num.active{background:linear-gradient(135deg,${C.accent},${C.purple});color:#fff}
.step-num.pending{background:${C.dim};color:${C.muted}}
.prog-bar{height:2px;background:${C.border};border-radius:2px;overflow:hidden;margin-bottom:20px}
.prog-fill{height:100%;background:linear-gradient(90deg,${C.accent},${C.purple},${C.cyan});border-radius:2px;transition:width 0.4s cubic-bezier(0.4,0,0.2,1)}
/* Divider */
hr.div{border:none;border-top:1px solid ${C.border};margin:18px 0}
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
  const p = PROVIDERS[name] || { label: name, color: C.muted, logo: "?" };
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
  const health = agents.length ? Math.round(active/agents.length*100) : 0;
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
        {/* Recent runs */}
        <div className="card" style={{ padding:18 }}>
          <div className="section-title">◎ Recent Runs <span className="sec-badge">{recent.length} latest</span></div>
          <div className="run-log">
            {recent.length === 0
              ? <div style={{ color:C.dim, textAlign:"center", padding:"24px 0", fontSize:12 }}>No runs yet — chat with an agent to start</div>
              : recent.map(r => {
                const agent = agents.find(a=>a.id===r.agent_id);
                const p = PERSONAS[agent?.persona];
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

        {/* Agent quick-launch */}
        <div className="card" style={{ padding:18 }}>
          <div className="section-title">⬡ Quick Launch</div>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {agents.filter(a=>a.status==="active").map(agent => {
              const p = PERSONAS[agent.persona];
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

      {/* Provider distribution */}
      <div className="card" style={{ padding:18 }}>
        <div className="section-title">◈ Provider Distribution</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
          {Object.entries(PROVIDERS).map(([key, prov]) => {
            const count = agents.filter(a => a.primary_provider===key).length;
            const fallback = agents.filter(a => a.fallback_provider===key).length;
            const runCount = runs.filter(r => r.provider_used===key).length;
            return (
              <div key={key} style={{ padding:"14px 16px", background:C.surface, borderRadius:9, border:`1px solid ${C.border}`, borderLeft:`3px solid ${prov.color}` }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                  <span style={{ fontSize:18, color:prov.color }}>{prov.logo}</span>
                  <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:13 }}>{prov.label}</span>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:6, textAlign:"center" }}>
                  <div><div style={{ fontSize:16, fontWeight:700, color:prov.color }}>{count}</div><div style={{ fontSize:9, color:C.muted }}>PRIMARY</div></div>
                  <div><div style={{ fontSize:16, fontWeight:700, color:C.muted }}>{fallback}</div><div style={{ fontSize:9, color:C.muted }}>FALLBACK</div></div>
                  <div><div style={{ fontSize:16, fontWeight:700, color:C.cyan }}>{runCount}</div><div style={{ fontSize:9, color:C.muted }}>RUNS</div></div>
                </div>
              </div>
            );
          })}
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
    primary_model:"claude-sonnet-4-6", fallback_model:"gemini-2.0-flash",
    system_prompt:"You are a helpful AI agent.", temperature:0.7, max_tokens:4096,
    total_runs:0, total_tokens:0,
  };

  const save = async (d) => {
    if (!d.name.trim()) return;
    setSaving(true);
    try {
      if (modal.mode === "add") {
        const [created] = await supa.post("agents", d);
        setAgents(a => [...a, created]);
      } else {
        const [updated] = await supa.patch("agents", d.id, d);
        setAgents(a => a.map(x => x.id === d.id ? updated : x));
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
                    {agent.fallback_provider && <>→ <ProviderBadge name={agent.fallback_provider} /></>}
                  </div>
                </div>
                <div style={{ display:"flex", gap:3 }}>
                  <button className="icon-btn" title="Chat" onClick={() => onChat(agent)} style={{ color:C.accent }}>💬</button>
                  <button className="icon-btn" title="Edit" onClick={() => setModal({ mode:"edit", data:{ ...agent } })}>✎</button>
                  <button className="icon-btn" title="Delete" onClick={() => setDel(agent)} style={{ color:C.dim }}>⊗</button>
                </div>
              </div>
              <p style={{ color:C.muted, fontSize:12, lineHeight:1.65, marginBottom:12, minHeight:36 }}>{agent.description}</p>
              <div style={{ display:"flex", flexWrap:"wrap", gap:5, marginBottom:4 }}>
                {agentSkills.map(s => (
                  <span key={s.id} className="chip" style={{ background: (CAT_COLORS[s.category]||C.muted)+"15", color: CAT_COLORS[s.category]||C.muted, border:`1px solid ${(CAT_COLORS[s.category]||C.muted)}28` }}>
                    {s.name}
                  </span>
                ))}
                {agentSkills.length === 0 && <span style={{ color:C.dim, fontSize:11 }}>no skills assigned</span>}
              </div>
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
          <p style={{ color:C.muted, marginBottom:20, lineHeight:1.7 }}>
            Remove <span style={{ color:C.red }}>{del.name}</span>? All associated run history will remain in the database.
          </p>
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
  const p = PERSONAS[d.persona] || PERSONAS.researcher;

  const CLAUDE_MODELS  = ["claude-opus-4-6","claude-sonnet-4-6","claude-haiku-4-5"];
  const GEMINI_MODELS  = ["gemini-2.0-flash","gemini-2.0-pro","gemini-1.5-flash"];
  const DEEPSEEK_MODELS = ["deepseek-chat","deepseek-coder","deepseek-reasoner"];
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

      {/* Multi-AI Routing */}
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
            <select className="form-input" value={d.fallback_provider||""} onChange={e => { set("fallback_provider",e.target.value); set("fallback_model", modelsFor(e.target.value)[0]); }}>
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
        <div style={{ marginTop:10, display:"flex", gap:8, flexWrap:"wrap" }}>
          <ProviderBadge name={d.primary_provider} />
          <span style={{ color:C.dim }}>primary</span>
          {d.fallback_provider && <><span style={{ color:C.dim }}>·</span><ProviderBadge name={d.fallback_provider} /><span style={{ color:C.dim }}>fallback</span></>}
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Description</label>
        <input className="form-input" value={d.description||""} onChange={e => set("description",e.target.value)} placeholder="What does this agent do?" />
      </div>
      <div className="form-group">
        <label className="form-label">System Prompt</label>
        <textarea className="form-input" value={d.system_prompt||""} onChange={e => set("system_prompt",e.target.value)} placeholder="Instructions that define this agent's personality and behavior..." />
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        <div className="form-group">
          <label className="form-label">Temperature ({d.temperature})</label>
          <input type="range" min="0" max="1" step="0.1" value={d.temperature||0.7} onChange={e => set("temperature",parseFloat(e.target.value))} style={{ width:"100%", accentColor:C.accent }} />
        </div>
        <div className="form-group">
          <label className="form-label">Max Tokens</label>
          <input className="form-input" type="number" value={d.max_tokens||4096} onChange={e => set("max_tokens",parseInt(e.target.value))} />
        </div>
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
  const [modal, setModal] = useState(null);
  const [del, setDel]     = useState(null);
  const [filter, setFilter] = useState("all");
  const [saving, setSaving] = useState(false);

  const blank = { name:"", category:"retrieval", description:"", version:"1.0.0", is_active:true, input_schema:{}, output_schema:{}, permissions:"read", rate_limit:100 };

  const save = async (d) => {
    if (!d.name.trim()) return;
    setSaving(true);
    try {
      if (modal.mode === "add") {
        const [created] = await supa.post("skills", d);
        setSkills(s => [...s, created]);
      } else {
        const [updated] = await supa.patch("skills", d.id, d);
        setSkills(s => s.map(x => x.id === d.id ? { ...updated, _agentIds: x._agentIds } : x));
      }
    } finally { setSaving(false); setModal(null); }
  };

  const doDelete = async () => {
    await supa.delete("skills", del.id);
    setSkills(s => s.filter(x => x.id !== del.id));
    setDel(null);
  };

  const toggleActive = async (skill) => {
    const [updated] = await supa.patch("skills", skill.id, { is_active: !skill.is_active });
    setSkills(s => s.map(x => x.id === skill.id ? { ...x, is_active: !x.is_active } : x));
  };

  const cats = ["all", ...Object.keys(CAT_COLORS)];
  const shown = filter === "all" ? skills : skills.filter(s => s.category === filter);

  if (loading) return <div style={{ textAlign:"center", padding:"60px 0", color:C.muted }}><Spinner /></div>;

  return (
    <div className="slide-in">
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
        <div className="tabs">
          {cats.slice(0,7).map(c => (
            <button key={c} className={`tab ${filter===c?"active":""}`} onClick={() => setFilter(c)}>
              {c === "all" ? `ALL (${skills.length})` : c.toUpperCase()}
            </button>
          ))}
        </div>
        <button className="btn btn-primary" onClick={() => setModal({ mode:"add", data:{ ...blank } })}>⊕ Register Skill</button>
      </div>
      <div className="skill-grid">
        {shown.map(skill => {
          const color = CAT_COLORS[skill.category] || C.muted;
          const usedBy = agents.filter(a => skill._agentIds?.includes(a.id));
          return (
            <div key={skill.id} className="skill-card" style={{ "--cc": color }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                <div>
                  <div style={{ fontFamily:"'Syne',sans-serif", fontSize:14, fontWeight:800, marginBottom:6 }}>{skill.name}</div>
                  <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                    <span className="chip" style={{ background:color+"15", color, border:`1px solid ${color}28`, textTransform:"uppercase", letterSpacing:"0.06em" }}>{skill.category}</span>
                    <span style={{ fontSize:10, color:C.muted, background:C.surface, padding:"2px 6px", borderRadius:4 }}>v{skill.version}</span>
                  </div>
                </div>
                <div style={{ display:"flex", gap:3, alignItems:"center" }}>
                  <Toggle on={skill.is_active} onChange={() => toggleActive(skill)} />
                  <button className="icon-btn" onClick={() => setModal({ mode:"edit", data:{ ...skill } })}>✎</button>
                  <button className="icon-btn" onClick={() => setDel(skill)} style={{ color:C.dim }}>⊗</button>
                </div>
              </div>
              <p style={{ color:C.muted, fontSize:12, lineHeight:1.65, marginBottom:12 }}>{skill.description}</p>
              <div style={{ display:"flex", flexWrap:"wrap", gap:5, paddingTop:10, borderTop:`1px solid ${C.border}` }}>
                {usedBy.length === 0
                  ? <span style={{ color:C.dim, fontSize:11 }}>unassigned</span>
                  : usedBy.map(a => {
                      const p = PERSONAS[a.persona];
                      return <span key={a.id} style={{ fontSize:10, color:p?.color, background:p?.color+"15", padding:"2px 7px", borderRadius:4 }}>{a.name}</span>;
                    })
                }
              </div>
            </div>
          );
        })}
      </div>

      {modal && <SkillModal modal={modal} onSave={save} onClose={() => setModal(null)} saving={saving} />}
      {del && (
        <Modal title="Remove Skill" onClose={() => setDel(null)}>
          <p style={{ color:C.muted, marginBottom:20, lineHeight:1.7 }}>Remove <span style={{ color:C.red }}>{del.name}</span>? Agents assigned this skill will need to be updated.</p>
          <div style={{ display:"flex", justifyContent:"flex-end", gap:10 }}>
            <button className="btn btn-ghost" onClick={() => setDel(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={doDelete}>Remove</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SkillModal({ modal, onSave, onClose, saving }) {
  const [d, setD] = useState(modal.data);
  const set = (k, v) => setD(p => ({ ...p, [k]: v }));
  return (
    <Modal title={`${modal.mode==="add"?"Register New":"Edit"} Skill`} onClose={onClose} wide>
      <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:12 }}>
        <div className="form-group" style={{ gridColumn:"span 2" }}>
          <label className="form-label">Skill Identifier</label>
          <input className="form-input" value={d.name} onChange={e => set("name",e.target.value)} placeholder="e.g. semantic_search" />
        </div>
        <div className="form-group">
          <label className="form-label">Category</label>
          <select className="form-input" value={d.category} onChange={e => set("category",e.target.value)}>
            {Object.keys(CAT_COLORS).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Version</label>
          <input className="form-input" value={d.version} onChange={e => set("version",e.target.value)} placeholder="1.0.0" />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Description</label>
        <textarea className="form-input" value={d.description||""} onChange={e => set("description",e.target.value)} placeholder="What does this skill do?" />
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        <div className="form-group">
          <label className="form-label">Permissions</label>
          <select className="form-input" value={d.permissions||"read"} onChange={e => set("permissions",e.target.value)}>
            {["read","write","admin"].map(p => <option key={p}>{p}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Rate Limit (req/min)</label>
          <input className="form-input" type="number" value={d.rate_limit||100} onChange={e => set("rate_limit",parseInt(e.target.value))} />
        </div>
      </div>
      <div style={{ display:"flex", justifyContent:"flex-end", gap:10 }}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onSave(d)} disabled={saving}>
          {saving ? <Spinner /> : "Save Skill"}
        </button>
      </div>
    </Modal>
  );
}

// ─── CHAT PAGE ─────────────────────────────────────────────────────────────
function ChatPage({ agent, agents, onSelectAgent, setAgents }) {
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const p = PERSONAS[agent?.persona] || PERSONAS.researcher;

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
        meta:`${result.providerUsed} · ${result.modelUsed} · ${result.tokensUsed}tok · ${result.latencyMs}ms${result.fallbackTriggered?" · FALLBACK":""}`
      }]);
      // Update local agent stats
      setAgents(a => a.map(x => x.id === agent.id ? {
        ...x,
        total_runs: (x.total_runs||0)+1,
        total_tokens: (x.total_tokens||0)+(result.tokensUsed||0),
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
          <div style={{ fontFamily:"'Syne',sans-serif", fontSize:14, fontWeight:800 }}>{agent?.name}</div>
          <div style={{ display:"flex", gap:6, marginTop:2 }}>
            <ProviderBadge name={agent?.primary_provider} />
            {agent?.fallback_provider && <><span style={{ color:C.dim, fontSize:10 }}>→</span><ProviderBadge name={agent.fallback_provider} /></>}
            <span style={{ fontSize:10, color:C.muted }}>· {agent?.primary_model}</span>
          </div>
        </div>
        <select className="form-input" style={{ width:"auto", fontSize:11, padding:"5px 10px" }}
          value={agent?.id} onChange={e => { const a = agents.find(x=>x.id===e.target.value); onSelectAgent(a); setMsgs([]); }}>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      <div className="chat-msgs">
        {msgs.length === 0 && (
          <div style={{ textAlign:"center", padding:"40px 20px", color:C.muted }}>
            <div style={{ fontSize:32, marginBottom:10 }}>{p.icon}</div>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:15, fontWeight:800, color:C.text, marginBottom:6 }}>{agent?.name}</div>
            <div style={{ fontSize:12, maxWidth:340, margin:"0 auto", lineHeight:1.7 }}>{agent?.description}</div>
            <div style={{ marginTop:14, display:"flex", justifyContent:"center", gap:6 }}>
              <ProviderBadge name={agent?.primary_provider} />
              {agent?.fallback_provider && <ProviderBadge name={agent.fallback_provider} />}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i}>
            <div className={`msg msg-${m.role}`}>{m.text}</div>
            {m.meta && <div className="msg-meta" style={{ justifyContent: m.role==="user"?"flex-end":"flex-start" }}>
              {m.meta.split("·").map((s,j) => <span key={j}>{s.trim()}</span>)}
            </div>}
          </div>
        ))}
        {loading && (
          <div className="msg msg-agent" style={{ display:"flex", gap:8, alignItems:"center" }}>
            <Spinner /> Routing to {agent?.primary_provider}…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-row">
        <textarea className="chat-input" rows={2} value={input} placeholder={`Message ${agent?.name}…`}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="btn btn-primary" onClick={send} disabled={loading || !input.trim()}>
          {loading ? <Spinner /> : "Send"}
        </button>
      </div>
    </div>
  );
}

// ─── RUN HISTORY ───────────────────────────────────────────────────────────
function RunsPage({ runs, agents, loading }) {
  const sorted = [...runs].sort((a,b) => new Date(b.started_at)-new Date(a.started_at));
  const totalFallbacks = runs.filter(r=>r.fallback_triggered).length;

  if (loading) return <div style={{ textAlign:"center", padding:"60px 0", color:C.muted }}><Spinner /></div>;

  return (
    <div className="slide-in">
      <div className="stat-grid" style={{ gridTemplateColumns:"repeat(3,1fr)" }}>
        {[
          { label:"Total Runs",      value: runs.length, c: C.accent },
          { label:"Fallback Triggers",value: totalFallbacks, c: C.yellow },
          { label:"Avg Latency",      value: runs.length ? Math.round(runs.reduce((s,r)=>s+(r.latency_ms||0),0)/runs.length)+"ms" : "—", c: C.cyan },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ "--c":s.c }}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-val" style={{ color:s.c }}>{s.value}</div>
          </div>
        ))}
      </div>
      <div className="card" style={{ overflow:"hidden" }}>
        <table className="data-table">
          <thead>
            <tr><th>Agent</th><th>Provider</th><th>Model</th><th>Status</th><th>Tokens</th><th>Latency</th><th>Time</th><th>Fallback</th></tr>
          </thead>
          <tbody>
            {sorted.slice(0,50).map(r => {
              const agent = agents.find(a=>a.id===r.agent_id);
              const p = PERSONAS[agent?.persona];
              return (
                <tr key={r.id}>
                  <td>
                    <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                      <span style={{ color:p?.color||C.muted }}>{p?.icon||"◎"}</span>
                      <span style={{ fontWeight:600 }}>{agent?.name||"Unknown"}</span>
                    </div>
                  </td>
                  <td><ProviderBadge name={r.provider_used} /></td>
                  <td style={{ color:C.muted, fontFamily:"'JetBrains Mono',monospace", fontSize:11 }}>{r.model_used}</td>
                  <td><span style={{ color: r.status==="completed"?C.green:C.red, fontSize:11 }}>{r.status}</span></td>
                  <td style={{ fontFamily:"'JetBrains Mono',monospace", color:C.cyan }}>{fmt(r.tokens_used||0)}</td>
                  <td style={{ fontFamily:"'JetBrains Mono',monospace", color:C.muted }}>{r.latency_ms||0}ms</td>
                  <td style={{ color:C.dim }}>{relative(r.started_at)}</td>
                  <td>{r.fallback_triggered && <span style={{ fontSize:10, color:C.yellow, background:C.yellow+"15", padding:"2px 6px", borderRadius:3 }}>YES</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {runs.length === 0 && <div style={{ textAlign:"center", padding:"32px 0", color:C.muted, fontSize:12 }}>No runs yet — chat with an agent to generate history</div>}
      </div>
    </div>
  );
}

// ─── SCHEMA PAGE ───────────────────────────────────────────────────────────
function SchemaPage() {
  const TABLES = [
    { name:"agents",        pk:"id uuid", cols:[["name","text"],["persona","text"],["primary_provider","text"],["fallback_provider","text"],["primary_model","text"],["fallback_model","text"],["status","text"],["system_prompt","text"],["total_runs","int"],["total_tokens","bigint"]], fks:["ai_providers"] },
    { name:"skills",        pk:"id uuid", cols:[["name","text"],["category","text"],["version","text"],["description","text"],["is_active","bool"],["permissions","text"],["rate_limit","int"]], fks:[] },
    { name:"agent_skills",  pk:"id uuid", cols:[["agent_id","uuid→agents"],["skill_id","uuid→skills"],["config","jsonb"]], fks:["agents","skills"] },
    { name:"ai_providers",  pk:"id uuid", cols:[["name","text"],["display_name","text"],["api_base_url","text"],["priority","int"],["is_active","bool"]], fks:[] },
    { name:"agent_runs",    pk:"id uuid", cols:[["agent_id","uuid→agents"],["provider_used","text"],["model_used","text"],["tokens_used","int"],["latency_ms","int"],["fallback_triggered","bool"],["status","text"]], fks:["agents"] },
    { name:"skill_versions",pk:"id uuid", cols:[["skill_id","uuid→skills"],["version","text"],["changelog","text"],["schema_snapshot","jsonb"]], fks:["skills"] },
  ];
  const typeColor = t => t==="uuid"?C.green:t==="bool"?C.yellow:t==="jsonb"?C.orange:t.includes("int")||t.includes("num")?C.accent:t.includes("→")?C.yellow:C.muted;

  return (
    <div className="slide-in">
      <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:9, padding:"11px 16px", marginBottom:18, display:"flex", gap:14, alignItems:"center", fontSize:11, flexWrap:"wrap" }}>
        <span style={{ color:C.green, display:"flex", alignItems:"center", gap:5 }}><span style={{ width:7,height:7,borderRadius:"50%",background:C.green,boxShadow:`0 0 6px ${C.green}`,display:"inline-block" }} />db.dqsriohrazmlikwjwbot.supabase.co</span>
        <span style={{ color:C.muted }}>·</span><span style={{ color:C.accent }}>schema: public</span>
        <span style={{ color:C.muted }}>·</span><span style={{ color:C.muted }}>Postgres 17 · RLS enabled</span>
        <span style={{ color:C.muted }}>·</span><span style={{ color:C.muted }}>{TABLES.length} tables · region: ap-south-1</span>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:13 }}>
        {TABLES.map(t => (
          <div key={t.name} className="schema-table">
            <div className="schema-hdr">
              <span style={{ color:C.accent, fontSize:15 }}>▦</span>
              <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:13 }}>{t.name}</span>
              {t.fks.length > 0 && <span style={{ marginLeft:"auto", fontSize:9, color:C.yellow, background:C.yellow+"15", padding:"1px 6px", borderRadius:3, border:`1px solid ${C.yellow}25` }}>FK→{t.fks.join(", ")}</span>}
            </div>
            <div className="schema-row" style={{ background:C.green+"06" }}>
              <span style={{ color:C.green, fontSize:10 }}>🗝</span>
              <span style={{ flex:1, fontFamily:"'JetBrains Mono',monospace", fontSize:11 }}>id</span>
              <span style={{ fontSize:9, color:C.green, background:C.green+"15", padding:"1px 5px", borderRadius:3 }}>PK</span>
              <span style={{ color:C.green, fontSize:10, fontFamily:"'JetBrains Mono',monospace" }}>uuid</span>
            </div>
            {t.cols.map(([name, type], i) => (
              <div key={i} className="schema-row">
                <span style={{ color:C.dim, fontSize:10 }}>·</span>
                <span style={{ flex:1, fontFamily:"'JetBrains Mono',monospace", fontSize:11 }}>{name}</span>
                {type.includes("→") && <span style={{ fontSize:9, color:C.yellow, background:C.yellow+"12", padding:"1px 5px", borderRadius:3, border:`1px solid ${C.yellow}20` }}>FK</span>}
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:typeColor(type) }}>{type}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="card" style={{ padding:18, marginTop:13 }}>
        <div className="section-title">◈ Applied Indexes <span className="sec-badge">Postgres best practices</span></div>
        <div style={{ background:C.surface, borderRadius:8, padding:"12px 16px", fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:"#6ee7b7", lineHeight:2.2, border:`1px solid ${C.border}` }}>
          {[
            "idx_agents_status              ON agents(status)",
            "idx_agents_primary_provider    ON agents(primary_provider)",
            "idx_agent_skills_agent         ON agent_skills(agent_id)",
            "idx_agent_skills_skill         ON agent_skills(skill_id)",
            "idx_agent_runs_agent_started   ON agent_runs(agent_id, started_at DESC)",
            "idx_skills_category_active     ON skills(category) WHERE is_active = true",
          ].map((l,i) => <div key={i}><span style={{ color:C.accent }}>CREATE INDEX IF NOT EXISTS</span> {l};</div>)}
        </div>
      </div>
    </div>
  );
}

// ─── SETTINGS PAGE ────────────────────────────────────────────────────────
function SettingsPage() {
  const [status, setStatus] = useState(null);
  const [testing, setTesting] = useState(false);
  const [keys, setKeys] = useState({ CLAUDE_API_KEY:"", GEMINI_API_KEY:"", DEEPSEEK_API_KEY:"" });

  const PROVIDER_META = {
    CLAUDE_API_KEY:   { label:"Claude (Anthropic)", logo:"◆", color:"#d97706", placeholder:"sk-ant-api03-...", required:true,  getUrl:"console.anthropic.com → API Keys" },
    GEMINI_API_KEY:   { label:"Google Gemini",      logo:"✦", color:"#4285f4", placeholder:"AIza...",          required:false, getUrl:"aistudio.google.com/apikey" },
    DEEPSEEK_API_KEY: { label:"DeepSeek",           logo:"◉", color:"#10b981", placeholder:"sk-...",           required:false, getUrl:"platform.deepseek.com → API Keys" },
  };

  const testConnection = async () => {
    setTesting(true);
    setStatus(null);
    try {
      const r = await fetch(AI_PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "apikey": SUPA_KEY },
        body: JSON.stringify({
          provider: "claude",
          model: "claude-haiku-4-5",
          system_prompt: "You are a test agent.",
          message: "Reply with exactly: CONNECTION OK",
          max_tokens: 20,
        }),
      });
      const d = await r.json();
      if (d.response?.includes("CONNECTION OK") || d.response?.length > 0) {
        setStatus({ ok: true, msg: `✓ Claude is connected · ${d.latency_ms}ms · via Edge Function` });
      } else {
        setStatus({ ok: false, msg: d.error || "Unexpected response" });
      }
    } catch (e) {
      setStatus({ ok: false, msg: e.message });
    }
    setTesting(false);
  };

  return (
    <div className="slide-in" style={{ maxWidth: 680 }}>
      {/* Edge Function info banner */}
      <div style={{ background: "rgba(99,102,241,0.08)", border:`1px solid rgba(99,102,241,0.25)`, borderRadius:10, padding:"14px 18px", marginBottom:22, display:"flex", gap:14, alignItems:"flex-start" }}>
        <span style={{ fontSize:22, color:C.accent }}>⬡</span>
        <div>
          <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:14, marginBottom:5 }}>API Keys stored in Supabase Edge Function Secrets</div>
          <div style={{ color:C.muted, fontSize:12, lineHeight:1.7 }}>
            Your keys are <span style={{ color:C.green }}>never stored in the browser or in code</span>. They live encrypted in your Supabase project's Edge Function environment. The proxy endpoint is <code style={{ background:C.surface, padding:"1px 6px", borderRadius:4, fontSize:11 }}>ai-proxy</code> — all AI calls route through it.
          </div>
        </div>
      </div>

      {/* Test connection */}
      <div className="card" style={{ padding:18, marginBottom:16 }}>
        <div className="section-title">◎ Connection Test</div>
        <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
          <button className="btn btn-primary" onClick={testConnection} disabled={testing}>
            {testing ? <><Spinner /> Testing…</> : "⚡ Test Claude Connection"}
          </button>
          {status && (
            <div style={{ fontSize:12, color: status.ok ? C.green : C.red, background: (status.ok ? C.green : C.red)+"12", padding:"7px 14px", borderRadius:7, border:`1px solid ${(status.ok?C.green:C.red)}25` }}>
              {status.msg}
            </div>
          )}
        </div>
      </div>

      {/* Key entry guide */}
      <div className="card" style={{ padding:18, marginBottom:16 }}>
        <div className="section-title">⬟ Add Your API Keys to Supabase</div>
        <p style={{ color:C.muted, fontSize:12, lineHeight:1.8, marginBottom:16 }}>
          Keys are added directly in your Supabase dashboard — not here. Follow these steps:
        </p>
        <div style={{ background:C.surface, border:`1px solid ${C.border}`, borderRadius:9, padding:"14px 16px", fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:C.muted, lineHeight:2.2 }}>
          <div><span style={{ color:C.accent }}>1.</span> Go to <span style={{ color:C.text }}>supabase.com/dashboard</span></div>
          <div><span style={{ color:C.accent }}>2.</span> Open project <span style={{ color:C.text }}>moosaalialbalushi-dot's Project</span></div>
          <div><span style={{ color:C.accent }}>3.</span> Sidebar → <span style={{ color:C.text }}>Edge Functions</span></div>
          <div><span style={{ color:C.accent }}>4.</span> Click <span style={{ color:C.text }}>ai-proxy</span> → tab <span style={{ color:C.text }}>"Secrets"</span></div>
          <div><span style={{ color:C.accent }}>5.</span> Add each key below with exact name shown</div>
        </div>
      </div>

      {/* Provider cards */}
      {Object.entries(PROVIDER_META).map(([keyName, meta]) => (
        <div key={keyName} className="card" style={{ padding:18, marginBottom:12, borderLeft:`3px solid ${meta.color}` }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:12 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:20, color:meta.color }}>{meta.logo}</span>
              <div>
                <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:800, fontSize:14 }}>{meta.label}</div>
                <div style={{ fontSize:10, color:C.muted, marginTop:2 }}>
                  {meta.required ? <span style={{ color:C.yellow }}>Required for primary routing</span> : <span>Optional — used as fallback</span>}
                </div>
              </div>
            </div>
            <span style={{ fontSize:10, color:C.muted, background:C.surface, padding:"3px 9px", borderRadius:5, border:`1px solid ${C.border}`, fontFamily:"'JetBrains Mono',monospace" }}>
              {keyName}
            </span>
          </div>
          <div style={{ background:C.surface, borderRadius:8, padding:"10px 14px", fontSize:11, color:C.muted, border:`1px solid ${C.border}` }}>
            <div style={{ marginBottom:4 }}><span style={{ color:C.dim }}>Secret name:</span> <span style={{ color:meta.color, fontFamily:"'JetBrains Mono',monospace" }}>{keyName}</span></div>
            <div style={{ marginBottom:4 }}><span style={{ color:C.dim }}>Format:</span> <span style={{ color:C.muted }}>{meta.placeholder}</span></div>
            <div><span style={{ color:C.dim }}>Get it at:</span> <span style={{ color:C.accent }}>{meta.getUrl}</span></div>
          </div>
        </div>
      ))}

      {/* Edge Function URL */}
      <div className="card" style={{ padding:18 }}>
        <div className="section-title">▦ Edge Function Endpoint</div>
        <div style={{ background:C.surface, borderRadius:8, padding:"10px 14px", fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:C.green, border:`1px solid ${C.border}` }}>
          POST {AI_PROXY_URL}
        </div>
        <div style={{ fontSize:11, color:C.muted, marginTop:10, lineHeight:1.8 }}>
          The frontend never touches AI provider APIs directly. Every chat message goes through this endpoint, the key is read from Supabase secrets server-side, and only the response comes back to your browser.
        </div>
      </div>
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────
const NAV = [
  { id:"command",  icon:"◎", label:"Command Center",  group:"main" },
  { id:"agents",   icon:"⬡", label:"Agents",          group:"main" },
  { id:"skills",   icon:"◈", label:"Skills",          group:"main" },
  { id:"chat",     icon:"💬", label:"Chat",           group:"main" },
  { id:"runs",     icon:"▷", label:"Run History",    group:"data" },
  { id:"schema",   icon:"▦", label:"Database",        group:"data" },
  { id:"settings", icon:"⚙", label:"API Keys",       group:"data" },
];

export default function App() {
  const [page, setPage] = useState("command");
  const [agents, setAgents] = useState([]);
  const [skills, setSkills] = useState([]);
  const [runs,   setRuns]   = useState([]);
  const [chatAgent, setChatAgent] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load data from Supabase
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [rawAgents, rawSkills, rawLinks, rawRuns] = await Promise.all([
          supa.get("agents", "order=created_at.asc"),
          supa.get("skills", "order=name.asc"),
          supa.get("agent_skills", "select=agent_id,skill_id"),
          supa.get("agent_runs", "order=started_at.desc&limit=100"),
        ]);
        // Attach agent IDs to each skill
        const enrichedSkills = (rawSkills||[]).map(s => ({
          ...s,
          _agentIds: (rawLinks||[]).filter(l => l.skill_id === s.id).map(l => l.agent_id),
        }));
        setAgents(rawAgents||[]);
        setSkills(enrichedSkills);
        setRuns(rawRuns||[]);
        if ((rawAgents||[]).length > 0) setChatAgent(rawAgents[0]);
      } catch(e) { console.error("Load error:", e); }
      setLoading(false);
    })();
  }, []);

  // Refresh runs after chat
  const refreshRuns = async () => {
    const r = await supa.get("agent_runs", "order=started_at.desc&limit=100");
    setRuns(r||[]);
  };

  const goChat = (agent) => { setChatAgent(agent); setPage("chat"); };

  const errors = agents.filter(a=>a.status==="error").length;
  const titles = { command:"Command Center", agents:"Agent Registry", skills:"Skill Registry", chat:"Agent Chat", runs:"Run History", schema:"Database Schema", settings:"API Keys & Settings" };

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
            <div className="logo-text">
              <div className="name">AGENTOPS</div>
              <div className="ver">PLATFORM v2.0</div>
            </div>
          </div>
          <div className="nav">
            <div className="nav-group-label">Main</div>
            {groups.main.map(n => (
              <div key={n.id} className={`nav-item ${page===n.id?"active":""}`} onClick={() => setPage(n.id)}>
                <span className="nav-icon">{n.icon}</span>
                {n.label}
                {n.id==="agents" && <span className={`nav-count ${errors>0?"warn":""}`}>{errors>0?`⚠ ${errors}`:agents.length}</span>}
                {n.id==="skills" && <span className="nav-count">{skills.length}</span>}
                {n.id==="runs"   && <span className="nav-count">{runs.length}</span>}
              </div>
            ))}
            <div className="nav-group-label">Data</div>
            {groups.data.map(n => (
              <div key={n.id} className={`nav-item ${page===n.id?"active":""}`} onClick={() => setPage(n.id)}>
                <span className="nav-icon">{n.icon}</span>
                {n.label}
                {n.id==="runs" && <span className="nav-count">{runs.length}</span>}
              </div>
            ))}

            <div className="nav-group-label" style={{ marginTop:8 }}>AI Providers</div>
            {Object.entries(PROVIDERS).map(([k,v]) => (
              <div key={k} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 10px", fontSize:11, color:C.muted }}>
                <span style={{ color:v.color, fontSize:13, width:18, textAlign:"center" }}>{v.logo}</span>
                <span>{v.label}</span>
                <span style={{ marginLeft:"auto", fontSize:10, color:v.color }}>
                  {agents.filter(a=>a.primary_provider===k).length}P · {agents.filter(a=>a.fallback_provider===k).length}F
                </span>
              </div>
            ))}
          </div>
          <div className="sidebar-footer">
            <div className="sf-row"><span>Active</span><span className="sf-val" style={{ color:C.green }}>{agents.filter(a=>a.status==="active").length}</span></div>
            <div className="sf-row"><span>Runs total</span><span className="sf-val">{agents.reduce((s,a)=>s+(a.total_runs||0),0).toLocaleString()}</span></div>
            <div className="sf-row"><span>DB</span><span className="sf-val" style={{ color:C.green }}>● Live</span></div>
          </div>
        </div>

        {/* ── MAIN ── */}
        <div className="main">
          <div className="topbar">
            <div className="topbar-left">
              <div className="page-title">{titles[page]}</div>
              <div className="breadcrumb">/ {page}</div>
            </div>
            <div className="topbar-right">
              {loading && <Spinner />}
              <div style={{ display:"flex", alignItems:"center", gap:5, background:C.surface, border:`1px solid ${C.border}`, borderRadius:6, padding:"5px 11px", fontSize:11, color:C.muted }}>
                <span style={{ width:7,height:7,borderRadius:"50%",background:C.green,boxShadow:`0 0 6px ${C.green}`,display:"inline-block" }} />
                Supabase · Live
              </div>
              <button className="btn btn-ghost btn-sm" onClick={async () => {
                setLoading(true);
                const [a, r] = await Promise.all([
                  supa.get("agents","order=created_at.asc"),
                  supa.get("agent_runs","order=started_at.desc&limit=100"),
                ]);
                setAgents(a||[]); setRuns(r||[]);
                setLoading(false);
              }}>⟳ Refresh</button>
            </div>
          </div>

          {page !== "chat" && <div className="content">
            {page==="command" && <CommandCenter agents={agents} skills={skills} runs={runs} onChat={goChat} />}
            {page==="agents"  && <AgentsPage agents={agents} setAgents={setAgents} skills={skills} onChat={goChat} loading={loading} />}
            {page==="skills"  && <SkillsPage skills={skills} setSkills={setSkills} agents={agents} loading={loading} />}
            {page==="runs"    && <RunsPage runs={runs} agents={agents} loading={loading} />}
            {page==="schema"  && <SchemaPage />}
            {page==="settings"&& <SettingsPage />}
          </div>}

          {page === "chat" && chatAgent && (
            <ChatPage
              agent={chatAgent}
              agents={agents}
              onSelectAgent={a => { setChatAgent(a); }}
              setAgents={setAgents}
            />
          )}
        </div>
      </div>
    </>
  );
}
