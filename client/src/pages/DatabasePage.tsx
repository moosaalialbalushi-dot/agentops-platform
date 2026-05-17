import React, { useState } from "react";
import { C } from "../lib/constants";
import { ProviderBadge } from "../components/ui/AgentOpsProviderBadge";
import { Agent, Skill, AgentRun } from "../lib/supabase";

interface DatabasePageProps {
  agents: Agent[];
  skills: Skill[];
  runs: AgentRun[];
}

export function DatabasePage({ agents, skills, runs }: DatabasePageProps) {
  const tables = [
    {
      name: "agents", icon: "⬡", count: agents.length, color: C.accent,
      cols: ["id", "name", "persona", "status", "primary_provider", "total_runs", "total_tokens"],
      rows: agents.slice(0, 20)
    },
    {
      name: "skills", icon: "◈", count: skills.length, color: C.cyan,
      cols: ["id", "name", "identifier", "category", "version", "is_active"],
      rows: skills.slice(0, 20)
    },
    {
      name: "agent_runs", icon: "◎", count: runs.length, color: C.green,
      cols: ["id", "agent_id", "provider_used", "status", "tokens_used", "latency_ms", "started_at"],
      rows: runs.slice(0, 20)
    },
  ];
  const [active, setActive] = useState("agents");
  const tbl = tables.find(t => t.name === active);

  return (
    <div className="slide-in">
      <div className="tabs">
        {tables.map(t => (
          <button key={t.name} className={`tab ${active === t.name ? "active" : ""}`} onClick={() => setActive(t.name)}>
            {t.icon} {t.name} ({t.count})
          </button>
        ))}
      </div>
      {tbl && (
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr>{tbl.cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>
              {tbl.rows.length === 0
                ? <tr><td colSpan={tbl.cols.length} style={{ textAlign: "center", color: C.dim, padding: 20 }}>No data</td></tr>
                : tbl.rows.map((row: any, i) => (
                  <tr key={i}>
                    {tbl.cols.map(col => (
                      <td key={col}>
                        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>
                          {col === "is_active"
                            ? <span style={{ color: row[col] ? C.green : C.dim }}>{row[col] ? "✓" : "✗"}</span>
                            : col === "status"
                              ? <span style={{ color: row[col] === "active" ? C.green : row[col] === "error" ? C.red : C.yellow }}>{row[col]}</span>
                              : col === "primary_provider" || col === "provider_used"
                                ? <ProviderBadge name={row[col]} />
                                : String(row[col] ?? "—").slice(0, 40)}
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
