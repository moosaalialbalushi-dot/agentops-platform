import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { ChatMessage } from "@shared/ai-providers";
import { db } from "./supabase";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function auditLog(op: string, table: string, status: string, detail = "") {
  window.dispatchEvent(new CustomEvent("agentops_audit", {
    detail: { id: Date.now() + Math.random(), op, table, status, detail, ts: new Date().toISOString() }
  }));
}

export async function routeToAI(agent: any, userMessage: string, history: any[] = [], agentSkills: any[] = []) {
  let systemPrompt = agent.system_prompt || "You are a helpful AI agent.";

  const activeSkills = agentSkills.filter(s => s.is_active !== false);
  if (activeSkills.length > 0) {
    const skillsContext = activeSkills.map(s =>
      `- ${s.name} (${s.identifier}): ${s.description || "No description"}`
    ).join("\n");
    systemPrompt += `\n\n## Available Skills\nYou have access to the following capabilities:\n${skillsContext}`;
  }

  systemPrompt += `\n\n## General Assistant Behavior\nYou are also a general-purpose AI assistant. If a user's question is outside your primary specialty or cannot be addressed by your defined skills, still respond helpfully using your broad knowledge. Never refuse to help just because a topic seems off-topic. If you lack a specific skill to complete a task, explain what you can do and suggest alternatives or ask the user for more context.`;

  const messages: ChatMessage[] = [
    ...history
      .filter(m => m.role === "user" || m.role === "agent")
      .map(m => ({ role: (m.role === "agent" ? "assistant" : "user") as "assistant" | "user", content: m.text })),
    { role: "user", content: userMessage },
  ];

  const AI_PROXY_URL = "/api/chat";

  const r = await fetch(AI_PROXY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: agent.primary_provider,
      model: agent.primary_model,
      system_prompt: systemPrompt,
      messages,
      message: userMessage,
      max_tokens: agent.max_tokens || 4096,
      temperature: agent.temperature || 0.7,
      fallback_provider: agent.fallback_provider || null,
      fallback_model: agent.fallback_model || null,
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || `API error ${r.status}`);
  const { response, provider_used, model_used, fallback_triggered, latency_ms, tokens_used } = data;
  try {
    await db.runs.create({
      agent_id: agent.id, provider_used, model_used,
      prompt: userMessage.slice(0, 500), response: response.slice(0, 2000),
      status: "completed", tokens_used: tokens_used || 0, latency_ms: latency_ms || 0,
      fallback_triggered, started_at: new Date().toISOString(), ended_at: new Date().toISOString(),
    });
    await db.agents.update(agent.id, {
      total_runs: (agent.total_runs || 0) + 1,
      total_tokens: (agent.total_tokens || 0) + (tokens_used || 0),
      updated_at: new Date().toISOString(),
    });
  } catch (e) {}
  return data;
}

export const fmt = (n: number) => n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(0) + "k" : String(n || 0);
export const relative = (iso: string) => { if (!iso) return "—"; const d = (Date.now() - new Date(iso).getTime()) / 1000; if (d < 60) return `${~~d}s ago`; if (d < 3600) return `${~~(d / 60)}m ago`; if (d < 86400) return `${~~(d / 3600)}h ago`; return `${~~(d / 86400)}d ago`; };
export const downloadJSON = (data: any, filename: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  a.download = filename;
  a.click();
};
