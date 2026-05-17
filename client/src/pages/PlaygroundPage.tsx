import React, { useState, useEffect, useRef } from "react";
import { C, PROVIDERS, MODELS_BY_PROVIDER } from "../lib/constants";
import { db, Skill } from "../lib/supabase";
import { Spinner } from "../components/ui/AgentOpsSpinner";

export function PlaygroundPage({ skills }: any) {
  const [provider, setProvider] = useState("claude");
  const [model, setModel] = useState("claude-sonnet-4-6");
  const [systemPrompt, setSystemPrompt] = useState("You are a helpful AI assistant. Provide complete, well-structured responses.");
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [msgs, setMsgs] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showSystem, setShowSystem] = useState(false);
  const [pipeline, setPipeline] = useState<any[]>([]);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineResults, setPipelineResults] = useState<any[]>([]);
  const [tab, setTab] = useState("chat");
  const bottomRef = useRef<HTMLDivElement>(null);
  const msgsRef = useRef<any[]>([]);

  useEffect(() => { msgsRef.current = msgs; }, [msgs]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, pipelineResults]);

  const S = {
    wrap: { display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" },
    topbar: { display: "flex", gap: 8, alignItems: "center", padding: "12px 16px", borderBottom: `1px solid ${C.border}`, flexWrap: "wrap", flexShrink: 0 },
    tabBar: { display: "flex", borderBottom: `1px solid ${C.border}`, flexShrink: 0 },
    tab: (active: boolean) => ({
      padding: "8px 18px", fontSize: 12, fontWeight: 700, cursor: "pointer", border: "none", background: "none",
      color: active ? C.text : C.muted, borderBottom: active ? `2px solid ${C.accent}` : "2px solid transparent"
    }),
    msgArea: { flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: 10 },
    inputRow: { display: "flex", gap: 8, padding: "12px 16px", borderTop: `1px solid ${C.border}`, flexShrink: 0, alignItems: "flex-end" },
    skillsArea: { flex: 1, overflowY: "auto", padding: 16 },
    skillCard: {
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", marginBottom: 8,
      display: "flex", alignItems: "center", gap: 10, cursor: "pointer"
    },
    queueCard: {
      background: C.accent + "15", border: `1px solid ${C.accent}`, borderRadius: 8, padding: "10px 14px", marginBottom: 8,
      display: "flex", alignItems: "center", gap: 10
    },
    resultCard: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, marginBottom: 10 },
    select: { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontSize: 12, padding: "4px 8px" },
    label: { fontSize: 11, color: C.dim, marginRight: 4 },
  };

  const send = async () => {
    if (!input.trim() || loading) return;
    const userText = input.trim();
    setInput("");
    const history = msgsRef.current;
    setMsgs(m => [...m, { role: "user", text: userText, ts: new Date() }]);
    setLoading(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider, model,
          system_prompt: systemPrompt,
          messages: [
            ...history.filter(m => m.role === "user" || m.role === "agent").map(m => ({ role: m.role === "agent" ? "assistant" : "user", content: m.text })),
            { role: "user", content: userText },
          ],
          max_tokens: maxTokens, temperature,
        }),
      });
      let resData: any;
      const contentType = r.headers.get("content-type");
      if (contentType && contentType.includes("application/json")) {
        resData = await r.json();
      } else {
        const text = await r.text();
        throw new Error(`Non-JSON response from /api/chat: ${text.slice(0, 100)}`);
      }
      if (!r.ok) throw new Error(resData?.error || `Error ${r.status}`);
      const data = resData.data || resData;
      const resp = data.response || "";
      setMsgs(m => [...m, { role: "agent", text: resp, meta: `${data.provider_used} · ${data.model_used} · ${data.tokens_used}tok · ${data.latency_ms}ms`, ts: new Date() }]);
    } catch (e: any) {
      setMsgs(m => [...m, { role: "agent", text: `⚠ ${e.message}`, meta: "error", ts: new Date() }]);
    } finally { setLoading(false); }
  };

  const addToPipeline = (skill: Skill) => {
    if (pipeline.find(s => s.id === skill.id)) return;
    setPipeline(p => [...p, skill]);
  };

  const runPipeline = async () => {
    if (pipeline.length === 0 || !input.trim()) return;
    setPipelineRunning(true);
    setPipelineResults([]);
    let currentInput = input.trim();
    const results: any[] = [];
    for (const skill of pipeline) {
      const steps = skill.pipeline_steps || [];
      if (steps.length === 0) {
        results.push({ skill: skill.name, output: "No pipeline steps configured.", error: true });
        continue;
      }
      try {
        const r = await fetch("/api/pipeline", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ skill_id: skill.id, input: currentInput }),
        });
        let resData: any;
        const contentType = r.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
          resData = await r.json();
        } else {
          const text = await r.text();
          throw new Error(`Non-JSON response from /api/pipeline: ${text.slice(0, 100)}`);
        }
        if (!r.ok) throw new Error(resData?.error || `Error ${r.status}`);
        const data = resData.data || resData;
        const out = data.final_output || (data.steps && data.steps.slice(-1)[0]?.output) || "";
        results.push({ skill: skill.name, output: out, tokens: data.total_tokens, latency: data.total_latency_ms });
        currentInput = out;
      } catch (e: any) {
        results.push({ skill: skill.name, output: e.message, error: true });
        break;
      }
      setPipelineResults([...results]);
    }
    setPipelineRunning(false);
  };

  const dlResult = (text: string, ext: string, mime: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = `playground-${Date.now()}.${ext}`; a.click();
  };

  const handleProviderChange = (p: string) => {
    setProvider(p);
    const first = (MODELS_BY_PROVIDER as any)[p]?.[0] || "";
    setModel(first);
  };

  return (
    <div style={S.wrap as React.CSSProperties}>
      <div style={S.topbar as React.CSSProperties}>
        <span style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 800, color: C.text, marginRight: 4 }}>⚡ Playground</span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={S.label as React.CSSProperties}>Provider</span>
          <select style={S.select as React.CSSProperties} value={provider} onChange={e => handleProviderChange(e.target.value)}>
            {Object.entries(PROVIDERS).filter(([k]) => !["notebooklm", "veo", "custom"].includes(k)).map(([k, p]) => (
              <option key={k} value={k}>{(p as any).logo} {(p as any).label}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={S.label as React.CSSProperties}>Model</span>
          <select style={S.select as React.CSSProperties} value={model} onChange={e => setModel(e.target.value)}>
            {((MODELS_BY_PROVIDER as any)[provider] || []).map((m: string) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={S.label as React.CSSProperties}>Temp</span>
          <input type="number" min="0" max="2" step="0.1" value={temperature}
            onChange={e => setTemperature(parseFloat(e.target.value))}
            style={{ ...S.select, width: 54 } as React.CSSProperties} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={S.label as React.CSSProperties}>Max tokens</span>
          <input type="number" min="100" max="8000" step="100" value={maxTokens}
            onChange={e => setMaxTokens(parseInt(e.target.value))}
            style={{ ...S.select, width: 70 } as React.CSSProperties} />
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setShowSystem(s => !s)}>
          {showSystem ? "▲" : "▼"} System prompt
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => { setMsgs([]); setPipelineResults([]); }}>Clear</button>
      </div>

      {showSystem && (
        <div style={{ padding: "8px 16px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} rows={3}
            style={{
              width: "100%", background: C.card, border: `1px solid ${C.border}`, borderRadius: 6,
              color: C.text, fontSize: 12, padding: "8px 10px", resize: "vertical", boxSizing: "border-box"
            } as React.CSSProperties}
            placeholder="System prompt — instructions for how the AI should behave..." />
        </div>
      )}

      <div style={S.tabBar as React.CSSProperties}>
        <button style={S.tab(tab === "chat") as React.CSSProperties} onClick={() => setTab("chat")}>💬 Chat</button>
        <button style={S.tab(tab === "skills") as React.CSSProperties} onClick={() => setTab("skills")}>◈ Skills Pipeline ({pipeline.length} queued)</button>
      </div>

      {tab === "chat" && (<>
        <div style={S.msgArea as React.CSSProperties}>
          {msgs.length === 0 && (
            <div style={{ textAlign: "center", padding: "40px 20px", color: C.muted }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>⚡</div>
              <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 14, fontWeight: 800, color: C.text, marginBottom: 6 }}>Playground</div>
              <div style={{ fontSize: 12, maxWidth: 340, margin: "0 auto", lineHeight: 1.8 }}>
                Direct chat with any AI model. No agent setup required.<br />
                Switch providers and models any time.
              </div>
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i}>
              <div className={`msg msg-${m.role}`}>
                {m.text}
                {m.role === "agent" && m.meta !== "error" && (
                  <div style={{ marginTop: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {[["TXT", "txt", "text/plain", m.text], ["MD", "md", "text/markdown", `# Response\n\n${m.text}`],
                    ["DOC", "doc", "application/msword", `<!DOCTYPE html><html><body>${(m.text || "").replace(/\n/g, "<br>")}</body></html>`]
                    ].map(([label, ext, mime, content]) => (
                      <button key={label as string} onClick={() => dlResult(content as string, ext as string, mime as string)}
                        style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 5, color: C.dim, fontSize: 10, padding: "2px 7px", cursor: "pointer" }}>
                        ↓ {label as string}
                      </button>
                    ))}
                    <button onClick={() => {
                      const win = window.open("", "_blank");
                      if (win) {
                        win.document.write(`<!DOCTYPE html><html><head><style>@page{margin:2cm}body{font-family:Calibri,sans-serif;font-size:12pt;line-height:1.7}</style></head><body>${(m.text || "").replace(/</g, "&lt;").replace(/\n/g, "<br>")}<script>window.onload=()=>{window.print();window.close();}<\/script></body></html>`);
                        win.document.close();
                      }
                    }} style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 5, color: C.dim, fontSize: 10, padding: "2px 7px", cursor: "pointer" }}>↓ PDF</button>
                  </div>
                )}
              </div>
              {m.meta && <div className="msg-meta" style={{ justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                <span style={{ color: m.meta === "error" ? C.red : C.muted }}>{m.meta === "error" ? "error" : m.meta}</span>
              </div>}
            </div>
          ))}
          {loading && <div className="msg msg-agent" style={{ display: "flex", gap: 8, alignItems: "center", color: C.muted }}><Spinner /> Thinking…</div>}
          <div ref={bottomRef} />
        </div>
        <div style={S.inputRow as React.CSSProperties}>
          <textarea className="chat-input" rows={2} value={input} placeholder="Message the AI… (Enter to send, Shift+Enter for new line)"
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={send} disabled={loading || !input.trim()} style={{ alignSelf: "flex-end" }}>
            {loading ? <Spinner /> : "Send ↑"}
          </button>
        </div>
      </>)}

      {tab === "skills" && (
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          <div style={{ flex: 1, overflowY: "auto", padding: 16, borderRight: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, marginBottom: 10, letterSpacing: 1 }}>AVAILABLE SKILLS — click to add</div>
            {skills.length === 0 && <div style={{ fontSize: 12, color: C.muted }}>No skills created yet. Go to Skills to create some.</div>}
            {skills.map((sk: Skill) => (
              <div key={sk.id} style={{ ...S.skillCard, opacity: pipeline.find(s => s.id === sk.id) ? 0.4 : 1 } as React.CSSProperties}
                onClick={() => addToPipeline(sk)}>
                <span style={{ fontSize: 18 }}>◈</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{sk.name}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>{sk.description || sk.category}</div>
                </div>
                <span style={{ fontSize: 11, color: C.accent }}>+ Add</span>
              </div>
            ))}
          </div>

          <div style={{ width: 340, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, letterSpacing: 1 }}>PIPELINE QUEUE (runs top → bottom)</div>
            {pipeline.length === 0 && (
              <div style={{ fontSize: 12, color: C.muted, padding: "20px 0" }}>Add skills from the left. They will run in order, each output feeding into the next.</div>
            )}
            {pipeline.map((sk, i) => (
              <div key={sk.id} style={S.queueCard as React.CSSProperties}>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: C.accent, width: 20 }}>#{i + 1}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{sk.name}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>{(sk.pipeline_steps || []).length} step{(sk.pipeline_steps || []).length !== 1 ? "s" : ""}</div>
                </div>
                <button onClick={() => setPipeline(p => p.filter(s => s.id !== sk.id))}
                  style={{ background: "none", border: "none", color: C.muted, cursor: "pointer", fontSize: 14 }}>✕</button>
              </div>
            ))}

            {pipeline.length > 0 && (
              <>
                <div style={{ fontSize: 11, color: C.dim }}>Input (starting text for the pipeline):</div>
                <textarea rows={3} value={input} onChange={e => setInput(e.target.value)} placeholder="Enter the text to process through the pipeline…"
                  style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, fontSize: 12, padding: "8px 10px", resize: "vertical" } as React.CSSProperties} />
                <button className="btn btn-primary" onClick={runPipeline} disabled={pipelineRunning || !input.trim() || pipeline.length === 0}>
                  {pipelineRunning ? <><Spinner /> Running pipeline…</> : `▶ Run ${pipeline.length} skill${pipeline.length !== 1 ? "s" : ""}`}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => { setPipeline([]); setPipelineResults([]); }}>Clear queue</button>
              </>
            )}

            {pipelineResults.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.dim, marginBottom: 8, letterSpacing: 1 }}>RESULTS</div>
                {pipelineResults.map((r, i) => (
                  <div key={i} style={{ ...S.resultCard, borderLeft: `3px solid ${r.error ? C.red : C.accent}` } as React.CSSProperties}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: r.error ? C.red : C.accent, marginBottom: 6 }}>#{i + 1} {r.skill}</div>
                    <div style={{ fontSize: 12, color: C.text, whiteSpace: "pre-wrap", maxHeight: 200, overflowY: "auto" }}>{r.output}</div>
                    {!r.error && (
                      <div style={{ marginTop: 6, display: "flex", gap: 4 }}>
                        <button onClick={() => dlResult(r.output, "txt", "text/plain")}
                          style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 5, color: C.dim, fontSize: 10, padding: "2px 7px", cursor: "pointer" }}>
                          ↓ TXT
                        </button>
                        <button onClick={() => dlResult(r.output, "md", "text/markdown")}
                          style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 5, color: C.dim, fontSize: 10, padding: "2px 7px", cursor: "pointer" }}>
                          ↓ MD
                        </button>
                        <button onClick={() => dlResult(`<!DOCTYPE html><html><body>${(r.output || "").replace(/\n/g, "<br>")}</body></html>`, "doc", "application/msword")}
                          style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 5, color: C.dim, fontSize: 10, padding: "2px 7px", cursor: "pointer" }}>
                          ↓ DOC
                        </button>
                      </div>
                    )}
                    {r.tokens && <div style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>{r.tokens} tokens · {r.latency}ms</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
