import React from "react";
import { PROVIDERS } from "../../lib/constants";

export function ProviderBadge({ name }: { name: string }) {
  const p = (PROVIDERS as any)[name] || { label: name || "?", color: "#64748b", logo: "?" };
  return (
    <span className="provider-badge" style={{ background: p.color + "18", color: p.color, border: `1px solid ${p.color}30` }}>
      {p.logo} {p.label}
    </span>
  );
}
