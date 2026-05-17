import React, { useState } from "react";
import { C, PROVIDERS } from "../lib/constants";
import { fmt, relative } from "../lib/utils";
import { ProviderBadge } from "../components/ui/AgentOpsProviderBadge";
import { Agent, AgentRun } from "../lib/supabase";

interface RunHistoryPageProps {
  runs: AgentRun[];
  agents: Agent[];
}

export function RunHistoryPage({ runs, agents }: RunHistoryPageProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const sorted = [...runs].sort((a, b) => new Date(b.started_at || 0).getTime() - new Date(a.started_at || 0).getTime());
  const filtered = sorted.filter(r => {
    const matchFilter = filter === "all" || r.provider_used === filter || (filter === "fallback" && r.fallback_triggered);
    const agent = agents.find(a => a.id === r.agent_id);
    const matchSearch = !search || agent?.name?.toLowerCase().includes(search.toLowerCase()) || r.provider_used?.includes(search);
    return matchFilter && matchSearch;
  });
  const providers: string[] = Array.from(new Set(runs.map(r => r.provider_used as string).filter(Boolean)));

  return (
    <div className="slide-in">
      <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <input className="form-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search runs…" style={{ width: 200, padding: "6px 10px" }} />
        <div style={{ display: "flex", gap: 2 }}>
          {["all", "fallback", ...providers].map(f => (
            <button key={f} className={`btn btn-sm ${filter === f ? "btn-primary" : "btn-ghost"}`} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", fontSize: 11, color: C.muted }}>{filtered.length} runs</div>
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
              {filtered.slice(0, 100).map(r => {
                const agent = agents.find(a => a.id === r.agent_id);
                const p = (PROVIDERS as any)[r.provider_used || ""] || { label: r.provider_used, color: C.muted, logo: "?" };
                return (
                  <tr key={r.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{agent?.name || "Unknown"}</div>
                      <div style={{ fontSize: 10, color: C.muted, fontFamily: "'JetBrains Mono',monospace", marginTop: 2, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.prompt}</div>
                    </td>
                    <td><ProviderBadge name={r.provider_used || ""} /></td>
                    <td><span style={{ fontSize: 10, color: C.muted, fontFamily: "'JetBrains Mono',monospace" }}>{r.model_used}</span></td>
                    <td>
                      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                        <span style={{ color: r.status === "completed" ? C.green : C.red, fontSize: 10 }}>{r.status === "completed" ? "✓" : "✗"}</span>
                        {r.fallback_triggered && <span style={{ fontSize: 9, color: C.yellow, background: C.yellow + "15", padding: "1px 5px", borderRadius: 3 }}>FALLBACK</span>}
                      </div>
                    </td>
                    <td style={{ color: C.muted }}>{fmt(r.tokens_used || 0)}</td>
                    <td style={{ color: C.muted }}>{r.latency_ms || 0}ms</td>
                    <td style={{ color: C.dim, fontSize: 11 }}>{relative(r.started_at)}</td>
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
