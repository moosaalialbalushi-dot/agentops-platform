import React, { useState, useEffect } from "react";
import { C } from "../lib/constants";
import { relative } from "../lib/utils";

interface AuditLogEntry {
  op: string;
  table: string;
  status: string;
  detail?: string;
  ts: string;
}

export function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  useEffect(() => {
    const handler = (e: any) => setLogs(p => [e.detail, ...p].slice(0, 300));
    window.addEventListener("agentops_audit", handler);
    return () => window.removeEventListener("agentops_audit", handler);
  }, []);

  const opColor: Record<string, string> = { SAVE: C.green, UPDATE: C.cyan, DELETE: C.red, LOAD: C.muted, ENHANCE: C.purple };
  return (
    <div className="slide-in">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: C.muted }}>Live log of all database operations. Shows saves, updates, deletes and errors.</div>
        <button className="btn btn-ghost btn-sm" onClick={() => setLogs([])}>Clear</button>
      </div>
      {logs.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">▦</div>
          <div className="empty-text">No activity yet.<br />Save an agent or skill to see entries here.</div>
        </div>
      ) : (
        <div className="run-log">
          {logs.map((l, i) => (
            <div key={i} className="audit-row">
              <span style={{ color: l.status === "error" ? C.red : C.green, fontSize: 13, flexShrink: 0 }}>
                {l.status === "error" ? "⚠" : "✓"}
              </span>
              <span style={{ color: opColor[l.op] || C.muted, fontWeight: 700, fontSize: 11, minWidth: 60 }}>{l.op}</span>
              <span style={{ color: C.text, fontSize: 11 }}>{l.table}</span>
              {l.detail && <span style={{ color: C.muted, fontSize: 10 }}>{l.detail}</span>}
              <span style={{ marginLeft: "auto", color: C.dim, fontSize: 10 }}>{relative(l.ts)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
