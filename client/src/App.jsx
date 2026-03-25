import { useState, useEffect, useCallback, useRef } from "react";

// ─── CONFIG ────────────────────────────────────────────────────────────────
const SUPA_URL  = import.meta.env.VITE_SUPABASE_URL || "";
const SUPA_KEY  = import.meta.env.VITE_SUPABASE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "";
const AI_PROXY_URL = "/api/chat";

// ─── SUPABASE CLIENT ────────────────────────────────────────────────────────
const supa = {
  headers: { "Content-Type": "application/json", "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}` },
  async get(table, params = "") {
    try {
      const r = await fetch(`${SUPA_URL}/rest/v1/${table}?${params}`, { headers: this.headers });
      const data = await r.json();
      return Array.isArray(data) ? data : [];
    } catch (e) { return []; }
  },
  async post(table, body) {
    try {
      const r = await fetch(`${SUPA_URL}/rest/v1/${table}`, {
        method: "POST", headers: { ...this.headers, "Prefer": "return=representation" }, body: JSON.stringify(body)
      });
      return r.json();
    } catch (e) { return []; }
  },
  async patch(table, id, body) {
    try {
      const r = await fetch(`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`, {
        method: "PATCH", headers: { ...this.headers, "Prefer": "return=representation" }, body: JSON.stringify(body)
      });
      return r.json();
    } catch (e) { return []; }
  },
  async delete(table, id) {
    try {
      await fetch(`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`, { method: "DELETE", headers: this.headers });
    } catch (e) {}
  },
};

// ─── MULTI-AI ROUTER ───────────────────────────────────────────────────────
// history: array of past {role:"user"|"agent", text} messages (excludes current userMessage)
// agentSkills: array of skill objects attached to this agent
async function routeToAI(agent, userMessage, history = [], agentSkills = []) {
  // Build system prompt: agent's own prompt + skills context + general fallback
  let systemPrompt = agent.system_prompt || "You are a helpful AI agent.";

  // Append active skills as context if any are attached
  const activeSkills = agentSkills.filter(s => s.is_active !== false);
  if (activeSkills.length > 0) {
    const skillsContext = activeSkills.map(s =>
      `- ${s.name} (${s.identifier}): ${s.description || "No description"}`
    ).join("\n");
    systemPrompt += `\n\n## Available Skills\nYou have access to the following capabilities:\n${skillsContext}`;
  }

  // Always add general-purpose fallback so the agent never refuses off-topic questions
  systemPrompt += `\n\n## General Assistant Behavior\nYou are also a general-purpose AI assistant. If a user's question is outside your primary specialty or cannot be addressed by your defined skills, still respond helpfully using your broad knowledge. Never refuse to help just because a topic seems off-topic. If you lack a specific skill to complete a task, explain what you can do and suggest alternatives or ask the user for more context.`;

  // Build full conversation history for multi-turn chat
  const messages = [
    ...history
      .filter(m => m.role === "user" || m.role === "agent")
      .map(m => ({ role: m.role === "agent" ? "assistant" : "user", content: m.text })),
    { role: "user", content: userMessage },
  ];

  const r = await fetch(AI_PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: agent.primary_provider,
      model: agent.primary_model,
      system_prompt: systemPrompt,
      messages,           // full conversation history
      message: userMessage, // kept for backwards compat
      max_tokens: agent.max_tokens || 1000,
      temperature: agent.temperature || 0.7,
      fallback_provider: agent.fallback_provider || null,
      fallback_model: agent.fallback_model || null,
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || `API error ${r.status}`);
  const { response, provider_used, model_used, fallback_triggered, latency_ms, tokens_used } = data;
  try {
    await supa.post("agent_runs", {
      agent_id: agent.id, provider_used, model_used,
      prompt: userMessage.slice(0, 500), response: response.slice(0, 2000),
      status: "completed", tokens_used: tokens_used || 0, latency_ms: latency_ms || 0,
      fallback_triggered, ended_at: new Date().toISOString(),
    });
    await supa.patch("agents", agent.id, {
      total_runs: (agent.total_runs || 0) + 1,
      total_tokens: (agent.total_tokens || 0) + (tokens_used || 0),
      updated_at: new Date().toISOString(),
    });
  } catch (e) {}
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
  researcher: { icon: "◎", label: "Researcher", color: "#22d3ee" },
  guardian:   { icon: "⬟", label: "Guardian",   color: "#ef4444" },
  connector:  { icon: "⌘", label: "Connector",  color: "#a78bfa" },
  strategist: { icon: "◈", label: "Strategist", color: "#f59e0b" },
  architect:  { icon: "⬡", label: "Architect",  color: "#6366f1" },
  engineer:   { icon: "⚙", label: "Engineer",   color: "#10b981" },
};

const PROVIDERS = {
  claude:    { label: "Claude",    color: "#d97706", logo: "◆" },
  gemini:    { label: "Gemini",    color: "#4285f4", logo: "✦" },
  deepseek:  { label: "DeepSeek", color: "#10b981", logo: "◉" },
  openai:    { label: "OpenAI",   color: "#74aa9c", logo: "⊕" },
  mistral:   { label: "Mistral",  color: "#ff7000", logo: "◐" },
  cohere:    { label: "Cohere",   color: "#39594d", logo: "◑" },
  groq:      { label: "Groq",     color: "#f55036", logo: "◧" },
  custom:    { label: "Custom",   color: "#8b5cf6", logo: "✳" },
};

const MODELS_BY_PROVIDER = {
  claude:   ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001", "claude-3-5-sonnet-20241022", "claude-3-opus-20240229"],
  gemini:   ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.5-pro"],
  deepseek: ["deepseek-chat", "deepseek-coder", "deepseek-reasoner"],
  openai:   ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo", "o1", "o1-mini"],
  mistral:  ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest", "codestral-latest"],
  cohere:   ["command-r-plus", "command-r", "command"],
  groq:     ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
  custom:   ["custom-model"],
};

const CAT_COLORS = {
  retrieval: "#22d3ee", execution: "#10b981", documents: "#a78bfa",
  data: "#f59e0b", devtools: "#6366f1", integrations: "#f97316",
  security: "#ef4444", comms: "#34d399", analysis: "#60a5fa", general: "#94a3b8",
};

// ─── STYLES ────────────────────────────────────────────────────────────────
const STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=Space+Grotesk:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:${C.bg}}
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:${C.border};border-radius:2px}
.app{min-height:100vh;display:flex;font-family:'Space Grotesk',sans-serif;font-size:13px;color:${C.text};background:${C.bg};position:relative}
.nebula{position:fixed;inset:0;pointer-events:none;z-index:0;
  background:radial-gradient(ellipse 80% 50% at 20% 10%,rgba(99,102,241,.06) 0%,transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 80%,rgba(34,211,238,.04) 0%,transparent 60%),
    radial-gradient(ellipse 40% 30% at 60% 30%,rgba(167,139,250,.03) 0%,transparent 50%)}
