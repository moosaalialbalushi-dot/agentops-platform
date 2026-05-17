import React, { useState, useEffect, useRef } from "react";
import { C } from "../lib/constants";
import { db, Agent, Skill } from "../lib/supabase";
import { Spinner } from "../components/ui/AgentOpsSpinner";

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
{"type":"agent","name":"","persona":"researcher","primary_provider":"claude","primary_model":"claude-sonnet-4-6","fallback_provider":"gemini","fallback_model":"gemini-2.5-flash-preview-05-20","description":"","system_prompt":"","temperature":0.7,"max_tokens":4096}
\`\`\`

Skill JSON schema:
\`\`\`json
{"type":"skill","name":"","identifier":"","category":"analysis","description":"","output_type":"text","pipeline_steps":[]}
\`\`\`

Start by asking: "What would you like to create — an Agent (AI assistant you can chat with) or a Skill (a reusable task)?"`;

interface CreatorPageProps {
  agents: Agent[];
  setAgents: React.Dispatch<React.SetStateAction<Agent[]>>;
  skills: Skill[];
  setSkills: React.Dispatch<React.SetStateAction<Skill[]>>;
}

export function CreatorPage({ setAgents, setSkills }: CreatorPageProps) {
  const [msgs, setMsgs] = useState<any[]>([
    { role: "agent", text: "Hi! I'm your AI setup assistant. What would you like to create?\n\n**Agent** — an AI assistant you configure and chat with\n**Skill** — a reusable task or pipeline an agent can run\n\nJust describe what you need and I'll guide you through it.", ts: new Date() }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const msgsRef = useRef(msgs);
  useEffect(() => { msgsRef.current = msgs; }, [msgs]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  const extractJSON = (text: string) => {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (!match) return null;
    try { return JSON.parse(match[1].trim()); } catch { return null; }
  };

  const send = async () => {
    if (!input.trim() || loading) return;
    const userText = input.trim();
    setInput("");
    const history = msgsRef.current;
    setMsgs(m => [...m, { role: "user", text: userText, ts: new Date() }]);
    setLoading(true);
    const chatMessages = [
      ...history.filter(m => m.role === "user" || m.role === "agent").map(m => ({ role: m.role === "agent" ? "assistant" : "user", content: m.text })),
      { role: "user", content: userText }
    ];
    const attempts = [
      { provider: "claude", model: "claude-sonnet-4-6" },
      { provider: "gemini", model: "gemini-2.5-flash-preview-05-20" },
      { provider: "zhipu", model: "glm-4-flash" },
    ];
    let responseText = "";
    let lastErr = "";
    for (const attempt of attempts) {
      try {
        const r = await fetch("/api/chat", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider: attempt.provider, model: attempt.model,
            system_prompt: CREATOR_SYSTEM,
            messages: chatMessages,
            max_tokens: 1200, temperature: 0.6,
          }),
        });
        const data = await r.json();
        if (!r.ok) { lastErr = data?.error || `Error ${r.status}`; continue; }
        responseText = data.data?.response || data.response || "";
        break;
      } catch (e: any) { lastErr = e.message; }
    }
    try {
      if (!responseText) throw new Error(lastErr || "All providers failed. Check your API keys.");
      setMsgs(m => [...m, { role: "agent", text: responseText, ts: new Date() }]);
      const parsed = extractJSON(responseText);
      if (parsed) setPreview(parsed);
    } catch (e: any) {
      setMsgs(m => [...m, { role: "agent", text: `⚠ ${e.message}`, meta: "error", ts: new Date() }]);
    } finally { setLoading(false); }
  };

  const savePreview = async () => {
    if (!preview) return;
    setSaving(true);
    try {
      if (preview.type === "agent") {
        const payload: Partial<Agent> = {
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
        const { data: item } = await db.agents.create(payload);
        if (item) setAgents(p => [...p, item]);
      } else {
        const id = preview.identifier || preview.name?.toLowerCase().replace(/\s+/g, "_") || "skill_" + Date.now();
        const payload: Partial<Skill> = {
          name: preview.name, identifier: id,
          category: preview.category || "general",
          description: preview.description || "",
          output_type: preview.output_type || "text",
          pipeline_steps: preview.pipeline_steps || [],
          is_active: true, permissions: "read", rate_limit: 100,
          tags: [], parameters: {},
        };
        const { data: item } = await db.skills.create(payload);
        if (item) setSkills(p => [...p, item]);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      setPreview(null);
      setMsgs(m => [...m, { role: "agent", text: `✅ ${preview.type === "agent" ? "Agent" : "Skill"} **${preview.name}** has been saved! You can find it in the ${preview.type === "agent" ? "Agents" : "Skills"} page.\n\nWould you like to create another one?`, ts: new Date() }]);
    } finally { setSaving(false); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", maxWidth: 720 }}>
      <div style={{ background: C.accent + "12", border: `1px solid ${C.accent}30`, borderRadius: 9, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: C.accentHi, lineHeight: 1.6 }}>
        ✨ <strong>AI Creator</strong> — Describe what you need and I'll configure everything for you automatically. Requires Claude or Gemini API key.
      </div>

      <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{
              maxWidth: "80%", padding: "10px 14px", borderRadius: m.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
              background: m.role === "user" ? C.accent : C.card, color: (m as any).meta === "error" ? C.red : C.text,
              border: `1px solid ${m.role === "user" ? C.accent : C.border}`, fontSize: 12, lineHeight: 1.7,
              whiteSpace: "pre-wrap"
            } as React.CSSProperties}>{m.text}</div>
          </div>
        ))}
        {loading && <div style={{ color: C.muted, fontSize: 12 }}><Spinner /> Thinking…</div>}
        <div ref={bottomRef} />
      </div>

      {preview && (
        <div style={{ background: C.green + "0f", border: `1px solid ${C.green}30`, borderRadius: 9, padding: "10px 14px", marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 12, color: C.green, marginBottom: 8 }}>
            ✓ Ready to save: {preview.type === "agent" ? "Agent" : "Skill"} — <strong>{preview.name}</strong>
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 10, lineHeight: 1.6 }}>
            {preview.type === "agent"
              ? `Provider: ${preview.primary_provider} (${preview.primary_model}) · Fallback: ${preview.fallback_provider || "none"}`
              : `Category: ${preview.category} · Type: ${preview.output_type}`}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={savePreview} disabled={saving}>
              {saving ? <Spinner /> : saved ? "✓ Saved!" : `Save ${preview.type === "agent" ? "Agent" : "Skill"}`}
            </button>
            <button className="btn btn-ghost" onClick={() => setPreview(null)}>Dismiss</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <textarea className="chat-input" rows={2} value={input}
          placeholder="Describe your agent or skill… (Enter to send)"
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={send} disabled={loading || !input.trim()} style={{ alignSelf: "flex-end" }}>
          {loading ? <Spinner /> : "Send ↑"}
        </button>
      </div>
    </div>
  );
}
