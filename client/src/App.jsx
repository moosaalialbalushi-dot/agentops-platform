import { useState, useEffect, useCallback, useRef } from "react";

// ─── CONFIG ────────────────────────────────────────────────────────────────
// Supabase anon key is a publishable key — safe to ship in client bundles.
// Override with VITE_SUPABASE_URL / VITE_SUPABASE_KEY env vars if needed.
const SUPA_URL  = import.meta.env.VITE_SUPABASE_URL  || "https://cnliqngeufcdsypuimog.supabase.co";
const SUPA_KEY  = import.meta.env.VITE_SUPABASE_KEY  || import.meta.env.VITE_SUPABASE_ANON_KEY
                 || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubGlxbmdldWZjZHN5cHVpbW9nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNTk1MTksImV4cCI6MjA4ODgzNTUxOX0.dKnMsDxcwQZATCsVO7EVKluCh9MpRRipuSl1B_JCNO0";
const AI_PROXY_URL = "/api/chat";

// ─── AUDIT LOG ──────────────────────────────────────────────────────────────
// Dispatches events picked up by ToastProvider and AuditLogPage anywhere in tree
function auditLog(op, table, status, detail = "") {
  window.dispatchEvent(new CustomEvent("agentops_audit", {
    detail: { id: Date.now() + Math.random(), op, table, status, detail, ts: new Date().toISOString() }
  }));
}

// ─── SUPABASE CLIENT ────────────────────────────────────────────────────────
const supa = {
  headers: { "Content-Type": "application/json", "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}` },
  async get(table, params = "") {
    try {
      const r = await fetch(`${SUPA_URL}/rest/v1/${table}?${params}`, { headers: this.headers });
      const data = await r.json();
      if (!r.ok) { auditLog("LOAD", table, "error", data?.message || `HTTP ${r.status}`); return []; }
      return Array.isArray(data) ? data : [];
    } catch (e) { auditLog("LOAD", table, "error", e.message); return []; }
  },
  async post(table, body) {
    try {
      const r = await fetch(`${SUPA_URL}/rest/v1/${table}`, {
        method: "POST", headers: { ...this.headers, "Prefer": "return=representation" }, body: JSON.stringify(body)
      });
      const data = await r.json();
      if (r.ok) auditLog("SAVE", table, "success", `Record created`);
      else auditLog("SAVE", table, "error", data?.message || `HTTP ${r.status}`);
      return data;
    } catch (e) { auditLog("SAVE", table, "error", e.message); return []; }
  },
  async patch(table, id, body) {
    try {
      const r = await fetch(`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`, {
        method: "PATCH", headers: { ...this.headers, "Prefer": "return=representation" }, body: JSON.stringify(body)
      });
      const data = await r.json();
      if (r.ok) auditLog("UPDATE", table, "success", `Record updated`);
      else auditLog("UPDATE", table, "error", data?.message || `HTTP ${r.status}`);
      return data;
    } catch (e) { auditLog("UPDATE", table, "error", e.message); return []; }
  },
  async delete(table, id) {
    try {
      const r = await fetch(`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`, { method: "DELETE", headers: this.headers });
      if (r.ok) auditLog("DELETE", table, "success", `Record removed`);
      else auditLog("DELETE", table, "error", `HTTP ${r.status}`);
    } catch (e) { auditLog("DELETE", table, "error", e.message); }
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
  claude:      { label: "Claude",      color: "#d97706", logo: "◆" },
  gemini:      { label: "Gemini",      color: "#4285f4", logo: "✦" },
  deepseek:    { label: "DeepSeek",    color: "#10b981", logo: "◉" },
  openai:      { label: "OpenAI",      color: "#74aa9c", logo: "⊕" },
  mistral:     { label: "Mistral",     color: "#ff7000", logo: "◐" },
  cohere:      { label: "Cohere",      color: "#39594d", logo: "◑" },
  groq:        { label: "Groq",        color: "#f55036", logo: "◧" },
  openrouter:  { label: "OpenRouter",  color: "#7c3aed", logo: "⊛" },
  notebooklm:  { label: "NotebookLM",  color: "#1a73e8", logo: "⊞" },
  imagen:      { label: "Imagen",      color: "#34a853", logo: "⬡" },
  veo:         { label: "Veo (Video)", color: "#0f9d58", logo: "▶" },
  custom:      { label: "Custom",      color: "#8b5cf6", logo: "✳" },
};

const MODELS_BY_PROVIDER = {
  claude:     [
    "claude-sonnet-4-6",          // fast + capable — recommended default
    "claude-haiku-4-5-20251001",  // fastest, lowest cost
    "claude-3-5-sonnet-20241022", // stable, widely available
    "claude-3-7-sonnet-20250219", // advanced reasoning
    "claude-opus-4-6",            // most powerful — slow, may timeout on Vercel
    "claude-3-opus-20240229",
  ],
  gemini:     [
    "gemini-2.5-pro-preview-05-06",
    "gemini-2.5-flash-preview-05-20",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-1.5-pro-002",
    "gemini-1.5-flash-002",
  ],
  deepseek:   ["deepseek-chat", "deepseek-coder", "deepseek-reasoner"],
  openai:     [
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4o",
    "gpt-4o-mini",
    "o3",
    "o3-mini",
    "o1",
    "o1-mini",
  ],
  mistral:    [
    "mistral-large-latest",
    "mistral-small-latest",
    "codestral-latest",
    "pixtral-large-latest",
  ],
  cohere:     ["command-a-03-2025", "command-r-plus", "command-r"],
  groq:       [
    "llama-3.3-70b-versatile",
    "llama-3.1-70b-versatile",
    "llama-3.1-8b-instant",
    "gemma2-9b-it",
    "qwen-qwq-32b",
    "mixtral-8x7b-32768",
  ],
  openrouter: [
    // Free tier (no credits deducted, rate-limited)
    "qwen/qwen3-235b-a22b:free",
    "qwen/qwq-32b:free",
    "qwen/qwen-2.5-72b-instruct:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "meta-llama/llama-3.2-11b-vision-instruct:free",
    "deepseek/deepseek-r1:free",
    "deepseek/deepseek-chat-v3-0324:free",
    "google/gemma-3-27b-it:free",
    "mistralai/mistral-7b-instruct:free",
    "microsoft/phi-4:free",
    // Paid — billed per token via your OpenRouter credits
    "anthropic/claude-opus-4",
    "anthropic/claude-sonnet-4-5",
    "google/gemini-2.5-pro-preview",
    "openai/gpt-4.1",
    "openai/o3",
    "meta-llama/llama-3.1-405b-instruct",
    "mistralai/mistral-large",
    "cohere/command-r-plus",
    "x-ai/grok-3",
    "perplexity/sonar-pro",
  ],
  notebooklm: [
    "notebooklm-research",
    "notebooklm-slides",
    "notebooklm-summary",
    "notebooklm-qa",
    "notebooklm-podcast",
  ],
  imagen:     [
    "imagen-3.0-generate-002",
    "imagen-3.0-fast-generate-001",
  ],
  veo:        [
    "veo-2.0-generate-001",
  ],
  custom:     ["custom-model"],
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
.pipeline-card{align-self:flex-start;background:${C.card};border:1px solid rgba(167,139,250,.25);border-left:3px solid ${C.purple};border-radius:10px;padding:13px 15px;max-width:96%;width:100%}
.pipeline-header{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;margin-bottom:11px;color:${C.text}}
.pipeline-step{background:${C.surface};border:1px solid ${C.border};border-radius:7px;padding:10px 12px;margin-bottom:8px}
.pipeline-step:last-child{margin-bottom:0}
.pipeline-step-error{border-color:rgba(239,68,68,.3);background:rgba(239,68,68,.04)}
.pipeline-step-label{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:${C.text};margin-bottom:7px}
.slides-deck{display:flex;flex-direction:column;gap:10px;margin-top:4px}
.slide-card{background:linear-gradient(135deg,rgba(99,102,241,.08),rgba(167,139,250,.05));border:1px solid rgba(99,102,241,.22);border-radius:9px;padding:14px 16px;position:relative}
.slide-num{position:absolute;top:8px;right:10px;font-size:9px;color:${C.dim};font-family:'JetBrains Mono',monospace;letter-spacing:.06em}
.slide-title{font-family:'Syne',sans-serif;font-size:13px;font-weight:800;color:${C.text};margin-bottom:8px}
.slide-body{font-size:12px;color:${C.muted};line-height:1.75;white-space:pre-wrap}
.slide-notes{margin-top:9px;padding-top:8px;border-top:1px solid ${C.border};font-size:10px;color:${C.dim};font-style:italic}
.pipeline-step-output{font-size:12px;color:${C.text};line-height:1.7;white-space:pre-wrap;max-height:320px;overflow-y:auto}
.toast-stack{position:fixed;bottom:22px;right:22px;z-index:999999;display:flex;flex-direction:column;gap:7px;pointer-events:none}
.toast{padding:9px 13px;border-radius:9px;font-size:11px;display:flex;gap:8px;align-items:flex-start;backdrop-filter:blur(12px);box-shadow:0 8px 24px rgba(0,0,0,.5);animation:slidein .18s ease;pointer-events:auto;max-width:300px}
.toast-ok{background:rgba(16,185,129,.12);border:1px solid rgba(16,185,129,.3)}
.toast-err{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3)}
.file-chips{display:flex;gap:5px;flex-wrap:wrap;padding:6px 18px 0}
.file-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 8px;border-radius:5px;font-size:10px;background:rgba(99,102,241,.1);border:1px solid rgba(99,102,241,.25);color:${C.accentHi};max-width:200px}
.file-chip-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.connector-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:11px}
.connector-card{padding:16px;border-radius:10px;background:${C.card};border:1px solid ${C.border};transition:all .2s;border-left:3px solid var(--tc)}
.connector-card:hover{border-color:var(--tc);transform:translateY(-1px);box-shadow:0 6px 20px rgba(0,0,0,.25)}
.enhance-btn{background:linear-gradient(135deg,rgba(99,102,241,.15),rgba(167,139,250,.1));border:1px solid rgba(99,102,241,.28);color:${C.accentHi};border-radius:5px;padding:3px 9px;font-size:10px;cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:4px;white-space:nowrap}
.enhance-btn:hover{background:linear-gradient(135deg,rgba(99,102,241,.25),rgba(167,139,250,.18))}
.enhance-btn:disabled{opacity:.5;cursor:not-allowed}
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

