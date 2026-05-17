import React, { useState } from "react";
import { auditLog } from "../../lib/utils";

interface PromptEnhancerProps {
  value: string;
  onChange: (value: string) => void;
  context?: string;
  compact?: boolean;
}

export function PromptEnhancer({ value, onChange, context = "AI prompt", compact = false }: PromptEnhancerProps) {
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
    } catch (e: any) { auditLog("ENHANCE", "prompt", "error", e.message); }
    finally { setLoading(false); }
  };
  return (
    <button className="enhance-btn" onClick={enhance} disabled={loading || !value?.trim()} title={`AI-enhance this ${context}`}>
      {loading ? <span className="spin" style={{ width: 10, height: 10, borderWidth: 1.5 }} /> : "✨"}
      {!compact && " Enhance"}
    </button>
  );
}
