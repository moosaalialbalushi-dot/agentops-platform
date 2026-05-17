import React from "react";
import { C, PERSONAS, PROVIDERS } from "../lib/constants";
import { fmt, relative } from "../lib/utils";
import { ProviderBadge } from "../components/ui/AgentOpsProviderBadge";

interface CommandCenterProps {
  agents: any[];
  skills: any[];
  runs: any[];
  onChat: (agent: any) => void;
}

export function CommandCenter({ agents, skills, runs, onChat }: CommandCenterProps) {
  const active = agents.filter(a => a.status === "active").length;
  const totalRuns = agents.reduce((s, a) => s + (a.total_runs || 0), 0);
  const totalTok = agents.reduce((s, a) => s + (a.total_tokens || 0), 0);
  const recent = [...runs].sort((a, b) => new Date(b.started_at || 0).getTime() - new Date(a.started_at || 0).getTime()).slice(0, 8);

  return (
    <div className="slide-in">
      <div className="stat-grid">
        {[
          { label: "Active Agents", value: active, sub: `${agents.length - active} standby`, c: C.green },
          { label: "Registered Skills", value: skills.length, sub: `${skills.filter(s => s.is_active).length} enabled`, c: C.accent },
          { label: "Total Runs", value: fmt(totalRuns), sub: "all agents all time", c: C.cyan },
          { label: "Tokens Consumed", value: fmt(totalTok), sub: "across all providers", c: C.yellow },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ "--c": s.c } as React.CSSProperties}>
            <div className="stat-label">{s.label}</div>
            <div className="stat-val" style={{ color: s.c }}>{s.value}</div>
            <div className="stat-sub">{s.sub}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
        <div className="card" style={{ padding: 16 }}>
          <div className="section-title">◎ Recent Runs <span className="sec-badge">{recent.length} latest</span></div>
          <div className="run-log">
            {recent.length === 0
              ? <div style={{ color: C.dim, textAlign: "center", padding: "22px 0", fontSize: 12 }}>No runs yet — chat with an agent to start</div>
              : recent.map(r => {
                const agent = agents.find(a => a.id === r.agent_id);
                const p = (PERSONAS as any)[agent?.persona] || PERSONAS.researcher;
                return (
                  <div key={r.id} className="run-row">
                    <span style={{ color: p.color, fontSize: 12 }}>{p.icon}</span>
                    <span style={{ color: C.text, flex: 1, fontWeight: 500, fontSize: 11 }}>{agent?.name || "Unknown"}</span>
                    <ProviderBadge name={r.provider_used} />
                    {r.fallback_triggered && <span style={{ fontSize: 9, color: C.yellow, background: C.yellow + "15", padding: "1px 5px", borderRadius: 3 }}>FALLBACK</span>}
                    <span style={{ color: C.muted, minWidth: 34, textAlign: "right" }}>{fmt(r.tokens_used || 0)}</span>
                    <span style={{ color: C.dim, minWidth: 44, textAlign: "right" }}>{r.latency_ms || 0}ms</span>
                    <span style={{ color: C.dim, minWidth: 50, textAlign: "right", fontSize: 10 }}>{relative(r.started_at)}</span>
                  </div>
                );
              })
            }
          </div>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div className="section-title">⬡ Quick Launch</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {agents.filter(a => a.status === "active").map(agent => {
              const p = (PERSONAS as any)[agent.persona] || PERSONAS.researcher;
              return (
                <div key={agent.id} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 11px", background: C.surface, borderRadius: 8, border: `1px solid ${C.border}` }}>
                  <span className="status-dot active" />
                  <span style={{ color: p.color, fontSize: 13 }}>{p.icon}</span>
                  <span style={{ flex: 1, fontWeight: 600, fontSize: 12 }}>{agent.name}</span>
                  <ProviderBadge name={agent.primary_provider} />
                  <button className="btn btn-xs btn-primary" onClick={() => onChat(agent)}>Chat →</button>
                </div>
              );
            })}
            {agents.filter(a => a.status === "active").length === 0 && (
              <div style={{ color: C.dim, textAlign: "center", padding: "14px 0", fontSize: 12 }}>No active agents</div>
            )}
          </div>
        </div>
      </div>

      {/* Provider Distribution */}
      <div className="card" style={{ padding: 16 }}>
        <div className="section-title">◆ Provider Distribution</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 10 }}>
          {Object.entries(PROVIDERS).slice(0, 4).map(([key, p]) => {
            const runsUsing = runs.filter(r => r.provider_used === key).length;
            return (
              <div key={key} style={{ background: C.surface, border: `1px solid ${(p as any).color}22`, borderRadius: 9, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                  <span style={{ color: (p as any).color, fontSize: 15 }}>{(p as any).logo}</span>
                  <span style={{ fontFamily: "'Syne',sans-serif", fontSize: 12, fontWeight: 700 }}>{(p as any).label}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
                  {[["PRIMARY", agents.filter(a => a.primary_provider === key).length], ["FALLBACK", agents.filter(a => a.fallback_provider === key).length], ["RUNS", runsUsing]].map(([l, v]) => (
                    <div key={l as string} style={{ textAlign: "center" }}>
                      <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 14, fontWeight: 800, color: (p as any).color }}>{v}</div>
                      <div style={{ fontSize: 9, color: C.muted, letterSpacing: ".07em" }}>{l as string}</div>
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
