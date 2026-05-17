import React, { useState, useEffect, useCallback, useRef } from "react";
import { C, PERSONAS, PROVIDERS, CAT_COLORS } from "../lib/constants";
import { routeToAI, downloadJSON, relative } from "../lib/utils";
import { db, Agent, Skill } from "../lib/supabase";
import { Spinner } from "../components/ui/AgentOpsSpinner";
import { ProviderBadge } from "../components/ui/AgentOpsProviderBadge";
import { SlidesDeck, isSlideOutput } from "./SkillsPage";

export function ChatPage({ agent, agents, onSelectAgent, setAgents, skills, conversations, setConversations }: any) {
  const [msgs, setMsgs] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const msgsRef = useRef<any[]>([]);
  const convIdRef = useRef<string | null>(null);

  useEffect(() => { msgsRef.current = msgs; }, [msgs]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);
  useEffect(() => { setMsgs([]); convIdRef.current = null; }, [agent?.id]);

  useEffect(() => {
    const last = msgs[msgs.length - 1];
    if (!agent || msgs.length === 0 || last?.role === "user") return;
    const save = async () => {
      const title = msgs.find(m => m.role === "user")?.text?.slice(0, 80) || "Conversation";
      const payload = {
        agent_id: agent.id, agent_name: agent.name, title,
        messages: msgs as any, message_count: msgs.length, updated_at: new Date().toISOString()
      };
      if (convIdRef.current) {
        await db.supabase.from("conversations").update(payload).eq("id", convIdRef.current);
        setConversations((p: any[]) => p.map(c => c.id === convIdRef.current ? { ...c, ...payload } : c));
      } else {
        const { data: item } = await db.supabase.from("conversations").insert(payload).select().single();
        if (item?.id) { convIdRef.current = item.id; setConversations((p: any[]) => [item, ...p]); }
      }
    };
    save();
  }, [msgs]);

  const agentSkillIds = Array.isArray(agent?.skill_ids) ? agent.skill_ids : [];
  const agentSkills = skills.filter(s => agentSkillIds.includes(s.id));

  const handleFileAttach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      const isImage = file.type.startsWith("image/");
      const isPDF = file.type === "application/pdf";
      const content = await new Promise<string>(res => {
        const reader = new FileReader();
        reader.onload = (ev: any) => res(ev.target?.result as string);
        if (isImage || isPDF) reader.readAsDataURL(file);
        else reader.readAsText(file);
      });
      setAttachedFiles(p => [...p, { name: file.name, content, type: file.type, isImage, isPDF }]);
    }
    e.target.value = "";
  };

  const exportChat = (format: "json" | "md") => {
    const msgs_ = msgsRef.current;
    if (format === "json") {
      downloadJSON(msgs_.map(m => ({ role: m.role, text: m.text || m.final_output, ts: m.ts })), `chat-${agent.name}-${Date.now()}.json`);
    } else {
      const md = [`# Chat with ${agent.name}`, `*Exported ${new Date().toLocaleString()}*`, ""].concat(
        msgs_.map(m => {
          if (m.role === "user") return `**You:** ${m.text}\n`;
          if (m.role === "pipeline") return `**[Pipeline: ${m.skill_name}]**\n${(m.steps_output || []).map((s: any) => `- ${s.label}: ${s.output}`).join("\n")}\n`;
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
    setMsgs(m => [...m, { role: "user", text: userMsg || `📎 ${filesSnap.map(f => f.name).join(", ")}`, ts: new Date() }]);
    setLoading(true);

    let fullMessage = userMsg;
    if (filesSnap.length > 0) {
      const parts: string[] = [];
      for (const f of filesSnap) {
        if (f.isPDF) {
          try {
            setMsgs(m => [...m, { role: "agent", text: `📄 Reading ${f.name}…`, meta: "system", ts: new Date() }]);
            const r = await fetch("/api/pdf", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ file_data: f.content, mime_type: f.type }),
            });
            let res: any;
            const contentType = r.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
              res = await r.json();
            } else {
              const text = await r.text();
              throw new Error(`Non-JSON response from /api/pdf: ${text.slice(0, 100)}`);
            }
            const data = res.data || res;
            if (r.ok && data?.text) {
              parts.push(`--- PDF: ${f.name} ---\n${data.text}\n--- End of ${f.name} ---`);
              setMsgs(m => m.filter(x => !(x.meta === "system" && x.text?.includes(f.name))));
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
      const data = result.data || result;
      setMsgs(m => [...m, {
        role: "agent", text: data.response, ts: new Date(),
        meta: `${data.provider_used} · ${data.model_used} · ${data.tokens_used}tok · ${data.latency_ms}ms${data.fallback_triggered ? " · FALLBACK" : ""}`
      }]);
      setAgents((a: Agent[]) => a.map(x => x.id === agent.id ? {
        ...x, total_runs: (x.total_runs || 0) + 1, total_tokens: (x.total_tokens || 0) + (data.tokens_used || 0)
      } : x));
    } catch (e: any) {
      setMsgs(m => [...m, { role: "agent", text: `⚠ Error: ${e.message}\n\nCheck your API keys in Settings.`, meta: "error", ts: new Date() }]);
    } finally { setLoading(false); }
  }, [input, agent, loading, setAgents, agentSkills, attachedFiles]);

  const runSkillPipeline = useCallback(async (skill: Skill) => {
    if (!agent || loading) return;
    const lastUserMsg = msgsRef.current.filter(m => m.role === "user").slice(-1)[0]?.text || "";
    if (!lastUserMsg) {
      setMsgs(m => [...m, { role: "agent", text: `◈ To run "${skill.name}", send a message first — it will be used as the pipeline input.`, meta: "system", ts: new Date() }]);
      return;
    }
    const steps = Array.isArray(skill.pipeline_steps) && skill.pipeline_steps.length > 0
      ? skill.pipeline_steps
      : [{
        label: skill.name, provider: agent.primary_provider, model: agent.primary_model,
        prompt_template: `${skill.description || "Process this:"}\n\n{{input}}`,
        system_prompt: agent.system_prompt
      }];

    const placeholderIdx = msgsRef.current.length;
    setMsgs(m => [...m, { role: "pipeline", skill_name: skill.name, steps_output: [], loading: true, ts: new Date() }]);
    setLoading(true);
    try {
      const r = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steps, input: lastUserMsg, skill_name: skill.name }),
      });
      let res: any;
      const contentType = r.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        res = await r.json();
      } else {
        const text = await r.text();
        throw new Error(`Non-JSON response from /api/pipeline: ${text.slice(0, 100)}`);
      }
      if (!r.ok) throw new Error(res?.error || `Pipeline error ${r.status}`);
      const data = res.data || res;
      setMsgs(m => m.map((msg, i) => i === placeholderIdx
        ? {
          ...msg, steps_output: data.steps_output, final_output: data.final_output, is_image: data.is_image, loading: false,
          meta: `${data.steps_output.length} step${data.steps_output.length !== 1 ? "s" : ""} · ${data.total_tokens}tok · ${data.total_latency_ms}ms`
        }
        : msg
      ));
    } catch (e: any) {
      setMsgs(m => m.map((msg, i) => i === placeholderIdx
        ? { ...msg, steps_output: [{ label: "Error", output: `⚠ ${e.message}`, error: true }], loading: false }
        : msg
      ));
    } finally { setLoading(false); }
  }, [agent, loading]);

  const p = (PERSONAS as any)[agent.persona] || PERSONAS.researcher;
  const agentConvs = conversations.filter(c => c.agent_id === agent?.id).slice(0, 30);

  return (
    <div className="chat-wrap slide-in" style={{ flexDirection: "row", padding: 0 }}>
      {showHistory && (
        <div style={{ width: 220, flexShrink: 0, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", background: C.surface, overflowY: "auto" }}>
          <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}`, fontWeight: 700, fontSize: 11, color: C.muted, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            HISTORY
            <button className="icon-btn" onClick={() => setShowHistory(false)}>✕</button>
          </div>
          <button className="nav-item" style={{ margin: "6px 8px", borderRadius: 6, border: `1px dashed ${C.border}`, justifyContent: "center", color: C.accent }}
            onClick={() => { setMsgs([]); convIdRef.current = null; }}>
            + New Chat
          </button>
          {agentConvs.length === 0 && <div style={{ padding: "20px 12px", color: C.dim, fontSize: 11, textAlign: "center" }}>No past conversations yet</div>}
          {agentConvs.map(c => (
            <div key={c.id} onClick={() => { setMsgs(Array.isArray(c.messages) ? c.messages : []); convIdRef.current = c.id; setShowHistory(false); }}
              style={{ padding: "8px 12px", cursor: "pointer", borderBottom: `1px solid ${C.border}30`, borderLeft: convIdRef.current === c.id ? `2px solid ${C.accent}` : "2px solid transparent" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: C.text, marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.title || "Untitled"}</div>
              <div style={{ fontSize: 10, color: C.dim }}>{c.message_count || 0} messages · {relative(c.updated_at || c.created_at)}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div className="chat-header">
          <span style={{ color: p.color, fontSize: 18, flexShrink: 0 }}>{p.icon}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 800, display: "flex", alignItems: "center", gap: 7 }}>
              {agent.name}
              <span className={`status-dot ${agent.status}`} style={{ width: 6, height: 6 }} />
            </div>
            <div style={{ display: "flex", gap: 5, marginTop: 1, flexWrap: "wrap" }}>
              <ProviderBadge name={agent.primary_provider} />
              {agent.fallback_provider && <span style={{ fontSize: 10, color: C.muted }}>→</span>}
              {agent.fallback_provider && <ProviderBadge name={agent.fallback_provider} />}
              <span style={{ fontSize: 10, color: C.muted }}>· {agent.primary_model}</span>
            </div>
          </div>
          <select className="form-input" style={{ width: "auto", fontSize: 11, padding: "4px 9px", flexShrink: 0 }}
            value={agent.id} onChange={e => { const a = agents.find(x => x.id === e.target.value); if (a) onSelectAgent(a); }}>
            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowHistory(h => !h)} title="Chat history">🕐 History</button>
          {msgs.length > 0 && (<>
            <div style={{ position: "relative" }}>
              <button className="btn btn-ghost btn-sm" id="export-chat-btn" onClick={() => { const m = document.getElementById("export-chat-menu"); if (m) m.style.display = m.style.display === "none" ? "block" : "none"; }}>↓ Export</button>
              <div id="export-chat-menu" style={{ display: "none", position: "absolute", right: 0, top: "110%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 7, padding: 4, minWidth: 140, zIndex: 9999 }}>
                <button className="nav-item" style={{ width: "100%", margin: 0 }} onClick={() => { exportChat("md"); const m = document.getElementById("export-chat-menu"); if (m) m.style.display = "none"; }}>📄 Markdown</button>
                <button className="nav-item" style={{ width: "100%", margin: 0 }} onClick={() => { exportChat("json"); const m = document.getElementById("export-chat-menu"); if (m) m.style.display = "none"; }}>JSON</button>
                <button className="nav-item" style={{ width: "100%", margin: 0 }} onClick={() => { window.print(); const m = document.getElementById("export-chat-menu"); if (m) m.style.display = "none"; }}>🖨 Print / PDF</button>
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => { setMsgs([]); convIdRef.current = null; }}>Clear</button>
          </>)}
        </div>

        <div className="chat-msgs">
          {msgs.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 20px", color: C.muted }}>
              <div style={{ fontSize: 40, marginBottom: 10 }}>{p.icon}</div>
              <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 15, fontWeight: 800, color: C.text, marginBottom: 6 }}>{agent.name}</div>
              <div style={{ fontSize: 12, maxWidth: 360, margin: "0 auto", lineHeight: 1.8 }}>{agent.description || "Ready to assist. Send a message to begin."}</div>
              <div style={{ marginTop: 16, fontSize: 11, color: C.dim }}>
                Provider: <span style={{ color: (PROVIDERS as any)[agent.primary_provider]?.color }}>{(PROVIDERS as any)[agent.primary_provider]?.logo} {agent.primary_provider}</span>
                {agent.fallback_provider && <> · Fallback: <span style={{ color: (PROVIDERS as any)[agent.fallback_provider]?.color }}>{agent.fallback_provider}</span></>}
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i}>
              {m.role === "pipeline" ? (
                <div className="pipeline-card">
                  <div className="pipeline-header">
                    <span style={{ color: C.purple }}>◈</span>
                    <span style={{ fontWeight: 700 }}>{m.skill_name}</span>
                    {m.loading && <Spinner />}
                    {!m.loading && m.meta && <span style={{ color: C.muted, fontSize: 10, marginLeft: "auto" }}>{m.meta}</span>}
                  </div>
                  {(m.steps_output || []).map((step, si) => (
                    <div key={si} className={`pipeline-step${step.error ? " pipeline-step-error" : ""}`}>
                      <div className="pipeline-step-label">
                        <span style={{ color: (PROVIDERS as any)[step.provider]?.color || C.muted }}>{(PROVIDERS as any)[step.provider]?.logo || "?"}</span>
                        {step.label}
                        <span style={{ marginLeft: "auto", fontSize: 10, color: C.muted }}>{step.provider} · {step.latency_ms}ms</span>
                      </div>
                      {step.is_image
                        ? <img src={step.output} alt="Generated" style={{ maxWidth: "100%", borderRadius: 6, marginTop: 6 }} />
                        : (step.provider === "notebooklm" && step.model === "notebooklm-slides") || (step.output && isSlideOutput(step.output))
                          ? <SlidesDeck text={step.output} />
                          : <div className="pipeline-step-output">{step.output}</div>
                      }
                    </div>
                  ))}
                </div>
              ) : m.role === "agent" && isSlideOutput(m.text || "") ? (
                <div className="pipeline-card" style={{ borderLeft: `3px solid ${C.accent}` }}>
                  <div className="pipeline-header" style={{ marginBottom: 8 }}>
                    <span style={{ color: C.accent }}>⬡</span> Presentation
                  </div>
                  <SlidesDeck text={m.text || ""} />
                </div>
              ) : (
                <div className={`msg msg-${m.role}`}>
                  {m.text}
                  {m.role === "agent" && m.text && m.meta !== "error" && m.meta !== "system" && (
                    <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
                      <button title="Save as plain text" onClick={() => {
                        const a = document.createElement("a");
                        a.href = URL.createObjectURL(new Blob([m.text || ""], { type: "text/plain" }));
                        a.download = `response-${Date.now()}.txt`; a.click();
                      }} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 5, color: C.dim, fontSize: 10, padding: "2px 7px", cursor: "pointer" }}>↓ TXT</button>
                      <button title="Save as Markdown" onClick={() => {
                        const a = document.createElement("a");
                        a.href = URL.createObjectURL(new Blob([`# ${agent.name}\n\n${m.text}`], { type: "text/markdown" }));
                        a.download = `response-${Date.now()}.md`; a.click();
                      }} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 5, color: C.dim, fontSize: 10, padding: "2px 7px", cursor: "pointer" }}>↓ MD</button>
                      <button title="Save as Word document" onClick={() => {
                        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${agent.name}</title>
<style>body{font-family:Calibri,Arial,sans-serif;max-width:800px;margin:40px auto;font-size:12pt;line-height:1.6}
h1{font-size:16pt;color:#1a1a2e}</style></head><body>
<h1>${agent.name}</h1><p><em>${new Date().toLocaleString()}</em></p><hr>
<div>${(m.text || "").replace(/\n/g, "<br>")}</div></body></html>`;
                        const a = document.createElement("a");
                        a.href = URL.createObjectURL(new Blob([html], { type: "application/msword" }));
                        a.download = `response-${Date.now()}.doc`; a.click();
                      }} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 5, color: C.dim, fontSize: 10, padding: "2px 7px", cursor: "pointer" }}>↓ DOC</button>
                      <button title="Print this response as PDF" onClick={() => {
                        const win = window.open("", "_blank");
                        if (win) {
                          win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${agent.name}</title>
<style>@page{margin:2cm}body{font-family:Calibri,Arial,sans-serif;font-size:12pt;line-height:1.7;color:#111}
h1{font-size:16pt;color:#1a1a2e;border-bottom:2px solid #eee;padding-bottom:6px}</style></head><body>
<h1>${agent.name}</h1><p><em>${new Date().toLocaleString()}</em></p><hr>
<div>${(m.text || "").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</div>
<script>window.onload=()=>{window.print();window.close();}<\/script></body></html>`);
                          win.document.close();
                        }
                      }} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 5, color: C.dim, fontSize: 10, padding: "2px 7px", cursor: "pointer" }}>↓ PDF</button>
                    </div>
                  )}
                </div>
              )}
              {m.meta && m.role !== "pipeline" && (
                <div className="msg-meta" style={{ justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                  {m.meta === "error" || m.meta === "system" ? <span style={{ color: m.meta === "error" ? C.red : C.muted }}>{m.meta === "error" ? "error" : ""}</span> : m.meta}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="msg msg-agent" style={{ display: "flex", gap: 8, alignItems: "center", color: C.muted }}>
              <Spinner /> Routing to {(PROVIDERS as any)[agent.primary_provider]?.label}…
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {agentSkills.length > 0 && (
          <div style={{ padding: "7px 18px", borderTop: `1px solid ${C.border}`, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", background: C.surface }}>
            <span style={{ fontSize: 9, color: C.dim, letterSpacing: ".1em", textTransform: "uppercase", marginRight: 2 }}>Skills</span>
            {agentSkills.map(skill => {
              const cc = (CAT_COLORS as any)[skill.category] || C.muted;
              const hasSteps = Array.isArray(skill.pipeline_steps) && skill.pipeline_steps.length > 0;
              return (
                <button key={skill.id} className="btn btn-xs"
                  onClick={() => runSkillPipeline(skill)} disabled={loading}
                  style={{ color: cc, border: `1px solid ${cc}40`, background: `${cc}0d` }}
                  title={skill.description}>
                  {hasSteps ? "⬡" : "◈"} {skill.name}
                  {hasSteps && <span style={{ fontSize: 9, opacity: .7, marginLeft: 3 }}>·{skill.pipeline_steps.length}</span>}
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
                <button onClick={() => setAttachedFiles(p => p.filter((_, idx) => idx !== i))}
                  style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 11, padding: 0, flexShrink: 0 }}>✕</button>
              </div>
            ))}
          </div>
        )}

        <input ref={fileInputRef} type="file" style={{ display: "none" }} multiple
          accept=".txt,.md,.json,.csv,.pdf,.js,.py,.ts,.jsx,.tsx,.html,.css,.xml,.yaml,.yml,image/*"
          onChange={handleFileAttach} />

        <div className="chat-input-row">
          <button className="btn btn-ghost btn-sm" style={{ alignSelf: "flex-end", flexShrink: 0 }} title="Attach PDF, image, or text file"
            onClick={() => fileInputRef.current?.click()}>📎</button>
          <textarea ref={inputRef} className="chat-input" rows={2} value={input}
            placeholder={`Message ${agent.name}… (Enter to send, Shift+Enter for new line)`}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} />
          <button className="btn btn-primary" onClick={send} disabled={loading || (!input.trim() && attachedFiles.length === 0)} style={{ alignSelf: "flex-end" }}>
            {loading ? <Spinner /> : "Send ↑"}
          </button>
        </div>
      </div>
    </div>
  );
}
