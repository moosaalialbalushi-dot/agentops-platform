import React, { useState, useEffect } from "react";

export function ToastProvider() {
  const [toasts, setToasts] = useState<any[]>([]);
  useEffect(() => {
    const handler = (e: any) => {
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
          <span style={{ color: t.status === "error" ? "#ef4444" : "#10b981", fontSize: 13, flexShrink: 0 }}>
            {t.status === "error" ? "⚠" : "✓"}
          </span>
          <div>
            <div style={{ fontWeight: 700, color: "#f1f5f9" }}>{t.op} {t.table}</div>
            {t.detail && <div style={{ color: "#64748b", fontSize: 10, marginTop: 2 }}>{t.detail}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