// ─── TOAST PROVIDER ────────────────────────────────────────────────────────
function ToastProvider() {
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    const handler = (e) => {
      const t = { ...e.detail, _uid: Date.now() + Math.random() };
      setToasts(p => [t, ...p].slice(0, 5));
      setTimeout(() => setToasts(p => p.filter(x => x._uid !== t._uid)), 4200);
    };
    window.addEventListener("agentops_audit", handler);
    return () => window.removeEventListener("agentops_audit", handler);
  }, []);
  return (
    <div className="toast-stack">
      {toasts.map(t => (
        <div key={t._uid} className={`toast ${t.status === "error" ? "toast-err" : "toast-ok"}`}>
          <span style={{ color: t.status === "error" ? C.red : C.green, fontSize: 13, flexShrink:0 }}>
            {t.status === "error" ? "⚠" : "✓"}
          </span>
          <div>
            <div style={{ fontWeight:700, color:C.text }}>{t.op} {t.table}</div>
            {t.detail && <div style={{ color:C.muted, fontSize:10, marginTop:2 }}>{t.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── PROMPT ENHANCER ───────────────────────────────────────────────────────
function PromptEnhancer({ value, onChange, context = "AI prompt", compact = false }) {
  const [loading, setLoading] = useState(false);
  const enhance = async () => {
    if (!value?.trim() || loading) return;
    setLoading(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "claude", model: "claude-sonnet-4-6",
          system_prompt: "You are a prompt engineering expert. Rewrite the provided text into a highly effective, clear, and structured AI prompt. Preserve the user's intent. Return ONLY the improved prompt — no preamble, no explanation.",
          messages: [{ role: "user", content: `Improve this ${context}:\n\n${value}` }],
          max_tokens: 1500,
        }),
      });
      const data = await r.json();
      if (data.response) onChange(data.response);
      else auditLog("ENHANCE", "prompt", "error", data?.error || "No response");
    } catch (e) { auditLog("ENHANCE", "prompt", "error", e.message); }
    finally { setLoading(false); }
  };
  return (
    <button className="enhance-btn" onClick={enhance} disabled={loading || !value?.trim()} title={`AI-enhance this ${context}`}>
      {loading ? <span className="spin" style={{ width:10, height:10, borderWidth:1.5 }} /> : "✨"}
      {!compact && " Enhance"}
    </button>
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
                {prov==="openrouter" && (
                  <span style={{ fontSize:10, color:C.green, background:C.green+"15", padding:"2px 7px", borderRadius:5, whiteSpace:"nowrap" }}>
                    ✓ FREE
                  </span>
                )}
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
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
          <label className="form-label" style={{ marginBottom:0 }}>System Prompt</label>
          <PromptEnhancer value={d.system_prompt} onChange={v => set("system_prompt", v)} context="agent system prompt" />
        </div>
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
    output_type:"text", pipeline_steps:[],
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

const OUTPUT_TYPES = ["text", "image", "presentation", "code", "analysis", "pipeline"];

function SkillForm({ data, onSave, onClose, saving }) {
  const [d, setD] = useState({ output_type:"text", pipeline_steps:[], ...data });
  const set = (k,v) => setD(p=>({...p,[k]:v}));

  const addStep = () => setD(p => ({
    ...p, pipeline_steps: [...(p.pipeline_steps||[]), {
      label: `Step ${(p.pipeline_steps||[]).length + 1}`,
      provider: "claude",
      model: "claude-sonnet-4-6",
      prompt_template: "{{input}}",
      system_prompt: "You are a helpful AI assistant.",
      max_tokens: 2048,
    }]
  }));
  const removeStep = (i) => setD(p => ({ ...p, pipeline_steps: p.pipeline_steps.filter((_,idx)=>idx!==i) }));
  const setStep = (i, k, v) => setD(p => ({
    ...p,
    pipeline_steps: p.pipeline_steps.map((s, idx) => idx===i ? {...s,[k]:v} : s)
  }));

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
          <label className="form-label">Output Type</label>
          <select className="form-input" value={d.output_type||"text"} onChange={e=>set("output_type",e.target.value)}>
            {OUTPUT_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
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
        <div className="form-group" style={{ gridColumn:"span 2" }}>
          <label className="form-label">Tags (comma separated)</label>
          <input className="form-input" value={(d.tags||[]).join(",")} onChange={e=>set("tags",e.target.value.split(",").map(t=>t.trim()).filter(Boolean))} placeholder="search, nlp, vectors" />
        </div>
      </div>
      <div className="form-group">
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
          <label className="form-label" style={{ marginBottom:0 }}>Description / Single-step Prompt</label>
          <PromptEnhancer value={d.description} onChange={v => set("description", v)} context="skill description and prompt" />
        </div>
        <textarea className="form-input" value={d.description||""} onChange={e=>set("description",e.target.value)} placeholder="What does this skill do? For single-step skills this is the base prompt sent to the AI." rows={3} />
      </div>

      {/* Pipeline Steps Editor */}
      <div className="provider-routing">
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:11 }}>
          <div className="routing-title" style={{ marginBottom:0 }}>⬡ Pipeline Steps — chain multiple AI providers</div>
          <button className="btn btn-xs btn-ghost" onClick={addStep}>⊕ Add Step</button>
        </div>
        {(d.pipeline_steps||[]).length === 0 ? (
          <div style={{ fontSize:11, color:C.dim, textAlign:"center", padding:"10px 0" }}>
            No pipeline steps — skill runs as a single-step using the description above.
            {" "}<span style={{ color:C.accent, cursor:"pointer" }} onClick={addStep}>Add a step →</span>
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            {(d.pipeline_steps||[]).map((step, i) => {
              const pp = PROVIDERS[step.provider] || { color:C.muted, logo:"?" };
              return (
                <div key={i} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:"11px 13px" }}>
                  <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:9 }}>
                    <span style={{ color:pp.color, fontSize:13 }}>{pp.logo}</span>
                    <span style={{ fontSize:11, fontWeight:700, color:C.text }}>Step {i+1}</span>
                    <input className="form-input" value={step.label||""} onChange={e=>setStep(i,"label",e.target.value)}
                      placeholder="Step label" style={{ flex:1, padding:"3px 8px", fontSize:11 }} />
                    <button className="icon-btn" style={{ color:C.red, fontSize:11 }} onClick={()=>removeStep(i)}>✕</button>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:8 }}>
                    <div>
                      <label className="form-label">Provider</label>
                      <select className="form-input" style={{ padding:"4px 8px", fontSize:11 }} value={step.provider||"claude"}
                        onChange={e=>{ setStep(i,"provider",e.target.value); setStep(i,"model",MODELS_BY_PROVIDER[e.target.value]?.[0]||""); }}>
                        {Object.entries(PROVIDERS).map(([k,p])=><option key={k} value={k}>{p.logo} {p.label}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="form-label">Model</label>
                      <select className="form-input" style={{ padding:"4px 8px", fontSize:11 }} value={step.model||""}
                        onChange={e=>setStep(i,"model",e.target.value)}>
                        {(MODELS_BY_PROVIDER[step.provider]||["custom"]).map(m=><option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="form-group" style={{ marginBottom:8 }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
                      <label className="form-label" style={{ marginBottom:0 }}>Prompt Template</label>
                      <PromptEnhancer value={step.prompt_template} onChange={v=>setStep(i,"prompt_template",v)} context="step prompt template" compact />
                    </div>
                    <textarea className="form-input" rows={2} value={step.prompt_template||"{{input}}"}
                      onChange={e=>setStep(i,"prompt_template",e.target.value)}
                      placeholder="Use {{input}} for user input, {{prev}} for previous step output" />
                  </div>
                  <div style={{ display:"flex", gap:10, alignItems:"center" }}>
                    <div className="form-group" style={{ marginBottom:0, flex:1 }}>
                      <label className="form-label">System Prompt (optional)</label>
                      <input className="form-input" style={{ fontSize:11 }} value={step.system_prompt||""} onChange={e=>setStep(i,"system_prompt",e.target.value)}
                        placeholder="Override system prompt for this step…" />
                    </div>
                    <div style={{ flexShrink:0, paddingTop:14 }}>
                      <label style={{ display:"flex", alignItems:"center", gap:5, fontSize:10, color:C.muted, cursor:"pointer" }}>
                        <Toggle on={!!step.parallel} onChange={()=>setStep(i,"parallel",!step.parallel)} />
                        Run in parallel
                      </label>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {(d.pipeline_steps||[]).length > 0 && (
          <div style={{ fontSize:10, color:C.muted, marginTop:8 }}>
            Steps run in sequence by default. Toggle <strong style={{color:C.accent}}>Run in parallel</strong> on consecutive steps to execute them simultaneously.
            Use <code style={{ color:C.accent }}>{"{{prev}}"}</code> for previous output.
          </div>
        )}
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

// ─── SLIDE DECK RENDERER ───────────────────────────────────────────────────
function isSlideOutput(text = "") {
  return text.includes("\n---\n") || text.includes("\n---") || text.startsWith("---");
}

function SlidesDeck({ text }) {
  const rawSlides = text.split(/\n---+\n?/).map(s => s.trim()).filter(Boolean);
  const slides = rawSlides.map(slide => {
    const lines = slide.split("\n");
    // Extract title: first ## or # heading
    const titleLine = lines.find(l => /^#{1,3}\s/.test(l));
    const title = titleLine ? titleLine.replace(/^#{1,3}\s+/, "") : "";
    // Extract notes
    const notesIdx = lines.findIndex(l => /^notes?:/i.test(l));
    const notes = notesIdx >= 0 ? lines.slice(notesIdx).join("\n").replace(/^notes?:\s*/i, "") : "";
    // Body: everything except title line and notes
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

// ─── CHAT PAGE ─────────────────────────────────────────────────────────────
function ChatPage({ agent, agents, onSelectAgent, setAgents, skills, conversations, setConversations }) {
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const msgsRef = useRef([]);
  const convIdRef = useRef(null);

  // Keep msgsRef in sync so send() always has latest history
  useEffect(() => { msgsRef.current = msgs; }, [msgs]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs]);
  useEffect(() => { setMsgs([]); convIdRef.current = null; }, [agent?.id]);

  // Save conversation to Supabase after each AI reply
  useEffect(() => {
    const last = msgs[msgs.length - 1];
    if (!agent || msgs.length === 0 || last?.role === "user") return;
    const save = async () => {
      const title = msgs.find(m=>m.role==="user")?.text?.slice(0,80) || "Conversation";
      const payload = { agent_id: agent.id, agent_name: agent.name, title,
        messages: msgs, message_count: msgs.length, updated_at: new Date().toISOString() };
      if (convIdRef.current) {
        const updated = await supa.patch("conversations", convIdRef.current, payload);
        const item = Array.isArray(updated) ? updated[0] : updated;
        setConversations(p => p.map(c => c.id === convIdRef.current ? { ...c, ...payload } : c));
      } else {
        const created = await supa.post("conversations", payload);
        const item = Array.isArray(created) ? created[0] : created;
        if (item?.id) { convIdRef.current = item.id; setConversations(p => [item, ...p]); }
      }
    };
    save();
  }, [msgs]);

  const agentSkillIds = Array.isArray(agent?.skill_ids) ? agent.skill_ids : [];
  const agentSkills = skills.filter(s => agentSkillIds.includes(s.id));

  const handleFileAttach = async (e) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      const isImage = file.type.startsWith("image/");
      const isPDF   = file.type === "application/pdf";
      const content = await new Promise(res => {
        const reader = new FileReader();
        reader.onload = ev => res(ev.target.result);
        if (isImage || isPDF) reader.readAsDataURL(file); // base64 for binary files
        else reader.readAsText(file);
      });
      setAttachedFiles(p => [...p, { name: file.name, content, type: file.type, isImage, isPDF }]);
    }
    e.target.value = "";
  };

  const exportChat = (format) => {
    const msgs_ = msgsRef.current;
    if (format === "json") {
      downloadJSON(msgs_.map(m => ({ role: m.role, text: m.text || m.final_output, ts: m.ts })), `chat-${agent.name}-${Date.now()}.json`);
    } else {
      const md = [`# Chat with ${agent.name}`, `*Exported ${new Date().toLocaleString()}*`, ""].concat(
        msgs_.map(m => {
          if (m.role === "user") return `**You:** ${m.text}\n`;
          if (m.role === "pipeline") return `**[Pipeline: ${m.skill_name}]**\n${(m.steps_output||[]).map(s=>`- ${s.label}: ${s.output}`).join("\n")}\n`;
          return `**${agent.name}:** ${m.text || m.final_output}\n`;
        })
      ).join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
      a.download = `chat-${agent.name}-${Date.now()}.md`;
      a.click();
    }
  };

  const send = useCallback(async () => {
    if ((!input.trim() && attachedFiles.length === 0) || !agent || loading) return;
    const userMsg = input.trim();
    const history = msgsRef.current;
    const filesSnap = attachedFiles;
    setInput("");
    setAttachedFiles([]);
    setMsgs(m => [...m, { role:"user", text: userMsg || `📎 ${filesSnap.map(f=>f.name).join(", ")}`, ts:new Date() }]);
    setLoading(true);

    // Extract PDF text via /api/pdf (uses Gemini) before building message
    let fullMessage = userMsg;
    if (filesSnap.length > 0) {
      const parts = [];
      for (const f of filesSnap) {
        if (f.isPDF) {
          try {
            setMsgs(m => [...m, { role:"agent", text:`📄 Reading ${f.name}…`, meta:"system", ts:new Date() }]);
            const r = await fetch("/api/pdf", {
              method:"POST", headers:{"Content-Type":"application/json"},
              body: JSON.stringify({ file_data: f.content, mime_type: f.type }),
            });
            const data = await r.json();
            if (r.ok && data.text) {
              parts.push(`--- PDF: ${f.name} ---\n${data.text}\n--- End of ${f.name} ---`);
              // Remove the "reading" status message
              setMsgs(m => m.filter(x => !(x.meta==="system" && x.text?.includes(f.name))));
            } else {
              parts.push(`[PDF: ${f.name} — could not extract text: ${data.error || "unknown error"}]`);
            }
          } catch { parts.push(`[PDF: ${f.name} — extraction failed]`); }
        } else if (f.isImage) {
          parts.push(`[Image attached: ${f.name}]`);
        } else {
          parts.push(`--- File: ${f.name} ---\n${f.content.slice(0, 8000)}\n--- End of ${f.name} ---`);
        }
      }
      fullMessage = parts.join("\n\n") + (userMsg ? `\n\nUser message: ${userMsg}` : "");
    }
    try {
      const result = await routeToAI(agent, fullMessage, history, agentSkills);
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
  }, [input, agent, loading, setAgents, agentSkills]);

  const runSkillPipeline = useCallback(async (skill) => {
    if (!agent || loading) return;
    // Use the last user message as input, or prompt user to type something
    const lastUserMsg = msgsRef.current.filter(m => m.role === "user").slice(-1)[0]?.text || "";
    if (!lastUserMsg) {
      setMsgs(m => [...m, { role:"agent", text:`◈ To run "${skill.name}", send a message first — it will be used as the pipeline input.`, meta:"system", ts:new Date() }]);
      return;
    }
    const steps = Array.isArray(skill.pipeline_steps) && skill.pipeline_steps.length > 0
      ? skill.pipeline_steps
      : [{ label: skill.name, provider: agent.primary_provider, model: agent.primary_model,
           prompt_template: `${skill.description || "Process this:"}\n\n{{input}}`,
           system_prompt: agent.system_prompt }];

    const placeholderIdx = msgsRef.current.length;
    setMsgs(m => [...m, { role:"pipeline", skill_name:skill.name, steps_output:[], loading:true, ts:new Date() }]);
    setLoading(true);
    try {
      const r = await fetch("/api/pipeline", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ steps, input: lastUserMsg, skill_name: skill.name }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || `Pipeline error ${r.status}`);
      setMsgs(m => m.map((msg, i) => i === placeholderIdx
        ? { ...msg, steps_output: data.steps_output, final_output: data.final_output, is_image: data.is_image, loading: false,
            meta: `${data.steps_output.length} step${data.steps_output.length!==1?"s":""} · ${data.total_tokens}tok · ${data.total_latency_ms}ms` }
        : msg
      ));
    } catch(e) {
      setMsgs(m => m.map((msg, i) => i === placeholderIdx
        ? { ...msg, steps_output:[{ label:"Error", output:`⚠ ${e.message}`, error:true }], loading:false }
        : msg
      ));
    } finally { setLoading(false); }
  }, [agent, loading, agentSkills]);

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

  const agentConvs = conversations.filter(c => c.agent_id === agent?.id).slice(0, 30);

  return (
    <div className="chat-wrap slide-in" style={{ flexDirection:"row", padding:0 }}>
      {/* History sidebar */}
      {showHistory && (
        <div style={{ width:220, flexShrink:0, borderRight:`1px solid ${C.border}`, display:"flex", flexDirection:"column", background:C.surface, overflowY:"auto" }}>
          <div style={{ padding:"10px 12px", borderBottom:`1px solid ${C.border}`, fontWeight:700, fontSize:11, color:C.muted, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            HISTORY
            <button className="icon-btn" onClick={()=>setShowHistory(false)}>✕</button>
          </div>
          <button className="nav-item" style={{ margin:"6px 8px", borderRadius:6, border:`1px dashed ${C.border}`, justifyContent:"center", color:C.accent }}
            onClick={()=>{ setMsgs([]); convIdRef.current=null; }}>
            + New Chat
          </button>
          {agentConvs.length === 0 && <div style={{ padding:"20px 12px", color:C.dim, fontSize:11, textAlign:"center" }}>No past conversations yet</div>}
          {agentConvs.map(c => (
            <div key={c.id} onClick={()=>{ setMsgs(Array.isArray(c.messages)?c.messages:[]); convIdRef.current=c.id; setShowHistory(false); }}
              style={{ padding:"8px 12px", cursor:"pointer", borderBottom:`1px solid ${C.border}30`, borderLeft: convIdRef.current===c.id ? `2px solid ${C.accent}` : "2px solid transparent" }}>
              <div style={{ fontSize:11, fontWeight:600, color:C.text, marginBottom:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{c.title||"Untitled"}</div>
              <div style={{ fontSize:10, color:C.dim }}>{c.message_count||0} messages · {relative(c.updated_at||c.created_at)}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{ flex:1, display:"flex", flexDirection:"column", minWidth:0 }}>
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
        <button className="btn btn-ghost btn-sm" onClick={()=>setShowHistory(h=>!h)} title="Chat history">🕐 History</button>
        {msgs.length > 0 && (<>
          <div style={{ position:"relative" }}>
            <button className="btn btn-ghost btn-sm" id="export-chat-btn" onClick={() => { const m=document.getElementById("export-chat-menu"); m.style.display=m.style.display==="none"?"block":"none"; }}>↓ Export</button>
            <div id="export-chat-menu" style={{ display:"none", position:"absolute", right:0, top:"110%", background:C.card, border:`1px solid ${C.border}`, borderRadius:7, padding:4, minWidth:140, zIndex:9999 }}>
              <button className="nav-item" style={{ width:"100%", margin:0 }} onClick={()=>{ exportChat("md"); document.getElementById("export-chat-menu").style.display="none"; }}>📄 Markdown</button>
              <button className="nav-item" style={{ width:"100%", margin:0 }} onClick={()=>{ exportChat("json"); document.getElementById("export-chat-menu").style.display="none"; }}>{ } JSON</button>
              <button className="nav-item" style={{ width:"100%", margin:0 }} onClick={()=>{ window.print(); document.getElementById("export-chat-menu").style.display="none"; }}>🖨 Print / PDF</button>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => { setMsgs([]); convIdRef.current=null; }}>Clear</button>
        </>)}
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
            {m.role === "pipeline" ? (
              <div className="pipeline-card">
                <div className="pipeline-header">
                  <span style={{ color:C.purple }}>◈</span>
                  <span style={{ fontWeight:700 }}>{m.skill_name}</span>
                  {m.loading && <Spinner />}
                  {!m.loading && m.meta && <span style={{ color:C.muted, fontSize:10, marginLeft:"auto" }}>{m.meta}</span>}
                </div>
                {(m.steps_output||[]).map((step, si) => (
                  <div key={si} className={`pipeline-step${step.error?" pipeline-step-error":""}`}>
                    <div className="pipeline-step-label">
                      <span style={{ color:PROVIDERS[step.provider]?.color||C.muted }}>{PROVIDERS[step.provider]?.logo||"?"}</span>
                      {step.label}
                      <span style={{ marginLeft:"auto", fontSize:10, color:C.muted }}>{step.provider} · {step.latency_ms}ms</span>
                    </div>
                    {step.is_image
                      ? <img src={step.output} alt="Generated" style={{ maxWidth:"100%", borderRadius:6, marginTop:6 }} />
                      : (step.provider === "notebooklm" && step.model === "notebooklm-slides") || isSlideOutput(step.output)
                        ? <SlidesDeck text={step.output} />
                        : <div className="pipeline-step-output">{step.output}</div>
                    }
                  </div>
                ))}
              </div>
            ) : m.role === "agent" && isSlideOutput(m.text) ? (
              <div className="pipeline-card" style={{ borderLeft:`3px solid ${C.accent}` }}>
                <div className="pipeline-header" style={{ marginBottom:8 }}>
                  <span style={{ color:C.accent }}>⬡</span> Presentation
                </div>
                <SlidesDeck text={m.text} />
              </div>
            ) : (
              <div className={`msg msg-${m.role}`}>{m.text}</div>
            )}
            {m.meta && m.role !== "pipeline" && (
              <div className="msg-meta" style={{ justifyContent:m.role==="user"?"flex-end":"flex-start" }}>
                {m.meta==="error"||m.meta==="system" ? <span style={{ color:m.meta==="error"?C.red:C.muted }}>{m.meta==="error"?"error":""}</span> : m.meta}
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

      {agentSkills.length > 0 && (
        <div style={{ padding:"7px 18px", borderTop:`1px solid ${C.border}`, display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", background:C.surface }}>
          <span style={{ fontSize:9, color:C.dim, letterSpacing:".1em", textTransform:"uppercase", marginRight:2 }}>Skills</span>
          {agentSkills.map(skill => {
            const cc = CAT_COLORS[skill.category]||C.muted;
            const hasSteps = Array.isArray(skill.pipeline_steps) && skill.pipeline_steps.length > 0;
            return (
              <button key={skill.id} className="btn btn-xs"
                onClick={() => runSkillPipeline(skill)} disabled={loading}
                style={{ color:cc, border:`1px solid ${cc}40`, background:`${cc}0d` }}
                title={skill.description}>
                {hasSteps ? "⬡" : "◈"} {skill.name}
                {hasSteps && <span style={{ fontSize:9, opacity:.7, marginLeft:3 }}>·{skill.pipeline_steps.length}</span>}
              </button>
            );
          })}
        </div>
      )}

      {attachedFiles.length > 0 && (
        <div className="file-chips">
          {attachedFiles.map((f, i) => (
            <div key={i} className="file-chip">
              <span>{f.isImage ? "🖼" : "📄"}</span>
              <span className="file-chip-name">{f.name}</span>
              <button onClick={() => setAttachedFiles(p => p.filter((_,idx)=>idx!==i))}
                style={{ background:"none", border:"none", color:C.muted, cursor:"pointer", fontSize:11, padding:0, flexShrink:0 }}>✕</button>
            </div>
          ))}
        </div>
      )}

      <input ref={fileInputRef} type="file" style={{ display:"none" }} multiple
        accept=".txt,.md,.json,.csv,.pdf,.js,.py,.ts,.jsx,.tsx,.html,.css,.xml,.yaml,.yml,image/*"
        onChange={handleFileAttach} />

      <div className="chat-input-row">
        <button className="btn btn-ghost btn-sm" style={{ alignSelf:"flex-end", flexShrink:0 }} title="Attach PDF, image, or text file"
          onClick={() => fileInputRef.current?.click()}>📎</button>
        <input ref={fileInputRef} type="file" style={{ display:"none" }} multiple
          accept=".pdf,.txt,.md,.csv,.json,image/*"
          onChange={handleFileAttach} />
        <textarea ref={inputRef} className="chat-input" rows={2} value={input}
          placeholder={`Message ${agent.name}… (Enter to send, Shift+Enter for new line)`}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key==="Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="btn btn-primary" onClick={send} disabled={loading || (!input.trim() && attachedFiles.length === 0)} style={{ alignSelf:"flex-end" }}>
          {loading ? <Spinner /> : "Send ↑"}
        </button>
      </div>
      </div>{/* end inner flex col */}
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
const ENV_KEY_DEFS = [
  { env:"ANTHROPIC_API_KEY",  provider:"claude",     label:"Claude (Anthropic)", logo:"◆", color:"#d97706", hint:"sk-ant-api03-...", where:"console.anthropic.com → API Keys" },
  { env:"GEMINI_API_KEY",     provider:"gemini",     label:"Google Gemini / Imagen / NotebookLM / Veo", logo:"✦", color:"#4285f4", hint:"AIzaSy...", where:"aistudio.google.com → Get API key" },
  { env:"OPENROUTER_API_KEY", provider:"openrouter", label:"OpenRouter (300+ models, free + paid)", logo:"⊛", color:"#7c3aed", hint:"sk-or-v1-...", where:"openrouter.ai/keys" },
  { env:"DEEPSEEK_API_KEY",   provider:"deepseek",   label:"DeepSeek", logo:"◉", color:"#10b981", hint:"sk-...", where:"platform.deepseek.com → API keys" },
  { env:"OPENAI_API_KEY",     provider:"openai",     label:"OpenAI (GPT-4, o3, DALL-E)", logo:"⊕", color:"#74aa9c", hint:"sk-proj-...", where:"platform.openai.com/api-keys" },
  { env:"GROQ_API_KEY",       provider:"groq",       label:"Groq (ultra-fast Llama / Mixtral)", logo:"◧", color:"#f55036", hint:"gsk_...", where:"console.groq.com/keys" },
  { env:"MISTRAL_API_KEY",    provider:"mistral",    label:"Mistral AI", logo:"◐", color:"#ff7000", hint:"...", where:"console.mistral.ai/api-keys" },
  { env:"COHERE_API_KEY",     provider:"cohere",     label:"Cohere", logo:"◑", color:"#39594d", hint:"...", where:"dashboard.cohere.com/api-keys" },
  { env:"CUSTOM_API_KEY",     provider:"custom",     label:"Custom Provider", logo:"✳", color:"#8b5cf6", hint:"your key", where:"Your provider's dashboard" },
  { env:"CUSTOM_API_URL",     provider:"custom",     label:"Custom API Base URL", logo:"🌐", color:"#64748b", hint:"https://...", where:"Your provider's docs" },
];

function ApiKeysPage() {
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(false);

  const checkStatus = async () => {
    setChecking(true);
    try {
      const r = await fetch("/api/status");
      const data = await r.json();
      setStatus(data.providers || {});
    } catch {
      setStatus({});
    } finally { setChecking(false); }
  };

  return (
    <div className="slide-in" style={{ maxWidth:720 }}>
      {/* How-to banner */}
      <div style={{ background:C.accent+"12", border:`1px solid ${C.accent}30`, borderRadius:10, padding:"14px 16px", marginBottom:22 }}>
        <div style={{ fontWeight:700, fontSize:13, marginBottom:8, color:C.accentHi }}>⚙ How to configure API keys</div>
        <ol style={{ paddingLeft:18, fontSize:12, lineHeight:2, color:C.text }}>
          <li>Open your <strong>Vercel Dashboard</strong> → select the <em>agentops-platform</em> project</li>
          <li>Go to <strong>Settings → Environment Variables</strong></li>
          <li>Add each key using the exact variable name shown below</li>
          <li>Click <strong>Save</strong>, then <strong>Redeploy</strong> the project for changes to take effect</li>
        </ol>
      </div>

      {/* Key reference table */}
      <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:22 }}>
        {ENV_KEY_DEFS.map(k => (
          <div key={k.env} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:9, padding:"12px 14px", display:"flex", alignItems:"flex-start", gap:12 }}>
            <div style={{ width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center", background:k.color+"18", color:k.color, border:`1px solid ${k.color}30`, borderRadius:8, fontSize:15, flexShrink:0 }}>{k.logo}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:600, fontSize:12, marginBottom:3 }}>{k.label}</div>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:C.cyan, background:C.surface, padding:"3px 8px", borderRadius:5, display:"inline-block", marginBottom:4 }}>{k.env}</div>
              <div style={{ fontSize:11, color:C.muted }}>Get it at: <span style={{ color:C.text }}>{k.where}</span></div>
            </div>
            {status && (
              <span style={{ fontSize:10, color:status[k.provider]?C.green:C.dim, background:(status[k.provider]?C.green:C.dim)+"15", padding:"3px 9px", borderRadius:4, fontFamily:"'JetBrains Mono',monospace", flexShrink:0, alignSelf:"center" }}>
                {status[k.provider] ? "✓ SET" : "NOT SET"}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Status checker */}
      <div className="card" style={{ padding:16 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom: status ? 14 : 0 }}>
          <div style={{ fontWeight:700, fontSize:12 }}>◎ Live Connection Status</div>
          <button className="btn btn-primary" onClick={checkStatus} disabled={checking} style={{ fontSize:11, padding:"5px 14px" }}>
            {checking ? "Checking…" : "Check Now"}
          </button>
        </div>
        {status && (
          <div style={{ display:"flex", flexWrap:"wrap", gap:7 }}>
            {Object.entries(PROVIDERS).map(([k,p]) => {
              const isSet = !!status[k];
              return (
                <div key={k} style={{ display:"flex", alignItems:"center", gap:6, padding:"6px 10px", background:C.surface, borderRadius:7, border:`1px solid ${isSet?C.green+"40":C.border}` }}>
                  <span style={{ color:p.color, fontSize:12 }}>{p.logo}</span>
                  <span style={{ fontSize:11, fontWeight:500 }}>{p.label}</span>
                  <span style={{ fontSize:10, color:isSet?C.green:C.dim, fontFamily:"'JetBrains Mono',monospace" }}>{isSet?"ON":"OFF"}</span>
                </div>
              );
            })}
          </div>
        )}
        {!status && <div style={{ fontSize:12, color:C.muted }}>Click "Check Now" to verify which providers are configured on the server.</div>}
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

// ─── CONNECTORS PAGE ───────────────────────────────────────────────────────
const CONNECTOR_TYPES = {
  email:       { label:"Email",        color:"#4285f4", icon:"✉", fields:[{k:"smtp_host",l:"SMTP Host"},{k:"username",l:"Username"},{k:"password",l:"Password / App Key",secret:true},{k:"from_name",l:"From Name"}] },
  whatsapp:    { label:"WhatsApp",     color:"#25d366", icon:"📱", fields:[{k:"phone_number_id",l:"Phone Number ID"},{k:"access_token",l:"Access Token",secret:true},{k:"verify_token",l:"Webhook Verify Token"}] },
  slack:       { label:"Slack",        color:"#4a154b", icon:"💬", fields:[{k:"bot_token",l:"Bot Token",secret:true},{k:"channel",l:"Default Channel"}] },
  webhook:     { label:"Webhook",      color:"#f59e0b", icon:"⚡", fields:[{k:"url",l:"Endpoint URL"},{k:"secret",l:"Secret / Auth Header",secret:true},{k:"method",l:"HTTP Method (GET/POST)"}] },
  github:      { label:"GitHub",       color:"#6e40c9", icon:"⊕", fields:[{k:"token",l:"Personal Access Token",secret:true},{k:"owner",l:"Owner / Org"},{k:"repo",l:"Repository"}] },
  googledrive: { label:"Google Drive", color:"#fbbc04", icon:"▦", fields:[{k:"client_id",l:"Client ID"},{k:"client_secret",l:"Client Secret",secret:true},{k:"refresh_token",l:"Refresh Token",secret:true}] },
  telegram:    { label:"Telegram",     color:"#0088cc", icon:"✈", fields:[{k:"bot_token",l:"Bot Token",secret:true},{k:"chat_id",l:"Chat ID"}] },
  custom:      { label:"Custom API",   color:"#8b5cf6", icon:"✳", fields:[{k:"url",l:"Base URL"},{k:"api_key",l:"API Key",secret:true},{k:"headers",l:"Extra Headers (JSON)"}] },
};

function ConnectorModal({ modal, onSave, onClose, saving }) {
  const [d, setD] = useState(modal.data);
  const set = (k, v) => setD(p => ({ ...p, [k]: v }));
  const setConf = (k, v) => setD(p => ({ ...p, config: { ...(p.config||{}), [k]: v } }));
  const ct = CONNECTOR_TYPES[d.type] || CONNECTOR_TYPES.custom;
  return (
    <Modal title={`${modal.mode==="add"?"New":"Edit"} Connector`} onClose={onClose}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        <div className="form-group" style={{ gridColumn:"span 2" }}>
          <label className="form-label">Name</label>
          <input className="form-input" value={d.name||""} onChange={e=>set("name",e.target.value)} placeholder="e.g. My WhatsApp Bot" autoFocus />
        </div>
        <div className="form-group">
          <label className="form-label">Type</label>
          <select className="form-input" value={d.type||"webhook"} onChange={e=>set("type",e.target.value)}>
            {Object.entries(CONNECTOR_TYPES).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Status</label>
          <select className="form-input" value={d.status||"inactive"} onChange={e=>set("status",e.target.value)}>
            {["active","inactive","error"].map(s=><option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>
      {ct.fields.map(f => (
        <div key={f.k} className="form-group">
          <label className="form-label">{f.l}</label>
          <input className="form-input" type={f.secret?"password":"text"}
            value={(d.config||{})[f.k]||""} onChange={e=>setConf(f.k,e.target.value)} placeholder={`Enter ${f.l}…`} />
        </div>
      ))}
      <div className="form-group">
        <label className="form-label">Notes</label>
        <textarea className="form-input" rows={2} value={d.notes||""} onChange={e=>set("notes",e.target.value)} placeholder="Purpose, linked agents, instructions…" />
      </div>
      <div style={{ display:"flex", justifyContent:"flex-end", gap:9, marginTop:12 }}>
        <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={()=>onSave(d)} disabled={saving || !d.name?.trim()}>
          {saving ? <Spinner /> : modal.mode==="add" ? "Add Connector" : "Save"}
        </button>
      </div>
    </Modal>
  );
}

function ConnectorsPage({ connectors, setConnectors, loading }) {
  const [modal, setModal] = useState(null);
  const [del, setDel] = useState(null);
  const [saving, setSaving] = useState(false);
  const blank = { name:"", type:"webhook", status:"inactive", config:{}, notes:"" };

  const save = async (d) => {
    if (!d.name?.trim()) return;
    setSaving(true);
    try {
      if (modal.mode === "add") {
        const created = await supa.post("connectors", d);
        const item = Array.isArray(created) ? created[0] : created;
        setConnectors(p => [...p, item?.id ? item : { ...d, id:Date.now(), created_at:new Date().toISOString() }]);
      } else {
        const updated = await supa.patch("connectors", d.id, d);
        const item = Array.isArray(updated) ? updated[0] : updated;
        setConnectors(p => p.map(x => x.id===d.id ? (item?.id ? item : d) : x));
      }
    } finally { setSaving(false); setModal(null); }
  };

  const doDelete = async () => {
    await supa.delete("connectors", del.id);
    setConnectors(p => p.filter(x => x.id !== del.id));
    setDel(null);
  };

  if (loading) return <div style={{ textAlign:"center", padding:"60px 0", color:C.muted }}><Spinner /></div>;

  return (
    <div className="slide-in">
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <div style={{ fontSize:12, color:C.muted }}>Connect external services so agents can read, write, and act on your data.</div>
        <button className="btn btn-primary" onClick={()=>setModal({ mode:"add", data:{ ...blank } })}>⊕ Add Connector</button>
      </div>

      {connectors.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">⌘</div>
          <div className="empty-text">No connectors yet.<br/>Add your first integration to get started.</div>
        </div>
      ) : (
        <div className="connector-grid">
          {connectors.map(c => {
            const ct = CONNECTOR_TYPES[c.type] || CONNECTOR_TYPES.custom;
            const statusColor = c.status==="active"?C.green:c.status==="error"?C.red:C.muted;
            return (
              <div key={c.id} className="connector-card" style={{ "--tc": ct.color }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:8 }}>
                  <div>
                    <span style={{ fontSize:9, padding:"2px 7px", borderRadius:3, fontWeight:700, textTransform:"uppercase", letterSpacing:".06em", background:ct.color+"18", color:ct.color, border:`1px solid ${ct.color}28`, display:"inline-flex", alignItems:"center", gap:4, marginBottom:6 }}>
                      {ct.icon} {ct.label}
                    </span>
                    <div style={{ fontFamily:"'Syne',sans-serif", fontSize:13, fontWeight:800 }}>{c.name}</div>
                  </div>
                  <div style={{ display:"flex", gap:3, alignItems:"center" }}>
                    <span className={`status-dot ${c.status}`} style={{ width:7, height:7, background:statusColor, boxShadow: c.status==="active"?`0 0 7px ${C.green}`:undefined }} />
                    <button className="icon-btn" onClick={()=>setModal({ mode:"edit", data:{ ...c } })}>✎</button>
                    <button className="icon-btn" style={{ color:C.dim }} onClick={()=>setDel(c)}>⊗</button>
                  </div>
                </div>
                {c.notes && <p style={{ color:C.muted, fontSize:11, lineHeight:1.6, marginBottom:8 }}>{c.notes}</p>}
                <div style={{ fontSize:10, color:C.dim }}>Added {relative(c.created_at)}</div>
              </div>
            );
          })}
        </div>
      )}

      {modal && <ConnectorModal modal={modal} onSave={save} onClose={()=>setModal(null)} saving={saving} />}
      {del && (
        <Modal title="Delete Connector" onClose={()=>setDel(null)}>
          <p style={{ color:C.muted, marginBottom:18 }}>Delete connector <span style={{ color:C.red }}>{del.name}</span>?</p>
          <div style={{ display:"flex", justifyContent:"flex-end", gap:9 }}>
            <button className="btn btn-ghost" onClick={()=>setDel(null)}>Cancel</button>
            <button className="btn btn-danger" onClick={doDelete}>Delete</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── AUDIT LOG PAGE ────────────────────────────────────────────────────────
function AuditLogPage() {
  const [logs, setLogs] = useState([]);
  useEffect(() => {
    const handler = (e) => setLogs(p => [e.detail, ...p].slice(0, 300));
    window.addEventListener("agentops_audit", handler);
    return () => window.removeEventListener("agentops_audit", handler);
  }, []);

  const opColor = { SAVE:C.green, UPDATE:C.cyan, DELETE:C.red, LOAD:C.muted, ENHANCE:C.purple };
  return (
    <div className="slide-in">
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
        <div style={{ fontSize:12, color:C.muted }}>Live log of all database operations. Shows saves, updates, deletes and errors.</div>
        <button className="btn btn-ghost btn-sm" onClick={()=>setLogs([])}>Clear</button>
      </div>
      {logs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">▦</div>
          <div className="empty-text">No activity yet.<br/>Save an agent or skill to see entries here.</div>
        </div>
      ) : (
        <div className="run-log">
          {logs.map((l, i) => (
            <div key={i} className="audit-row">
              <span style={{ color: l.status==="error" ? C.red : C.green, fontSize:13, flexShrink:0 }}>
                {l.status==="error" ? "⚠" : "✓"}
              </span>
              <span style={{ color: opColor[l.op] || C.muted, fontWeight:700, fontSize:11, minWidth:60 }}>{l.op}</span>
              <span style={{ color:C.text, fontSize:11 }}>{l.table}</span>
              {l.detail && <span style={{ color:C.muted, fontSize:10 }}>{l.detail}</span>}
              <span style={{ marginLeft:"auto", color:C.dim, fontSize:10 }}>{relative(l.ts)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── HELP PAGE ────────────────────────────────────────────────────────────
function HelpPage() {
  const S = { card:{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:"16px 18px", marginBottom:14 },
    h:{ fontFamily:"'Syne',sans-serif", fontSize:13, fontWeight:800, marginBottom:10, color:C.accentHi },
    h2:{ fontSize:12, fontWeight:700, color:C.text, marginBottom:5, marginTop:10 },
    p:{ fontSize:12, color:C.muted, lineHeight:1.8, marginBottom:6 },
    tag:{ display:"inline-block", fontSize:10, padding:"2px 8px", borderRadius:4, fontFamily:"'JetBrains Mono',monospace", marginRight:5, marginBottom:3 }};

  return (
    <div className="slide-in" style={{ maxWidth:760 }}>

      <div style={S.card}>
        <div style={S.h}>⬡ Agents — what they are</div>
        <p style={S.p}>An <strong>Agent</strong> is an AI assistant you configure. Each agent has a name, a personality (persona), one or more AI providers, and a system prompt that tells it how to behave.</p>
        <p style={{...S.p, marginBottom:0}}>Agents can have <strong>Skills</strong> assigned to them. When you chat with an agent, it knows about its skills and can use them.</p>
        <div style={S.h2}>Personas</div>
        <p style={S.p}>
          <span style={{...S.tag, background:C.cyan+"15", color:C.cyan}}>◎ Researcher</span> — deep analysis, citations, reports<br/>
          <span style={{...S.tag, background:"#ef444415", color:"#ef4444"}}>⬟ Guardian</span> — compliance, security, risk review<br/>
          <span style={{...S.tag, background:C.purple+"15", color:C.purple}}>⌘ Connector</span> — integrations, data pipelines, external APIs<br/>
          <span style={{...S.tag, background:"#f59e0b15", color:"#f59e0b"}}>◈ Strategist</span> — planning, decisions, roadmaps<br/>
          <span style={{...S.tag, background:C.accent+"15", color:C.accent}}>⬡ Architect</span> — system design, technical structure<br/>
          <span style={{...S.tag, background:C.green+"15", color:C.green}}>⚙ Engineer</span> — code, automation, technical tasks
        </p>
        <div style={S.h2}>Quick Create an Agent</div>
        <p style={S.p}>Go to <strong>Agents → + New Agent</strong>. Minimum required: just a <em>name</em> and select a <em>provider</em>. Everything else is optional — the agent will still work with defaults.</p>
        <p style={S.p}>💡 Tip: Use the <strong>✨ Enhance</strong> button on the System Prompt to let AI improve your instructions automatically.</p>
      </div>

      <div style={S.card}>
        <div style={S.h}>◈ Skills — what they are</div>
        <p style={S.p}>A <strong>Skill</strong> is a reusable task or prompt that an agent can run. Skills appear as quick-action buttons in the chat window.</p>
        <div style={S.h2}>Single-step skill</div>
        <p style={S.p}>Fills in the Description field as a prompt. The agent runs it once and returns the result. Good for: summarisation, translation, formatting, tone rewriting.</p>
        <div style={S.h2}>Pipeline skill (multi-step)</div>
        <p style={S.p}>Chains multiple AI steps together. Each step can use a different provider/model. Use <code>{"{{input}}"}</code> for the user's message and <code>{"{{prev}}"}</code> for the previous step's output.</p>
        <p style={S.p}>Example pipeline: Step 1 (DeepSeek) → research the topic → Step 2 (NotebookLM) → format as slides → Step 3 (Claude) → write executive summary.</p>
      </div>

      <div style={S.card}>
        <div style={S.h}>⌘ Connectors — what they are</div>
        <p style={S.p}>Connectors are external services your agents can interact with: WhatsApp, Slack, Email, GitHub, Google Drive, Telegram, webhooks, and custom APIs.</p>
        <p style={S.p}>Currently the Connectors page lets you <strong>register and configure</strong> the connection details (tokens, URLs, bot keys). The agent uses these connection details when you include the connector in its workflow.</p>
        <p style={S.p}>Think of them as the "phone numbers" your agent knows — you store the connection info once, then assign the connector to an agent.</p>
      </div>

      <div style={S.card}>
        <div style={S.h}>💬 Chat — how to use it</div>
        <div style={S.h2}>Sending messages</div>
        <p style={S.p}>Select an agent from the dropdown at the top. Type and press <strong>Enter</strong>. The agent remembers the full conversation history (multi-turn).</p>
        <div style={S.h2}>Attaching PDFs</div>
        <p style={S.p}>Click 📎 and select a PDF, image, or text file. PDFs are automatically read using Gemini (requires <code>GEMINI_API_KEY</code> in Vercel). The extracted text is included in your message to any provider.</p>
        <div style={S.h2}>Chat history</div>
        <p style={S.p}>Click <strong>🕐 History</strong> to see all past conversations with the current agent. Click any conversation to restore it. Each session auto-saves after every AI reply.</p>
        <div style={S.h2}>Exporting</div>
        <p style={S.p}>Click <strong>↓ Export</strong> → choose Markdown, JSON, or <strong>Print / PDF</strong> to save the conversation as a PDF file using your browser's print dialog.</p>
      </div>

      <div style={S.card}>
        <div style={S.h}>⊞ NotebookLM — how it works</div>
        <p style={S.p}>There is <strong>no public API for Google NotebookLM</strong>. In this app, "NotebookLM" is a simulation using <strong>Gemini 2.5 Pro</strong> with specialised research prompts.</p>
        <p style={S.p}>It requires <code>GEMINI_API_KEY</code> in Vercel env vars. The modes:</p>
        <p style={S.p}>
          <span style={{...S.tag, background:C.accent+"15", color:C.accent}}>research</span> Deep report with citations<br/>
          <span style={{...S.tag, background:C.accent+"15", color:C.accent}}>slides</span> Markdown slide deck (--- separators)<br/>
          <span style={{...S.tag, background:C.accent+"15", color:C.accent}}>summary</span> Executive summary + key concepts<br/>
          <span style={{...S.tag, background:C.accent+"15", color:C.accent}}>Q&amp;A</span> 5–8 question/answer pairs<br/>
          <span style={{...S.tag, background:C.accent+"15", color:C.accent}}>podcast</span> Two-host conversational script
        </p>
      </div>

      <div style={S.card}>
        <div style={S.h}>▶ Veo — video generation</div>
        <p style={S.p}>Google Veo 2 generates videos from text prompts. Select <strong>Veo</strong> as a provider in an agent, choose model <code>veo-2.0-generate-001</code>, and describe what you want in the chat.</p>
        <p style={S.p}>Requires <code>GEMINI_API_KEY</code>. Video generation takes 1–3 minutes. The app polls for up to 55 seconds; if it's not ready, it returns an Operation ID you can use to check later.</p>
      </div>

      <div style={S.card}>
        <div style={S.h}>⚙ Setting up API keys</div>
        <p style={S.p}>All API keys live in <strong>Vercel → Settings → Environment Variables</strong>. After adding keys, click <strong>Redeploy</strong>. Use the <strong>API Keys → Check Now</strong> button to verify which providers are live.</p>
        <p style={S.p}>
          <span style={{...S.tag, background:"#d9770615", color:"#d97706"}}>ANTHROPIC_API_KEY</span> Claude — console.anthropic.com<br/>
          <span style={{...S.tag, background:"#4285f415", color:"#4285f4"}}>GEMINI_API_KEY</span> Gemini + Imagen + NotebookLM + Veo — aistudio.google.com<br/>
          <span style={{...S.tag, background:"#7c3aed15", color:"#7c3aed"}}>OPENROUTER_API_KEY</span> 300+ models (free + paid) — openrouter.ai/keys<br/>
          <span style={{...S.tag, background:"#f5503615", color:"#f55036"}}>GROQ_API_KEY</span> Llama/Mixtral (fast &amp; free) — console.groq.com
        </p>
      </div>

    </div>
  );
}

// ─── AI CREATOR WIZARD ────────────────────────────────────────────────────
// Guided AI chat that builds a complete agent or skill config for you.
const CREATOR_SYSTEM = `You are an expert AgentOps setup assistant. Your job is to help the user create a perfectly configured AI agent or skill through friendly conversation.

When creating an AGENT, you need to gather:
- Purpose / what it does
- Industry or domain
- Which AI provider to use (claude, gemini, openai, deepseek, groq, openrouter)
- Tone and style (formal, casual, technical, etc.)
- Any specific skills or tools it should use

When creating a SKILL, you need to gather:
- What task it performs
- Whether it's single-step or multi-step pipeline
- Which providers each step should use

Ask ONE question at a time. Be concise and friendly. When you have enough information (after 3-5 exchanges), output a JSON block wrapped in triple backticks with the key "type": "agent" or "type": "skill" and all required fields. Do not explain the JSON — just output it cleanly.

Agent JSON schema:
\`\`\`json
{"type":"agent","name":"","persona":"researcher","primary_provider":"claude","primary_model":"claude-sonnet-4-6","fallback_provider":"gemini","fallback_model":"gemini-2.0-flash","description":"","system_prompt":"","temperature":0.7,"max_tokens":4096}
\`\`\`

Skill JSON schema:
\`\`\`json
{"type":"skill","name":"","identifier":"","category":"analysis","description":"","output_type":"text","pipeline_steps":[]}
\`\`\`

Start by asking: "What would you like to create — an Agent (AI assistant you can chat with) or a Skill (a reusable task)?"`;

function CreatorPage({ agents, setAgents, skills, setSkills }) {
  const [msgs, setMsgs] = useState([
    { role:"agent", text:"Hi! I'm your AI setup assistant. What would you like to create?\n\n**Agent** — an AI assistant you configure and chat with\n**Skill** — a reusable task or pipeline an agent can run\n\nJust describe what you need and I'll guide you through it.", ts:new Date() }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const bottomRef = useRef(null);
  const msgsRef = useRef(msgs);
  useEffect(() => { msgsRef.current = msgs; }, [msgs]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [msgs]);

  const extractJSON = (text) => {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (!match) return null;
    try { return JSON.parse(match[1].trim()); } catch { return null; }
  };

  const send = async () => {
    if (!input.trim() || loading) return;
    const userText = input.trim();
    setInput("");
    const history = msgsRef.current;
    setMsgs(m => [...m, { role:"user", text:userText, ts:new Date() }]);
    setLoading(true);
    try {
      const r = await fetch("/api/chat", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          provider: "claude", model: "claude-sonnet-4-6",
          system_prompt: CREATOR_SYSTEM,
          messages: [
            ...history.filter(m=>m.role==="user"||m.role==="agent").map(m=>({ role:m.role==="agent"?"assistant":"user", content:m.text })),
            { role:"user", content:userText }
          ],
          max_tokens: 1200, temperature: 0.6,
          fallback_provider: "gemini", fallback_model: "gemini-2.0-flash",
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || `Error ${r.status}`);
      const responseText = data.response || "";
      setMsgs(m => [...m, { role:"agent", text:responseText, ts:new Date() }]);
      const parsed = extractJSON(responseText);
      if (parsed) setPreview(parsed);
    } catch(e) {
      setMsgs(m => [...m, { role:"agent", text:`⚠ ${e.message}`, meta:"error", ts:new Date() }]);
    } finally { setLoading(false); }
  };

  const savePreview = async () => {
    if (!preview) return;
    setSaving(true);
    try {
      if (preview.type === "agent") {
        const payload = {
          name: preview.name, persona: preview.persona || "researcher",
          primary_provider: preview.primary_provider || "claude",
          primary_model: preview.primary_model || "claude-sonnet-4-6",
          fallback_provider: preview.fallback_provider || null,
          fallback_model: preview.fallback_model || null,
          description: preview.description || "",
          system_prompt: preview.system_prompt || "",
          temperature: parseFloat(preview.temperature) || 0.7,
          max_tokens: parseInt(preview.max_tokens) || 4096,
          status: "active", provider_chain: [preview.primary_provider],
          total_runs: 0, total_tokens: 0,
        };
        const created = await supa.post("agents", payload);
        const item = Array.isArray(created)?created[0]:created;
        if (item?.id) setAgents(p => [...p, item]);
      } else {
        const id = preview.identifier || preview.name?.toLowerCase().replace(/\s+/g,"_")||"skill_"+Date.now();
        const payload = {
          name: preview.name, identifier: id,
          category: preview.category || "general",
          description: preview.description || "",
          output_type: preview.output_type || "text",
          pipeline_steps: preview.pipeline_steps || [],
          is_active: true, permissions: "read", rate_limit: 100,
          tags: [], parameters: {},
        };
        const created = await supa.post("skills", payload);
        const item = Array.isArray(created)?created[0]:created;
        if (item?.id) setSkills(p => [...p, item]);
      }
      setSaved(true);
      setTimeout(()=>setSaved(false), 3000);
      setPreview(null);
      setMsgs(m => [...m, { role:"agent", text:`✅ ${preview.type === "agent" ? "Agent" : "Skill"} **${preview.name}** has been saved! You can find it in the ${preview.type === "agent" ? "Agents" : "Skills"} page.\n\nWould you like to create another one?`, ts:new Date() }]);
    } finally { setSaving(false); }
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", maxWidth:720 }}>
      <div style={{ background:C.accent+"12", border:`1px solid ${C.accent}30`, borderRadius:9, padding:"10px 14px", marginBottom:14, fontSize:12, color:C.accentHi, lineHeight:1.6 }}>
        ✨ <strong>AI Creator</strong> — Describe what you need and I'll configure everything for you automatically. Requires Claude or Gemini API key.
      </div>

      <div style={{ flex:1, overflowY:"auto", display:"flex", flexDirection:"column", gap:10, marginBottom:12 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ display:"flex", justifyContent:m.role==="user"?"flex-end":"flex-start" }}>
            <div style={{
              maxWidth:"80%", padding:"10px 14px", borderRadius:m.role==="user"?"12px 12px 4px 12px":"12px 12px 12px 4px",
              background:m.role==="user"?C.accent:C.card, color:m.meta==="error"?C.red:C.text,
              border:`1px solid ${m.role==="user"?C.accent:C.border}`, fontSize:12, lineHeight:1.7,
              whiteSpace:"pre-wrap"
            }}>{m.text}</div>
          </div>
        ))}
        {loading && <div style={{ color:C.muted, fontSize:12 }}><Spinner /> Thinking…</div>}
        <div ref={bottomRef} />
      </div>

      {preview && (
        <div style={{ background:C.green+"0f", border:`1px solid ${C.green}30`, borderRadius:9, padding:"12px 14px", marginBottom:12 }}>
          <div style={{ fontWeight:700, fontSize:12, color:C.green, marginBottom:8 }}>
            ✓ Ready to save: {preview.type === "agent" ? "Agent" : "Skill"} — <strong>{preview.name}</strong>
          </div>
          <div style={{ fontSize:11, color:C.muted, marginBottom:10, lineHeight:1.6 }}>
            {preview.type === "agent"
              ? `Provider: ${preview.primary_provider} (${preview.primary_model}) · Fallback: ${preview.fallback_provider||"none"}`
              : `Category: ${preview.category} · Type: ${preview.output_type}`}
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button className="btn btn-primary" onClick={savePreview} disabled={saving}>
              {saving ? <Spinner /> : saved ? "✓ Saved!" : `Save ${preview.type === "agent" ? "Agent" : "Skill"}`}
            </button>
            <button className="btn btn-ghost" onClick={()=>setPreview(null)}>Dismiss</button>
          </div>
        </div>
      )}

      <div style={{ display:"flex", gap:8 }}>
        <textarea className="chat-input" rows={2} value={input}
          placeholder="Describe your agent or skill… (Enter to send)"
          onChange={e=>setInput(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter"&&!e.shiftKey){ e.preventDefault(); send(); } }}
          style={{ flex:1 }} />
        <button className="btn btn-primary" onClick={send} disabled={loading||!input.trim()} style={{ alignSelf:"flex-end" }}>
          {loading?<Spinner />:"Send ↑"}
        </button>
      </div>
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────
const NAV = [
  { id:"command",    icon:"◎", label:"Command Center", group:"main" },
  { id:"agents",     icon:"⬡", label:"Agents",         group:"main", countKey:"agents" },
  { id:"skills",     icon:"◈", label:"Skills",          group:"main", countKey:"skills" },
  { id:"connectors", icon:"⌘", label:"Connectors",      group:"main", countKey:"connectors" },
  { id:"chat",       icon:"💬", label:"Chat",            group:"main" },
  { id:"runs",       icon:"▶", label:"Run History",     group:"data", countKey:"runs" },
  { id:"audit",      icon:"▦", label:"Audit Log",       group:"data" },
  { id:"database",   icon:"⬟", label:"Database",        group:"data" },
  { id:"apikeys",    icon:"🔑", label:"API Keys",        group:"data" },
  { id:"creator",    icon:"✨", label:"AI Creator",      group:"main" },
  { id:"help",       icon:"?", label:"Help & Guide",    group:"data" },
];

export default function App() {
  const [page, setPage] = useState("command");
  const [agents, setAgents] = useState([]);
  const [skills, setSkills] = useState([]);
  const [runs, setRuns] = useState([]);
  const [connectors, setConnectors] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [chatAgent, setChatAgent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [providerStatus, setProviderStatus] = useState({ claude:false, gemini:false, deepseek:false });

  const loadData = async () => {
    setLoading(true);
    const [a, s, r, cn, cv] = await Promise.all([
      supa.get("agents",        "order=created_at.asc"),
      supa.get("skills",        "order=created_at.asc"),
      supa.get("agent_runs",    "order=started_at.desc&limit=200"),
      supa.get("connectors",    "order=created_at.asc"),
      supa.get("conversations", "order=updated_at.desc&limit=100"),
    ]);
    setAgents(Array.isArray(a)?a:[]);
    setSkills(Array.isArray(s)?s:[]);
    setRuns(Array.isArray(r)?r:[]);
    setConnectors(Array.isArray(cn)?cn:[]);
    setConversations(Array.isArray(cv)?cv:[]);
    if (!chatAgent && Array.isArray(a) && a.length>0) setChatAgent(a[0]);
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const goChat = (agent) => { setChatAgent(agent); setPage("chat"); };

  const counts = { agents:agents.length, skills:skills.length, runs:runs.length, connectors:connectors.length };

  return (
    <>
      <style>{STYLES}</style>
      <ToastProvider />
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
              {page==="command"    && <CommandCenter agents={agents} skills={skills} runs={runs} onChat={goChat} />}
              {page==="agents"    && <AgentsPage agents={agents} setAgents={setAgents} skills={skills} onChat={goChat} loading={loading} />}
              {page==="skills"    && <SkillsPage skills={skills} setSkills={setSkills} loading={loading} />}
              {page==="connectors"&& <ConnectorsPage connectors={connectors} setConnectors={setConnectors} loading={loading} />}
              {page==="audit"     && <AuditLogPage />}
              {page==="runs"      && <RunHistoryPage runs={runs} agents={agents} />}
              {page==="help"      && <HelpPage />}
              {page==="database"  && <DatabasePage agents={agents} skills={skills} runs={runs} />}
              {page==="apikeys"   && <ApiKeysPage />}
              {page==="creator"   && <CreatorPage agents={agents} setAgents={setAgents} skills={skills} setSkills={setSkills} />}
            </div>
          )}

          {page === "chat" && (
            <ChatPage
              agent={chatAgent}
              agents={agents}
              onSelectAgent={a=>{ setChatAgent(a); }}
              setAgents={setAgents}
              skills={skills}
              conversations={conversations}
              setConversations={setConversations}
            />
          )}
        </div>
      </div>
    </>
  );
}