.sidebar{width:240px;min-height:100vh;background:${C.surface};border-right:1px solid ${C.border};display:flex;flex-direction:column;position:relative;z-index:10;flex-shrink:0}
.logo-wrap{padding:20px 18px 16px;border-bottom:1px solid ${C.border};display:flex;align-items:center;gap:10px}
.logo-hex{width:32px;height:32px;background:linear-gradient(135deg,${C.accent},${C.purple});border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 0 18px rgba(99,102,241,.35);flex-shrink:0}
.logo-text .name{font-family:'Syne',sans-serif;font-size:13px;font-weight:800;letter-spacing:.02em}
.logo-text .ver{font-size:10px;color:${C.muted};letter-spacing:.06em;margin-top:1px}
.nav{padding:10px 8px;flex:1;overflow-y:auto}
.nav-section{font-size:9px;letter-spacing:.14em;color:${C.dim};padding:12px 10px 4px;text-transform:uppercase}
.nav-item{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:7px;cursor:pointer;color:${C.muted};transition:all .16s;font-size:12px;font-weight:500;margin-bottom:1px;border:1px solid transparent;user-select:none}
.nav-item:hover{background:rgba(255,255,255,.04);color:${C.text}}
.nav-item.active{background:rgba(99,102,241,.14);color:${C.accentHi};border-color:rgba(99,102,241,.22)}
.nav-icon{width:16px;text-align:center;font-size:13px;flex-shrink:0}
.nav-count{margin-left:auto;font-size:10px;padding:1px 6px;border-radius:9px;background:rgba(255,255,255,.06);color:${C.muted}}
.provider-row{display:flex;align-items:center;gap:8px;padding:5px 10px;font-size:11px;cursor:pointer}
.provider-dot{width:6px;height:6px;border-radius:50%}
.provider-status{font-size:9px;margin-left:auto;padding:1px 5px;border-radius:3px;font-family:'JetBrains Mono',monospace;font-weight:600}
.main{flex:1;display:flex;flex-direction:column;min-height:100vh;position:relative;overflow-x:hidden}
.topbar{height:50px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;border-bottom:1px solid ${C.border};background:rgba(10,13,22,.9);backdrop-filter:blur(12px);flex-shrink:0;z-index:5}
.page-title{font-family:'Syne',sans-serif;font-size:14px;font-weight:800;letter-spacing:-.01em}
.breadcrumb{font-size:11px;color:${C.muted};font-family:'JetBrains Mono',monospace;margin-left:8px}
.content{flex:1;padding:22px 26px;overflow-y:auto}
.btn{border:none;font-family:'Space Grotesk',sans-serif;font-size:12px;font-weight:600;cursor:pointer;padding:7px 14px;border-radius:7px;transition:all .14s;display:inline-flex;align-items:center;gap:6px;letter-spacing:.01em;white-space:nowrap}
.btn-primary{background:linear-gradient(135deg,${C.accent},${C.purple});color:#fff;box-shadow:0 3px 12px rgba(99,102,241,.28)}
.btn-primary:hover{box-shadow:0 4px 20px rgba(99,102,241,.45);transform:translateY(-1px)}
.btn-primary:disabled{opacity:.5;cursor:not-allowed;transform:none}
.btn-ghost{background:transparent;color:${C.muted};border:1px solid ${C.border}}
.btn-ghost:hover{background:rgba(255,255,255,.04);color:${C.text};border-color:${C.borderHi}}
.btn-danger{background:rgba(239,68,68,.1);color:${C.red};border:1px solid rgba(239,68,68,.2)}
.btn-danger:hover{background:rgba(239,68,68,.18)}
.btn-success{background:rgba(16,185,129,.1);color:${C.green};border:1px solid rgba(16,185,129,.2)}
.btn-success:hover{background:rgba(16,185,129,.18)}
.btn-sm{padding:5px 10px;font-size:11px}
.btn-xs{padding:3px 8px;font-size:10px}
.icon-btn{background:none;border:none;cursor:pointer;padding:5px;border-radius:6px;color:${C.dim};transition:all .14s;font-size:13px;line-height:1;display:flex;align-items:center;justify-content:center}
.icon-btn:hover{color:${C.text};background:rgba(255,255,255,.07)}
.card{background:${C.card};border:1px solid ${C.border};border-radius:11px;transition:border-color .2s}
.card:hover{border-color:${C.borderHi}}
.stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:11px;margin-bottom:20px}
.stat-card{padding:16px 18px;border-radius:11px;background:${C.card};border:1px solid ${C.border};position:relative;overflow:hidden;transition:transform .2s,border-color .2s}
.stat-card:hover{transform:translateY(-2px);border-color:${C.borderHi}}
.stat-card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:var(--c);opacity:.8}
.stat-label{font-size:10px;color:${C.muted};letter-spacing:.1em;text-transform:uppercase;margin-bottom:8px}
.stat-val{font-family:'Syne',sans-serif;font-size:26px;font-weight:800;letter-spacing:-.03em;line-height:1}
.stat-sub{font-size:11px;color:${C.muted};margin-top:5px}
.agent-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:12px}
.agent-card{padding:18px;border-radius:11px;background:${C.card};border:1px solid ${C.border};position:relative;overflow:hidden;transition:all .2s}
.agent-card:hover{border-color:var(--pc);box-shadow:0 8px 28px rgba(0,0,0,.3);transform:translateY(-2px)}
.persona-badge{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:600;margin-bottom:10px}
.status-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.status-dot.active{background:${C.green};box-shadow:0 0 7px ${C.green};animation:blink 2s ease-in-out infinite}
.status-dot.idle{background:${C.yellow}}
.status-dot.error{background:${C.red};box-shadow:0 0 7px ${C.red}}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.35}}
.provider-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:4px;font-size:10px;font-family:'JetBrains Mono',monospace;font-weight:500}
.metric-row{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-top:10px}
.metric-box{text-align:center;padding:6px;background:rgba(255,255,255,.03);border-radius:6px;border:1px solid ${C.border}}
.m-val{font-family:'Syne',sans-serif;font-size:12px;font-weight:700;line-height:1}
.m-lbl{font-size:9px;color:${C.muted};letter-spacing:.08em;margin-top:2px}
.skill-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:11px}
.skill-card{padding:16px;border-radius:10px;background:${C.card};border:1px solid ${C.border};border-left:3px solid var(--cc);transition:all .2s}
.skill-card:hover{border-color:var(--cc);transform:translateY(-1px);box-shadow:0 6px 20px rgba(0,0,0,.25)}
.toggle{width:34px;height:18px;border-radius:9px;cursor:pointer;transition:background .2s;position:relative;flex-shrink:0}
.toggle-knob{width:12px;height:12px;border-radius:50%;background:#fff;position:absolute;top:3px;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.4)}
.form-group{margin-bottom:13px}
.form-label{font-size:10px;letter-spacing:.1em;color:${C.muted};text-transform:uppercase;display:block;margin-bottom:5px;font-weight:600}
.form-input{background:${C.surface};border:1px solid ${C.border};border-radius:7px;color:${C.text};font-family:'Space Grotesk',sans-serif;font-size:13px;padding:8px 11px;width:100%;outline:none;transition:all .18s}
.form-input:focus{border-color:${C.accent};box-shadow:0 0 0 3px rgba(99,102,241,.1)}
textarea.form-input{min-height:68px;resize:vertical;font-family:'JetBrains Mono',monospace;font-size:12px;line-height:1.6}
select.form-input option{background:${C.card}}
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.75);backdrop-filter:blur(8px);z-index:99999;display:flex;align-items:center;justify-content:center;animation:fadein .15s}
.modal{background:${C.card};border:1px solid ${C.borderHi};border-radius:14px;padding:26px;width:540px;max-width:96vw;box-shadow:0 32px 80px rgba(0,0,0,.7),0 0 0 1px rgba(99,102,241,.1);max-height:92vh;overflow-y:auto;animation:slidein .2s ease}
.modal-wide{width:680px}
.modal-xl{width:820px}
@keyframes fadein{from{opacity:0}to{opacity:1}}
@keyframes slidein{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.modal-title{font-family:'Syne',sans-serif;font-size:16px;font-weight:800;margin-bottom:18px}
.chat-wrap{display:flex;flex-direction:column;height:calc(100vh - 50px)}
.chat-header{padding:12px 18px;border-bottom:1px solid ${C.border};display:flex;align-items:center;gap:10px;background:${C.surface};flex-shrink:0}
.chat-msgs{flex:1;overflow-y:auto;padding:18px;display:flex;flex-direction:column;gap:12px}
.msg{max-width:74%;padding:11px 15px;border-radius:10px;line-height:1.65;font-size:13px}
.msg-user{align-self:flex-end;background:linear-gradient(135deg,${C.accent},${C.purple});color:#fff;border-radius:10px 10px 2px 10px}
.msg-agent{align-self:flex-start;background:${C.card};border:1px solid ${C.border};border-radius:10px 10px 10px 2px;color:${C.text};white-space:pre-wrap}
.msg-meta{font-size:10px;color:${C.muted};margin-top:4px;display:flex;gap:6px;align-items:center}
.chat-input-row{padding:12px 18px;border-top:1px solid ${C.border};display:flex;gap:9px;background:${C.surface};flex-shrink:0}
.chat-input{flex:1;background:${C.card};border:1px solid ${C.border};border-radius:8px;color:${C.text};font-family:'Space Grotesk',sans-serif;font-size:13px;padding:9px 13px;outline:none;transition:border-color .18s;resize:none}
.chat-input:focus{border-color:${C.accent}}
.run-log{background:${C.surface};border:1px solid ${C.border};border-radius:9px;overflow:hidden}
.run-row{display:flex;align-items:center;gap:9px;padding:9px 13px;border-bottom:1px solid rgba(26,32,53,.6);font-size:11px;transition:background .15s}
.run-row:hover{background:rgba(255,255,255,.02)}
.spin{display:inline-block;width:14px;height:14px;border:2px solid rgba(99,102,241,.3);border-top-color:${C.accent};border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0}
@keyframes spin{to{transform:rotate(360deg)}}
.slide-in{animation:slidein .25s ease}
.section-title{font-family:'Syne',sans-serif;font-size:13px;font-weight:800;margin-bottom:12px;display:flex;align-items:center;gap:8px;letter-spacing:-.01em}
.sec-badge{font-size:10px;color:${C.muted};background:${C.surface};padding:2px 7px;border-radius:9px;border:1px solid ${C.border};font-family:'Space Grotesk',sans-serif;font-weight:500}
.provider-routing{background:${C.surface};border:1px solid ${C.border};border-radius:9px;padding:13px 15px;margin-bottom:13px}
.routing-title{font-size:10px;color:${C.accent};letter-spacing:.1em;text-transform:uppercase;font-weight:600;margin-bottom:11px;display:flex;align-items:center;gap:6px}
.provider-slot{background:${C.card};border:1px solid ${C.border};border-radius:7px;padding:10px 12px;margin-bottom:7px;display:flex;align-items:center;gap:10px;cursor:grab;user-select:none}
.provider-slot:hover{border-color:${C.borderHi}}
.drag-handle{color:${C.dim};font-size:12px;cursor:grab}
.priority-badge{font-size:9px;padding:1px 6px;border-radius:3px;font-weight:700;text-transform:uppercase;letter-spacing:.06em}
.upload-zone{border:2px dashed ${C.border};border-radius:9px;padding:28px;text-align:center;cursor:pointer;transition:all .2s;background:rgba(99,102,241,.02)}
.upload-zone:hover,.upload-zone.drag-over{border-color:${C.accent};background:rgba(99,102,241,.05)}
.upload-zone-icon{font-size:28px;margin-bottom:8px;opacity:.5}
.badge{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:600}
.table-wrap{background:${C.card};border:1px solid ${C.border};border-radius:10px;overflow:hidden}
.data-table{width:100%;border-collapse:collapse}
.data-table th{font-size:10px;letter-spacing:.09em;color:${C.muted};text-transform:uppercase;padding:9px 13px;text-align:left;border-bottom:1px solid ${C.border};font-weight:600;white-space:nowrap}
.data-table td{padding:10px 13px;border-bottom:1px solid rgba(26,32,53,.5);font-size:12px;vertical-align:middle}
.data-table tr:last-child td{border-bottom:none}
.data-table tr:hover td{background:rgba(255,255,255,.02)}
.tabs{display:flex;gap:2px;background:rgba(255,255,255,.04);border-radius:8px;padding:3px;margin-bottom:16px}
.tab{background:none;border:none;font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:600;cursor:pointer;padding:6px 13px;border-radius:6px;color:${C.muted};transition:all .15s;letter-spacing:.04em}
.tab.active{background:${C.card};color:${C.text};box-shadow:0 1px 4px rgba(0,0,0,.3)}
.key-card{background:${C.card};border:1px solid ${C.border};border-radius:10px;padding:15px 16px;margin-bottom:10px;display:flex;align-items:center;gap:12px}
.key-logo{width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}
.key-field{flex:1;background:${C.surface};border:1px solid ${C.border};border-radius:6px;color:${C.text};font-family:'JetBrains Mono',monospace;font-size:12px;padding:7px 10px;outline:none;transition:border-color .18s}
.key-field:focus{border-color:${C.accent}}
.empty-state{text-align:center;padding:52px 20px;color:${C.muted}}
.empty-icon{font-size:36px;margin-bottom:12px;opacity:.35}
.empty-text{font-size:13px;line-height:1.7}
.order-controls{display:flex;flex-direction:column;gap:3px}
.order-btn{background:none;border:1px solid ${C.border};border-radius:4px;color:${C.dim};cursor:pointer;padding:2px 6px;font-size:10px;line-height:1;transition:all .14s}
.order-btn:hover{color:${C.text};border-color:${C.borderHi}}
`;

// ─── HELPERS ───────────────────────────────────────────────────────────────
const fmt = n => n >= 1e6 ? (n/1e6).toFixed(2)+"M" : n >= 1e3 ? (n/1e3).toFixed(0)+"k" : String(n||0);
const relative = iso => { if (!iso) return "—"; const d = (Date.now()-new Date(iso))/1000; if (d<60) return `${~~d}s ago`; if (d<3600) return `${~~(d/60)}m ago`; if (d<86400) return `${~~(d/3600)}h ago`; return `${~~(d/86400)}d ago`; };
const downloadJSON = (data, filename) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = filename;
  a.click();
};

// ─── REUSABLE COMPONENTS ───────────────────────────────────────────────────
function Modal({ title, onClose, children, wide, xl }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className={`modal ${wide?"modal-wide":""} ${xl?"modal-xl":""}`} onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:18 }}>
          <div className="modal-title">{title}</div>
          <button className="icon-btn" style={{ fontSize:17 }} onClick={onClose}>✕</button>
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

function ProviderBadge({ name }) {
  const p = PROVIDERS[name] || { label: name || "?", color: C.muted, logo: "?" };
  return (
    <span className="provider-badge" style={{ background: p.color+"18", color: p.color, border:`1px solid ${p.color}30` }}>
      {p.logo} {p.label}
    </span>
  );
}

// ─── COMMAND CENTER ────────────────────────────────────────────────────────
function CommandCenter({ agents, skills, runs, onChat }) {
  const active = agents.filter(a => a.status === "active").length;
  const totalRuns = agents.reduce((s,a) => s+(a.total_runs||0), 0);
  const totalTok = agents.reduce((s,a) => s+(a.total_tokens||0), 0);
  const recent = [...runs].sort((a,b) => new Date(b.started_at||0)-new Date(a.started_at||0)).slice(0,8);

  const provDist = {};
  runs.forEach(r => { if (r.provider_used) provDist[r.provider_used] = (provDist[r.provider_used]||0)+1; });

  return (
    <div className="slide-in">
      <div className="stat-grid">
        {[
          { label:"Active Agents",    value:active,             sub:`${agents.length-active} standby`,        c:C.green  },
          { label:"Registered Skills",value:skills.length,      sub:`${skills.filter(s=>s.is_active).length} enabled`, c:C.accent },
          { label:"Total Runs",        value:fmt(totalRuns),    sub:"all agents all time",                    c:C.cyan   },
          { label:"Tokens Consumed",   value:fmt(totalTok),     sub:"across all providers",                   c:C.yellow },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ "--c":s.c }}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-val" style={{ color:s.c }}>{s.value}</div>
            <div className="stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
        <div className="card" style={{ padding:16 }}>
          <div className="section-title">◎ Recent Runs <span className="sec-badge">{recent.length} latest</span></div>
          <div className="run-log">
            {recent.length === 0
              ? <div style={{ color:C.dim, textAlign:"center", padding:"22px 0", fontSize:12 }}>No runs yet — chat with an agent to start</div>
              : recent.map(r => {
                const agent = agents.find(a=>a.id===r.agent_id);
                const p = PERSONAS[agent?.persona] || PERSONAS.researcher;
                return (
                  <div key={r.id} className="run-row">
                    <span style={{ color:p.color, fontSize:12 }}>{p.icon}</span>
                    <span style={{ color:C.text, flex:1, fontWeight:500, fontSize:11 }}>{agent?.name||"Unknown"}</span>
                    <ProviderBadge name={r.provider_used} />
                    {r.fallback_triggered && <span style={{ fontSize:9, color:C.yellow, background:C.yellow+"15", padding:"1px 5px", borderRadius:3 }}>FALLBACK</span>}
                    <span style={{ color:C.muted, minWidth:34, textAlign:"right" }}>{fmt(r.tokens_used||0)}</span>
                    <span style={{ color:C.dim, minWidth:44, textAlign:"right" }}>{r.latency_ms||0}ms</span>
                    <span style={{ color:C.dim, minWidth:50, textAlign:"right", fontSize:10 }}>{relative(r.started_at)}</span>
                  </div>
                );
              })
            }
          </div>
        </div>

        <div className="card" style={{ padding:16 }}>
          <div className="section-title">⬡ Quick Launch</div>
          <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
            {agents.filter(a=>a.status==="active").map(agent => {
              const p = PERSONAS[agent.persona] || PERSONAS.researcher;
              return (
                <div key={agent.id} style={{ display:"flex", alignItems:"center", gap:9, padding:"8px 11px", background:C.surface, borderRadius:8, border:`1px solid ${C.border}` }}>
                  <span className="status-dot active" />
                  <span style={{ color:p.color, fontSize:13 }}>{p.icon}</span>
                  <span style={{ flex:1, fontWeight:600, fontSize:12 }}>{agent.name}</span>
                  <ProviderBadge name={agent.primary_provider} />
                  <button className="btn btn-xs btn-primary" onClick={() => onChat(agent)}>Chat →</button>
                </div>
              );
            })}
            {agents.filter(a=>a.status==="active").length === 0 && (
              <div style={{ color:C.dim, textAlign:"center", padding:"14px 0", fontSize:12 }}>No active agents</div>
            )}
          </div>
        </div>
      </div>

      {/* Provider Distribution */}
      <div className="card" style={{ padding:16 }}>
        <div className="section-title">◆ Provider Distribution</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:10 }}>
          {Object.entries(PROVIDERS).slice(0,4).map(([key, p]) => {
            const agentsUsing = agents.filter(a=>a.primary_provider===key||a.fallback_provider===key).length;
            const runsUsing = runs.filter(r=>r.provider_used===key).length;
            return (
              <div key={key} style={{ background:C.surface, border:`1px solid ${p.color}22`, borderRadius:9, padding:"12px 14px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:8 }}>
                  <span style={{ color:p.color, fontSize:15 }}>{p.logo}</span>
                  <span style={{ fontFamily:"'Syne',sans-serif", fontSize:12, fontWeight:700 }}>{p.label}</span>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:4 }}>
                  {[["PRIMARY",agents.filter(a=>a.primary_provider===key).length],["FALLBACK",agents.filter(a=>a.fallback_provider===key).length],["RUNS",runsUsing]].map(([l,v])=>(
                    <div key={l} style={{ textAlign:"center" }}>
                      <div style={{ fontFamily:"'Syne',sans-serif", fontSize:14, fontWeight:800, color:p.color }}>{v}</div>
                      <div style={{ fontSize:9, color:C.muted, letterSpacing:".07em" }}>{l}</div>
                    </div>
                  ))}
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
  const [del, setDel] = useState(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const fileInputRef = useRef(null);

  const blankAgent = {
    name:"", persona:"researcher", description:"", status:"idle",
    primary_provider:"claude", fallback_provider:"gemini",
    provider_chain: ["claude","gemini"],
    primary_model:"claude-sonnet-4-6", fallback_model:"gemini-2.0-flash",
    system_prompt:"You are a helpful AI agent.", temperature:0.7, max_tokens:4096,
    total_runs:0, total_tokens:0,
  };

  const save = async (d) => {
    if (!d.name.trim()) return;
    setSaving(true);
    try {
      if (modal.mode === "add") {
        const created = await supa.post("agents", d);
        const item = Array.isArray(created) ? created[0] : created;
        if (item?.id) setAgents(a => [...a, item]);
        else setAgents(a => [...a, { ...d, id: Date.now(), created_at: new Date().toISOString() }]);
      } else {
        const updated = await supa.patch("agents", d.id, d);
        const item = Array.isArray(updated) ? updated[0] : updated;
        setAgents(a => a.map(x => x.id === d.id ? (item?.id ? item : d) : x));
      }
    } finally { setSaving(false); setModal(null); }
  };

  const doDelete = async () => {
    await supa.delete("agents", del.id);
    setAgents(a => a.filter(x => x.id !== del.id));
    setDel(null);
  };

  const exportAgents = () => downloadJSON(agents, `agents-export-${Date.now()}.json`);

  const importAgents = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        const items = Array.isArray(data) ? data : [data];
        for (const item of items) {
          const { id, created_at, updated_at, total_runs, total_tokens, ...rest } = item;
          const created = await supa.post("agents", { ...rest, total_runs:0, total_tokens:0 });
          const newItem = Array.isArray(created) ? created[0] : created;
          if (newItem?.id) setAgents(a => [...a, newItem]);
        }
      } catch (err) { alert("Import failed: " + err.message); }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const filtered = agents.filter(a => !search || a.name?.toLowerCase().includes(search.toLowerCase()));

  if (loading) return <div style={{ textAlign:"center", padding:"60px 0", color:C.muted }}><Spinner /></div>;

  return (
    <div className="slide-in">
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16, gap:10, flexWrap:"wrap" }}>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          <input className="form-input" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search agents…" style={{ width:200, padding:"6px 10px" }} />
          <div style={{ display:"flex", gap:8, fontSize:11, color:C.muted }}>
            {["active","idle","error"].map(s => (
              <span key={s} style={{ display:"flex", alignItems:"center", gap:4 }}>
                <span className={`status-dot ${s}`} /> {agents.filter(a=>a.status===s).length} {s}
              </span>
            ))}
          </div>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          <input ref={fileInputRef} type="file" accept=".json" style={{ display:"none" }} onChange={importAgents} />
          <button className="btn btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()}>⊕ Import</button>
          <button className="btn btn-ghost btn-sm" onClick={exportAgents}>↓ Export</button>
          <button className="btn btn-primary" onClick={() => setModal({ mode:"add", data:{ ...blankAgent } })}>⊕ Deploy Agent</button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">⬡</div>
          <div className="empty-text">No agents yet.<br/>Deploy your first agent to get started.</div>
        </div>
      ) : (
        <div className="agent-grid">
          {filtered.map(agent => {
            const p = PERSONAS[agent.persona] || PERSONAS.researcher;
            return (
              <div key={agent.id} className="agent-card" style={{ "--pc":p.color }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:9 }}>
                  <div>
                    <div className="persona-badge" style={{ background:p.color+"15", color:p.color, border:`1px solid ${p.color}28` }}>
                      {p.icon} {p.label}
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                      <span className={`status-dot ${agent.status}`} />
                      <span style={{ fontFamily:"'Syne',sans-serif", fontSize:14, fontWeight:800 }}>{agent.name}</span>
                    </div>
                    <div style={{ marginTop:4, display:"flex", gap:5, flexWrap:"wrap" }}>
                      <ProviderBadge name={agent.primary_provider} />
                      {agent.fallback_provider && <span style={{ fontSize:10, color:C.muted }}>→</span>}
                      {agent.fallback_provider && <ProviderBadge name={agent.fallback_provider} />}
                    </div>
                  </div>
                  <div style={{ display:"flex", gap:2 }}>
                    <button className="icon-btn" title="Chat" onClick={() => onChat(agent)} style={{ color:C.accent }}>💬</button>
                    <button className="icon-btn" title="Edit" onClick={() => setModal({ mode:"edit", data:{ ...agent } })}>✎</button>
                    <button className="icon-btn" title="Delete" onClick={() => setDel(agent)} style={{ color:C.dim }}>⊗</button>
                  </div>
                </div>
                <p style={{ color:C.muted, fontSize:11.5, lineHeight:1.65, marginBottom:10, minHeight:32 }}>{agent.description}</p>
                <div className="metric-row">
                  <div className="metric-box"><div className="m-val" style={{ color:p.color }}>{(agent.total_runs||0).toLocaleString()}</div><div className="m-lbl">RUNS</div></div>
                  <div className="metric-box"><div className="m-val" style={{ color:C.cyan }}>{fmt(agent.total_tokens||0)}</div><div className="m-lbl">TOKENS</div></div>
                  <div className="metric-box"><div className="m-val" style={{ color:C.purple }}>{Array.isArray(agent.skill_ids)?agent.skill_ids.length:0}</div><div className="m-lbl">SKILLS</div></div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && <AgentModal modal={modal} onSave={save} onClose={() => setModal(null)} saving={saving} skills={skills} />}
      {del && (
        <Modal title="Decommission Agent" onClose={() => setDel(null)}>
          <p style={{ color:C.muted, marginBottom:18 }}>Remove agent <span style={{ color:C.red }}>{del.name}</span>? This cannot be undone.</p>
          <div style={{ display:"flex", justifyContent:"flex-end", gap:9 }}>
            <button className="btn btn-ghost" onClick={() => setDel(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={doDelete}>Decommission</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AgentModal({ modal, onSave, onClose, saving, skills = [] }) {
  const [d, setD] = useState({ ...modal.data, skill_ids: modal.data.skill_ids || [] });
  const [chain, setChain] = useState(modal.data.provider_chain || [modal.data.primary_provider || "claude", modal.data.fallback_provider].filter(Boolean));
  const set = (k, v) => setD(p => ({ ...p, [k]: v }));

  const toggleSkill = (skillId) => {
    setD(p => {
      const ids = Array.isArray(p.skill_ids) ? p.skill_ids : [];
      return { ...p, skill_ids: ids.includes(skillId) ? ids.filter(x => x !== skillId) : [...ids, skillId] };
    });
  };

  const moveUp = (i) => { if (i===0) return; const c=[...chain]; [c[i-1],c[i]]=[c[i],c[i-1]]; setChain(c); updateChain(c); };
  const moveDown = (i) => { if (i===chain.length-1) return; const c=[...chain]; [c[i],c[i+1]]=[c[i+1],c[i]]; setChain(c); updateChain(c); };
  const addProvider = (prov) => { if (!chain.includes(prov)) { const c=[...chain,prov]; setChain(c); updateChain(c); } };
  const removeProvider = (i) => { if (chain.length<=1) return; const c=chain.filter((_,idx)=>idx!==i); setChain(c); updateChain(c); };
  const updateChain = (c) => {
    setD(p=>({ ...p, provider_chain:c, primary_provider:c[0], primary_model: MODELS_BY_PROVIDER[c[0]]?.[0]||p.primary_model,
      fallback_provider:c[1]||null, fallback_model: c[1]?MODELS_BY_PROVIDER[c[1]]?.[0]||"":null }));
  };

  const priorityLabels = ["PRIMARY","FALLBACK","TERTIARY","QUATERNARY"];

  return (
    <Modal title={`${modal.mode==="add"?"Deploy New":"Edit"} Agent`} onClose={onClose} wide>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        <div className="form-group" style={{ gridColumn:"span 2" }}>
          <label className="form-label">Agent Name</label>
          <input className="form-input" value={d.name} onChange={e=>set("name",e.target.value)} placeholder="e.g. NexusResearch" autoFocus />
        </div>
        <div className="form-group">
          <label className="form-label">Persona</label>
          <select className="form-input" value={d.persona} onChange={e=>set("persona",e.target.value)}>
            {Object.entries(PERSONAS).map(([k,v]) => <option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Status</label>
          <select className="form-input" value={d.status} onChange={e=>set("status",e.target.value)}>
            {["active","idle","error","archived"].map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* AI Provider Chain */}
      <div className="provider-routing">
        <div className="routing-title">⬡ AI Provider Chain — drag to reorder priority</div>
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {chain.map((prov, i) => {
            const p = PROVIDERS[prov] || { label:prov, color:C.muted, logo:"?" };
            return (
              <div key={prov+i} className="provider-slot">
                <span className="drag-handle">⠿</span>
                <span style={{ color:p.color, fontSize:14 }}>{p.logo}</span>
                <span style={{ flex:1, fontWeight:600, fontSize:12 }}>{p.label}</span>
                <span className="priority-badge" style={{ background:p.color+"18", color:p.color }}>{priorityLabels[i]||`#${i+1}`}</span>
                <select className="form-input" style={{ width:200, padding:"4px 8px", fontSize:11 }}
                  value={i===0?d.primary_model:d.fallback_model}
                  onChange={e=>set(i===0?"primary_model":"fallback_model",e.target.value)}>
                  {(MODELS_BY_PROVIDER[prov]||["custom"]).map(m=><option key={m} value={m}>{m}</option>)}
                </select>
                <div className="order-controls">
                  <button className="order-btn" onClick={()=>moveUp(i)} disabled={i===0}>▲</button>
                  <button className="order-btn" onClick={()=>moveDown(i)} disabled={i===chain.length-1}>▼</button>
                </div>
                {chain.length>1 && <button className="icon-btn" onClick={()=>removeProvider(i)} style={{ color:C.dim, fontSize:12 }}>✕</button>}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop:9, display:"flex", gap:6, flexWrap:"wrap" }}>
          <span style={{ fontSize:10, color:C.muted, marginTop:4 }}>Add provider:</span>
          {Object.entries(PROVIDERS).filter(([k])=>!chain.includes(k)).map(([k,p])=>(
            <button key={k} className="btn btn-ghost btn-xs" style={{ color:p.color, borderColor:p.color+"30" }} onClick={()=>addProvider(k)}>
              {p.logo} {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Description</label>
        <input className="form-input" value={d.description||""} onChange={e=>set("description",e.target.value)} placeholder="What does this agent do?" />
      </div>
      <div className="form-group">
        <label className="form-label">System Prompt</label>
        <textarea className="form-input" value={d.system_prompt||""} onChange={e=>set("system_prompt",e.target.value)} placeholder="Instructions that define this agent's behavior..." rows={4} />
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        <div className="form-group" style={{ marginBottom:0 }}>
          <label className="form-label">Temperature (0-2)</label>
          <input className="form-input" type="number" min="0" max="2" step="0.1" value={d.temperature||0.7} onChange={e=>set("temperature",parseFloat(e.target.value))} />
        </div>
        <div className="form-group" style={{ marginBottom:0 }}>
          <label className="form-label">Max Tokens</label>
          <input className="form-input" type="number" min="100" max="128000" step="100" value={d.max_tokens||4096} onChange={e=>set("max_tokens",parseInt(e.target.value))} />
        </div>
      </div>

      {/* Skills Assignment */}
      {skills.length > 0 && (
        <div className="provider-routing" style={{ marginTop:13 }}>
          <div className="routing-title">◈ Assign Skills — select capabilities this agent can use</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {skills.map(skill => {
              const cc = CAT_COLORS[skill.category] || CAT_COLORS.general;
              const selected = (Array.isArray(d.skill_ids) ? d.skill_ids : []).includes(skill.id);
              return (
                <button key={skill.id} onClick={() => toggleSkill(skill.id)}
                  className="btn btn-xs"
                  style={{
                    background: selected ? cc+"22" : "transparent",
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
            <div style={{ fontSize:10, color:C.muted, marginTop:7 }}>
              {(Array.isArray(d.skill_ids) ? d.skill_ids : []).length} skill{(Array.isArray(d.skill_ids) ? d.skill_ids : []).length !== 1 ? "s" : ""} assigned — these will be included in the agent's context during chat
            </div>
          )}
        </div>
      )}

      <div style={{ display:"flex", justifyContent:"flex-end", gap:9, marginTop:16 }}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onSave({...d, provider_chain:chain})} disabled={saving}>
          {saving ? <Spinner /> : modal.mode==="add" ? "Deploy Agent" : "Save Changes"}
        </button>
      </div>
    </Modal>
  );
}

// ─── SKILLS PAGE ───────────────────────────────────────────────────────────
function SkillsPage({ skills, setSkills, loading }) {
  const [modal, setModal] = useState(null);
  const [del, setDel] = useState(null);
  const [tab, setTab] = useState("all");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [importText, setImportText] = useState("");
  const [showImportModal, setShowImportModal] = useState(false);
  const fileInputRef = useRef(null);

  const blankSkill = {
    name:"", identifier:"", category:"retrieval", version:"1.0.0",
    description:"", permissions:"read", rate_limit:100, is_active:true, parameters:{}, tags:[],
  };

  const saveSkill = async (d) => {
    if (!d.name.trim()) return;
    setSaving(true);
    try {
      if (modal.mode === "add") {
        const created = await supa.post("skills", d);
        const item = Array.isArray(created) ? created[0] : created;
        setSkills(s => [...s, item?.id ? item : { ...d, id:Date.now(), created_at:new Date().toISOString() }]);
      } else {
        const updated = await supa.patch("skills", d.id, d);
        const item = Array.isArray(updated) ? updated[0] : updated;
        setSkills(s => s.map(x => x.id===d.id ? (item?.id ? item : d) : x));
      }
    } finally { setSaving(false); setModal(null); }
  };

  const toggleActive = async (skill) => {
    const updated = { ...skill, is_active: !skill.is_active };
    await supa.patch("skills", skill.id, { is_active: updated.is_active });
    setSkills(s => s.map(x => x.id===skill.id ? updated : x));
  };

  const doDelete = async () => {
    await supa.delete("skills", del.id);
    setSkills(s => s.filter(x => x.id !== del.id));
    setDel(null);
  };

  const exportSkills = () => downloadJSON(skills, `skills-export-${Date.now()}.json`);

  const handleFileImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { setImportText(ev.target.result); setShowImportModal(true); };
    reader.readAsText(file);
    e.target.value = "";
  };

  const processImport = async () => {
    try {
      let data;
      // Try JSON first
      try { data = JSON.parse(importText); }
      catch {
        // If not JSON, parse as text — create a single skill
        data = [{
          name: "Imported Skill",
          identifier: "imported_skill_"+Date.now(),
          category: "general",
          description: importText.slice(0, 2000),
          version: "1.0.0", permissions:"read", rate_limit:100, is_active:true,
        }];
      }
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const { id, created_at, ...rest } = item;
        const created = await supa.post("skills", rest);
        const newItem = Array.isArray(created) ? created[0] : created;
        setSkills(s => [...s, newItem?.id ? newItem : { ...rest, id:Date.now(), created_at:new Date().toISOString() }]);
      }
      setShowImportModal(false);
      setImportText("");
    } catch(err) { alert("Import failed: "+err.message); }
  };

  const cats = [...new Set(skills.map(s=>s.category||"general"))];
  const filtered = skills.filter(s => {
    const matchTab = tab==="all" || (tab==="active"&&s.is_active) || (tab==="inactive"&&!s.is_active) || s.category===tab;
    const matchSearch = !search || s.name?.toLowerCase().includes(search.toLowerCase()) || s.description?.toLowerCase().includes(search.toLowerCase());
    return matchTab && matchSearch;
  });

  if (loading) return <div style={{ textAlign:"center", padding:"60px 0", color:C.muted }}><Spinner /></div>;

  return (
    <div className="slide-in">
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14, gap:10, flexWrap:"wrap" }}>
        <input className="form-input" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search skills…" style={{ width:220, padding:"6px 10px" }} />
        <div style={{ display:"flex", gap:7 }}>
          <input ref={fileInputRef} type="file" accept=".json,.txt,.md" style={{ display:"none" }} onChange={handleFileImport} />
          <button className="btn btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()}>⊕ Import File</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setImportText(""); setShowImportModal(true); }}>✎ Paste Import</button>
          <button className="btn btn-ghost btn-sm" onClick={exportSkills}>↓ Export JSON</button>
          <button className="btn btn-primary" onClick={() => setModal({ mode:"add", data:{ ...blankSkill } })}>⊕ Register Skill</button>
        </div>
      </div>

      <div className="tabs">
        {["all","active","inactive",...cats].map(t => (
          <button key={t} className={`tab ${tab===t?"active":""}`} onClick={() => setTab(t)}>
            {t} {t==="all"?`(${skills.length})`:t==="active"?`(${skills.filter(s=>s.is_active).length})`:t==="inactive"?`(${skills.filter(s=>!s.is_active).length})`:`(${skills.filter(s=>s.category===t).length})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">◈</div>
          <div className="empty-text">No skills found.<br/>Register a skill or import one from a file.</div>
        </div>
      ) : (
        <div className="skill-grid">
          {filtered.map(skill => {
            const cc = CAT_COLORS[skill.category] || CAT_COLORS.general;
            return (
              <div key={skill.id} className="skill-card" style={{ "--cc":cc, opacity:skill.is_active?1:.55 }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:7 }}>
                  <div>
                    <span className="badge" style={{ background:cc+"18", color:cc, border:`1px solid ${cc}28`, marginBottom:6 }}>{skill.category||"general"}</span>
                    <div style={{ fontFamily:"'Syne',sans-serif", fontSize:13, fontWeight:800 }}>{skill.name}</div>
                    <div style={{ fontSize:10, color:C.muted, fontFamily:"'JetBrains Mono',monospace" }}>{skill.identifier} · v{skill.version||"1.0.0"}</div>
                  </div>
                  <div style={{ display:"flex", gap:4, alignItems:"center" }}>
                    <Toggle on={skill.is_active} onChange={() => toggleActive(skill)} />
                    <button className="icon-btn" onClick={() => setModal({ mode:"edit", data:{ ...skill } })}>✎</button>
                    <button className="icon-btn" onClick={() => setDel(skill)} style={{ color:C.dim }}>⊗</button>
                  </div>
                </div>
                <p style={{ color:C.muted, fontSize:11.5, lineHeight:1.65, marginBottom:10 }}>{skill.description || "No description"}</p>
                <div style={{ display:"flex", gap:8, fontSize:10, color:C.dim }}>
                  <span>🔒 {skill.permissions||"read"}</span>
                  <span>⚡ {skill.rate_limit||100} req/min</span>
                  {skill.tags?.length>0 && <span>🏷 {skill.tags.join(", ")}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Skill Modal */}
      {modal && (
        <Modal title={`${modal.mode==="add"?"Register New":"Edit"} Skill`} onClose={() => setModal(null)}>
          <SkillForm data={modal.data} onSave={saveSkill} onClose={() => setModal(null)} saving={saving} />
        </Modal>
      )}

      {/* Import Modal */}
      {showImportModal && (
        <Modal title="Import Skills" onClose={() => setShowImportModal(false)} wide>
          <p style={{ color:C.muted, fontSize:12, marginBottom:12 }}>
            Paste JSON (array or single skill), a skill description in plain text, or any structured format. The system will auto-parse it.
          </p>
          <textarea className="form-input" value={importText} onChange={e=>setImportText(e.target.value)}
            placeholder='[{"name":"MySkill","identifier":"my_skill","category":"retrieval","description":"..."}]'
            rows={10} style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11 }} />
          <div style={{ display:"flex", justifyContent:"flex-end", gap:9, marginTop:13 }}>
            <button className="btn btn-ghost" onClick={() => setShowImportModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={processImport} disabled={!importText.trim()}>Import Skills</button>
          </div>
        </Modal>
      )}

      {del && (
        <Modal title="Delete Skill" onClose={() => setDel(null)}>
          <p style={{ color:C.muted, marginBottom:18 }}>Delete skill <span style={{ color:C.red }}>{del.name}</span>?</p>
          <div style={{ display:"flex", justifyContent:"flex-end", gap:9 }}>
            <button className="btn btn-ghost" onClick={() => setDel(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={doDelete}>Delete</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SkillForm({ data, onSave, onClose, saving }) {
  const [d, setD] = useState(data);
  const set = (k,v) => setD(p=>({...p,[k]:v}));
  return (
    <>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        <div className="form-group" style={{ gridColumn:"span 2" }}>
          <label className="form-label">Skill Name</label>
          <input className="form-input" value={d.name||""} onChange={e=>set("name",e.target.value)} placeholder="e.g. Semantic Search" autoFocus />
        </div>
        <div className="form-group">
          <label className="form-label">Identifier</label>
          <input className="form-input" value={d.identifier||""} onChange={e=>set("identifier",e.target.value.toLowerCase().replace(/\s+/g,"_"))} placeholder="e.g. semantic_search" />
        </div>
        <div className="form-group">
          <label className="form-label">Version</label>
          <input className="form-input" value={d.version||"1.0.0"} onChange={e=>set("version",e.target.value)} placeholder="1.0.0" />
        </div>
        <div className="form-group">
          <label className="form-label">Category</label>
          <select className="form-input" value={d.category||"retrieval"} onChange={e=>set("category",e.target.value)}>
            {Object.keys(CAT_COLORS).map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Permissions</label>
          <select className="form-input" value={d.permissions||"read"} onChange={e=>set("permissions",e.target.value)}>
            {["read","write","execute","admin"].map(p=><option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Rate Limit (req/min)</label>
          <input className="form-input" type="number" value={d.rate_limit||100} onChange={e=>set("rate_limit",parseInt(e.target.value))} />
        </div>
        <div className="form-group">
          <label className="form-label">Tags (comma separated)</label>
          <input className="form-input" value={(d.tags||[]).join(",")} onChange={e=>set("tags",e.target.value.split(",").map(t=>t.trim()).filter(Boolean))} placeholder="search, nlp, vectors" />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Description</label>
        <textarea className="form-input" value={d.description||""} onChange={e=>set("description",e.target.value)} placeholder="What does this skill do? Include input/output format, use cases..." rows={4} />
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
        <Toggle on={d.is_active!==false} onChange={() => set("is_active",!d.is_active)} />
        <span style={{ fontSize:12, color:C.muted }}>Skill is {d.is_active!==false?"active":"inactive"}</span>
      </div>
      <div style={{ display:"flex", justifyContent:"flex-end", gap:9 }}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onSave(d)} disabled={saving}>
          {saving ? <Spinner /> : data.id ? "Save Changes" : "Register Skill"}
        </button>
      </div>
    </>
  );
}

// ─── CHAT PAGE ─────────────────────────────────────────────────────────────
function ChatPage({ agent, agents, onSelectAgent, setAgents, skills }) {
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const msgsRef = useRef([]);

  // Keep msgsRef in sync so send() always has latest history
  useEffect(() => { msgsRef.current = msgs; }, [msgs]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior:"smooth" });
  }, [msgs]);

  useEffect(() => {
    // Reset messages when agent changes
    setMsgs([]);
  }, [agent?.id]);

  const send = useCallback(async () => {
    if (!input.trim() || !agent || loading) return;
    const userMsg = input.trim();
    const history = msgsRef.current; // capture history before state update
    setInput("");
    setMsgs(m => [...m, { role:"user", text:userMsg, ts:new Date() }]);
    setLoading(true);
    try {
      // Resolve skills attached to this agent
      const agentSkillIds = Array.isArray(agent.skill_ids) ? agent.skill_ids : [];
      const agentSkills = skills.filter(s => agentSkillIds.includes(s.id));
      const result = await routeToAI(agent, userMsg, history, agentSkills);
      setMsgs(m => [...m, {
        role:"agent", text:result.response, ts:new Date(),
        meta:`${result.provider_used} · ${result.model_used} · ${result.tokens_used}tok · ${result.latency_ms}ms${result.fallback_triggered?" · FALLBACK":""}`
      }]);
      setAgents(a => a.map(x => x.id===agent.id ? {
        ...x, total_runs:(x.total_runs||0)+1, total_tokens:(x.total_tokens||0)+(result.tokens_used||0)
      } : x));
    } catch(e) {
      setMsgs(m => [...m, { role:"agent", text:`⚠ Error: ${e.message}\n\nCheck your API keys in Settings.`, meta:"error", ts:new Date() }]);
    } finally { setLoading(false); }
  }, [input, agent, loading, setAgents, skills]);

  // CONDITIONAL RENDER AFTER ALL HOOKS
  if (!agent) {
    return (
      <div className="chat-wrap slide-in" style={{ alignItems:"center", justifyContent:"center", color:C.muted, gap:12 }}>
        <div style={{ fontSize:42, opacity:.3 }}>⬡</div>
        <div style={{ textAlign:"center" }}>
          <div style={{ fontSize:14, fontWeight:600, color:C.text, marginBottom:6 }}>No Agent Selected</div>
          <div style={{ fontSize:12 }}>Go to Agents and click 💬 to start a chat</div>
        </div>
      </div>
    );
  }

  const p = PERSONAS[agent.persona] || PERSONAS.researcher;

  return (
    <div className="chat-wrap slide-in">
      <div className="chat-header">
        <span style={{ color:p.color, fontSize:18, flexShrink:0 }}>{p.icon}</span>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:"'Syne',sans-serif", fontSize:13, fontWeight:800, display:"flex", alignItems:"center", gap:7 }}>
            {agent.name}
            <span className={`status-dot ${agent.status}`} style={{ width:6, height:6 }} />
          </div>
          <div style={{ display:"flex", gap:5, marginTop:1, flexWrap:"wrap" }}>
            <ProviderBadge name={agent.primary_provider} />
            {agent.fallback_provider && <span style={{ fontSize:10, color:C.muted }}>→</span>}
            {agent.fallback_provider && <ProviderBadge name={agent.fallback_provider} />}
            <span style={{ fontSize:10, color:C.muted }}>· {agent.primary_model}</span>
          </div>
        </div>
        <select className="form-input" style={{ width:"auto", fontSize:11, padding:"4px 9px", flexShrink:0 }}
          value={agent.id} onChange={e => { const a=agents.find(x=>x.id===e.target.value||x.id==e.target.value); if(a) onSelectAgent(a); }}>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        {msgs.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => setMsgs([])}>Clear</button>
        )}
      </div>

      <div className="chat-msgs">
        {msgs.length === 0 && (
          <div style={{ textAlign:"center", padding:"40px 20px", color:C.muted }}>
            <div style={{ fontSize:40, marginBottom:10 }}>{p.icon}</div>
            <div style={{ fontFamily:"'Syne',sans-serif", fontSize:15, fontWeight:800, color:C.text, marginBottom:6 }}>{agent.name}</div>
            <div style={{ fontSize:12, maxWidth:360, margin:"0 auto", lineHeight:1.8 }}>{agent.description || "Ready to assist. Send a message to begin."}</div>
            <div style={{ marginTop:16, fontSize:11, color:C.dim }}>
              Provider: <span style={{ color:PROVIDERS[agent.primary_provider]?.color }}>{PROVIDERS[agent.primary_provider]?.logo} {agent.primary_provider}</span>
              {agent.fallback_provider && <> · Fallback: <span style={{ color:PROVIDERS[agent.fallback_provider]?.color }}>{agent.fallback_provider}</span></>}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i}>
            <div className={`msg msg-${m.role}`}>{m.text}</div>
            {m.meta && (
              <div className="msg-meta" style={{ justifyContent:m.role==="user"?"flex-end":"flex-start" }}>
                {m.meta==="error" ? <span style={{ color:C.red }}>error</span> : m.meta}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="msg msg-agent" style={{ display:"flex", gap:8, alignItems:"center", color:C.muted }}>
            <Spinner /> Routing to {PROVIDERS[agent.primary_provider]?.label}…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-row">
        <textarea ref={inputRef} className="chat-input" rows={2} value={input}
          placeholder={`Message ${agent.name}… (Enter to send, Shift+Enter for new line)`}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="btn btn-primary" onClick={send} disabled={loading || !input.trim()} style={{ alignSelf:"flex-end" }}>
          {loading ? <Spinner /> : "Send ↑"}
        </button>
      </div>
    </div>
  );
}

// ─── RUN HISTORY PAGE ──────────────────────────────────────────────────────
function RunHistoryPage({ runs, agents }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const sorted = [...runs].sort((a,b) => new Date(b.started_at||0)-new Date(a.started_at||0));
  const filtered = sorted.filter(r => {
    const matchFilter = filter==="all" || r.provider_used===filter || (filter==="fallback"&&r.fallback_triggered);
    const agent = agents.find(a=>a.id===r.agent_id);
    const matchSearch = !search || agent?.name?.toLowerCase().includes(search.toLowerCase()) || r.provider_used?.includes(search);
    return matchFilter && matchSearch;
  });
  const providers = [...new Set(runs.map(r=>r.provider_used).filter(Boolean))];

  return (
    <div className="slide-in">
      <div style={{ display:"flex", gap:10, marginBottom:14, flexWrap:"wrap", alignItems:"center" }}>
        <input className="form-input" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search runs…" style={{ width:200, padding:"6px 10px" }} />
        <div style={{ display:"flex", gap:2 }}>
          {["all","fallback",...providers].map(f=>(
            <button key={f} className={`btn btn-sm ${filter===f?"btn-primary":"btn-ghost"}`} onClick={()=>setFilter(f)}>{f}</button>
          ))}
        </div>
        <div style={{ marginLeft:"auto", fontSize:11, color:C.muted }}>{filtered.length} runs</div>
      </div>
      {filtered.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">◎</div><div className="empty-text">No run history yet.</div></div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Agent</th><th>Provider</th><th>Model</th><th>Status</th><th>Tokens</th><th>Latency</th><th>Time</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0,100).map(r => {
                const agent = agents.find(a=>a.id===r.agent_id);
                const p = PROVIDERS[r.provider_used] || { label:r.provider_used, color:C.muted, logo:"?" };
                return (
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontWeight:600 }}>{agent?.name||"Unknown"}</div>
                      <div style={{ fontSize:10, color:C.muted, fontFamily:"'JetBrains Mono',monospace", marginTop:2, maxWidth:200, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.prompt}</div>
                    </td>
                    <td><ProviderBadge name={r.provider_used} /></td>
                    <td><span style={{ fontSize:10, color:C.muted, fontFamily:"'JetBrains Mono',monospace" }}>{r.model_used}</span></td>
                    <td>
                      <div style={{ display:"flex", gap:5, alignItems:"center" }}>
                        <span style={{ color:r.status==="completed"?C.green:C.red, fontSize:10 }}>{r.status==="completed"?"✓":"✗"}</span>
                        {r.fallback_triggered && <span style={{ fontSize:9, color:C.yellow, background:C.yellow+"15", padding:"1px 5px", borderRadius:3 }}>FALLBACK</span>}
                      </div>
                    </td>
                    <td style={{ color:C.muted }}>{fmt(r.tokens_used||0)}</td>
                    <td style={{ color:C.muted }}>{r.latency_ms||0}ms</td>
                    <td style={{ color:C.dim, fontSize:11 }}>{relative(r.started_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── API KEYS PAGE ─────────────────────────────────────────────────────────
function ApiKeysPage() {
  const [keys, setKeys] = useState(() => {
    try { return JSON.parse(localStorage.getItem("agentops_keys")||"{}"); } catch { return {}; }
  });
  const [show, setShow] = useState({});
  const [saved, setSaved] = useState(false);

  const saveKeys = () => {
    localStorage.setItem("agentops_keys", JSON.stringify(keys));
    setSaved(true);
    setTimeout(()=>setSaved(false), 2000);
  };

  const keyDefs = [
    { id:"ANTHROPIC_API_KEY",  label:"Claude (Anthropic)", logo:"◆", color:"#d97706", hint:"sk-ant-..." },
    { id:"GEMINI_API_KEY",     label:"Google Gemini",      logo:"✦", color:"#4285f4", hint:"AI..." },
    { id:"DEEPSEEK_API_KEY",   label:"DeepSeek",           logo:"◉", color:"#10b981", hint:"sk-..." },
    { id:"OPENAI_API_KEY",     label:"OpenAI",             logo:"⊕", color:"#74aa9c", hint:"sk-..." },
    { id:"MISTRAL_API_KEY",    label:"Mistral AI",         logo:"◐", color:"#ff7000", hint:"..." },
    { id:"GROQ_API_KEY",       label:"Groq",               logo:"◧", color:"#f55036", hint:"gsk_..." },
    { id:"COHERE_API_KEY",     label:"Cohere",             logo:"◑", color:"#39594d", hint:"..." },
    { id:"CUSTOM_API_KEY",     label:"Custom Provider",    logo:"✳", color:"#8b5cf6", hint:"your key..." },
    { id:"CUSTOM_API_URL",     label:"Custom API URL",     logo:"🌐", color:"#64748b", hint:"https://..." },
  ];

  return (
    <div className="slide-in" style={{ maxWidth:700 }}>
      <div style={{ background:C.yellow+"12", border:`1px solid ${C.yellow}30`, borderRadius:9, padding:"11px 14px", marginBottom:18, fontSize:12, color:C.yellow, lineHeight:1.6 }}>
        ⚠ API keys are stored locally in your browser for development. For production, set them as environment variables on your server.
      </div>
      {keyDefs.map(k => (
        <div key={k.id} className="key-card">
          <div className="key-logo" style={{ background:k.color+"18", color:k.color, border:`1px solid ${k.color}30` }}>{k.logo}</div>
          <div style={{ flex:1 }}>
            <div style={{ fontWeight:600, fontSize:12, marginBottom:5 }}>{k.label}</div>
            <input
              className="key-field"
              type={show[k.id]?"text":"password"}
              placeholder={k.hint}
              value={keys[k.id]||""}
              onChange={e=>setKeys(p=>({...p,[k.id]:e.target.value}))}
            />
          </div>
          <button className="icon-btn" onClick={()=>setShow(s=>({...s,[k.id]:!s[k.id]}))} title={show[k.id]?"Hide":"Show"}>
            {show[k.id]?"🙈":"👁"}
          </button>
        </div>
      ))}
      <div style={{ display:"flex", justifyContent:"flex-end", gap:9, marginTop:6 }}>
        <button className="btn btn-ghost" onClick={()=>setKeys({})}>Clear All</button>
        <button className={`btn ${saved?"btn-success":"btn-primary"}`} onClick={saveKeys}>
          {saved ? "✓ Saved!" : "Save Keys"}
        </button>
      </div>
      <div className="card" style={{ padding:16, marginTop:20 }}>
        <div className="section-title">◎ Connection Status</div>
        <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
          {Object.entries(PROVIDERS).map(([k,p]) => {
            const hasKey = !!keys[k.toUpperCase()+"_API_KEY"]||k==="custom";
            return (
              <div key={k} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 12px", background:C.surface, borderRadius:7, border:`1px solid ${C.border}` }}>
                <span style={{ color:p.color, fontSize:14 }}>{p.logo}</span>
                <span style={{ flex:1, fontWeight:500 }}>{p.label}</span>
                <span style={{ fontSize:10, color:hasKey?C.green:C.dim, background:(hasKey?C.green:C.dim)+"15", padding:"2px 8px", borderRadius:4, fontFamily:"'JetBrains Mono',monospace" }}>
                  {hasKey?"KEY SET":"NO KEY"}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── DATABASE PAGE ─────────────────────────────────────────────────────────
function DatabasePage({ agents, skills, runs }) {
  const tables = [
    { name:"agents", icon:"⬡", count:agents.length, color:C.accent,
      cols:["id","name","persona","status","primary_provider","total_runs","total_tokens"],
      rows:agents.slice(0,20) },
    { name:"skills", icon:"◈", count:skills.length, color:C.cyan,
      cols:["id","name","identifier","category","version","is_active"],
      rows:skills.slice(0,20) },
    { name:"agent_runs", icon:"◎", count:runs.length, color:C.green,
      cols:["id","agent_id","provider_used","status","tokens_used","latency_ms","started_at"],
      rows:runs.slice(0,20) },
  ];
  const [active, setActive] = useState("agents");
  const tbl = tables.find(t=>t.name===active);

  return (
    <div className="slide-in">
      <div className="tabs">
        {tables.map(t=>(
          <button key={t.name} className={`tab ${active===t.name?"active":""}`} onClick={()=>setActive(t.name)}>
            {t.icon} {t.name} ({t.count})
          </button>
        ))}
      </div>
      {tbl && (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr>{tbl.cols.map(c=><th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {tbl.rows.length===0
                ? <tr><td colSpan={tbl.cols.length} style={{ textAlign:"center", color:C.dim, padding:20 }}>No data</td></tr>
                : tbl.rows.map((row,i)=>(
                  <tr key={i}>
                    {tbl.cols.map(col=>(
                      <td key={col}>
                        <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11 }}>
                          {col==="is_active"
                            ? <span style={{ color:row[col]?C.green:C.dim }}>{row[col]?"✓":"✗"}</span>
                            : col==="status"
                            ? <span style={{ color:row[col]==="active"?C.green:row[col]==="error"?C.red:C.yellow }}>{row[col]}</span>
                            : col==="primary_provider"||col==="provider_used"
                            ? <ProviderBadge name={row[col]} />
                            : String(row[col]??"—").slice(0,40)}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────
const NAV = [
  { id:"command",   icon:"◎", label:"Command Center", group:"main" },
  { id:"agents",    icon:"⬡", label:"Agents",         group:"main", countKey:"agents" },
  { id:"skills",    icon:"◈", label:"Skills",          group:"main", countKey:"skills" },
  { id:"chat",      icon:"💬", label:"Chat",            group:"main" },
  { id:"runs",      icon:"▶", label:"Run History",     group:"data", countKey:"runs" },
  { id:"database",  icon:"▦", label:"Database",        group:"data" },
  { id:"apikeys",   icon:"🔑", label:"API Keys",        group:"data" },
];

export default function App() {
  const [page, setPage] = useState("command");
  const [agents, setAgents] = useState([]);
  const [skills, setSkills] = useState([]);
  const [runs, setRuns] = useState([]);
  const [chatAgent, setChatAgent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [providerStatus, setProviderStatus] = useState({ claude:false, gemini:false, deepseek:false });

  const loadData = async () => {
    setLoading(true);
    const [a, s, r] = await Promise.all([
      supa.get("agents", "order=created_at.asc"),
      supa.get("skills", "order=created_at.asc"),
      supa.get("agent_runs", "order=started_at.desc&limit=200"),
    ]);
    const agentArr = Array.isArray(a)?a:[];
    const skillArr = Array.isArray(s)?s:[];
    const runArr = Array.isArray(r)?r:[];
    setAgents(agentArr);
    setSkills(skillArr);
    setRuns(runArr);
    if (!chatAgent && agentArr.length>0) setChatAgent(agentArr[0]);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const goChat = (agent) => { setChatAgent(agent); setPage("chat"); };

  const counts = { agents:agents.length, skills:skills.length, runs:runs.length };

  return (
    <>
      <style>{STYLES}</style>
      <div className="app">
        <div className="nebula" />

        {/* SIDEBAR */}
        <div className="sidebar">
          <div className="logo-wrap">
            <div className="logo-hex">⬡</div>
            <div className="logo-text">
              <div className="name">AGENTOPS</div>
              <div className="ver">PLATFORM v2.0</div>
            </div>
          </div>

          <div className="nav">
            <div className="nav-section">Main</div>
            {NAV.filter(n=>n.group==="main").map(n => (
              <div key={n.id} className={`nav-item ${page===n.id?"active":""}`} onClick={() => setPage(n.id)}>
                <span className="nav-icon">{n.icon}</span>
                {n.label}
                {n.countKey && <span className="nav-count">{counts[n.countKey]||0}</span>}
              </div>
            ))}

            <div className="nav-section">Data</div>
            {NAV.filter(n=>n.group==="data").map(n => (
              <div key={n.id} className={`nav-item ${page===n.id?"active":""}`} onClick={() => setPage(n.id)}>
                <span className="nav-icon">{n.icon}</span>
                {n.label}
                {n.countKey && counts[n.countKey]>0 && <span className="nav-count">{counts[n.countKey]}</span>}
              </div>
            ))}

            <div className="nav-section">AI Providers</div>
            {Object.entries(PROVIDERS).slice(0,4).map(([key,p]) => {
              const isConfigured = agents.some(a=>a.primary_provider===key||a.fallback_provider===key);
              return (
                <div key={key} className="provider-row" onClick={() => setPage("apikeys")}>
                  <span className="provider-dot" style={{ background:p.color }} />
                  <span style={{ color:C.muted, flex:1, fontSize:11 }}>{p.label}</span>
                  <span className="provider-status" style={{ background:isConfigured?C.green+"18":C.dim+"18", color:isConfigured?C.green:C.dim }}>
                    {isConfigured?"ON":"OFF"}
                  </span>
                </div>
              );
            })}
          </div>

          <div style={{ padding:"10px 14px", borderTop:`1px solid ${C.border}` }}>
            <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, color:C.muted, marginBottom:4 }}>
              <span>Supabase</span>
              <span style={{ color:SUPA_URL?C.green:C.dim, fontFamily:"'JetBrains Mono',monospace" }}>
                {SUPA_URL?"● LIVE":"○ OFFLINE"}
              </span>
            </div>
            <button className="btn btn-ghost btn-xs" style={{ width:"100%" }} onClick={loadData}>
              {loading ? <><Spinner/> Loading…</> : "⟳ Refresh Data"}
            </button>
          </div>
        </div>

        {/* MAIN */}
        <div className="main">
          <div className="topbar">
            <div style={{ display:"flex", alignItems:"center" }}>
              <div className="page-title">{NAV.find(n=>n.id===page)?.label||"AgentOps"}</div>
              <span className="breadcrumb">/ {page}</span>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              {loading && <Spinner />}
              {chatAgent && page!=="chat" && (
                <button className="btn btn-ghost btn-sm" onClick={() => setPage("chat")}>
                  💬 {chatAgent.name}
                </button>
              )}
            </div>
          </div>

          {page !== "chat" && (
            <div className="content">
              {page==="command" && <CommandCenter agents={agents} skills={skills} runs={runs} onChat={goChat} />}
              {page==="agents"  && <AgentsPage agents={agents} setAgents={setAgents} skills={skills} onChat={goChat} loading={loading} />}
              {page==="skills"  && <SkillsPage skills={skills} setSkills={setSkills} loading={loading} />}
              {page==="runs"    && <RunHistoryPage runs={runs} agents={agents} />}
              {page==="database"&& <DatabasePage agents={agents} skills={skills} runs={runs} />}
              {page==="apikeys" && <ApiKeysPage />}
            </div>
          )}

          {page === "chat" && (
            <ChatPage
              agent={chatAgent}
              agents={agents}
              onSelectAgent={a=>{ setChatAgent(a); }}
              setAgents={setAgents}
              skills={skills}
            />
          )}
        </div>
      </div>
    </>
  );
}
