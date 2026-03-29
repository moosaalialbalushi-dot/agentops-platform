import { createClient } from "@supabase/supabase-js";

// Supabase anon key is a publishable key — safe in client bundles.
// Fallbacks ensure saves work even when VITE_ env vars are not set at Vercel build time.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  || "https://cnliqngeufcdsypuimog.supabase.co";

const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubGlxbmdldWZjZHN5cHVpbW9nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyNTk1MTksImV4cCI6MjA4ODgzNTUxOX0.dKnMsDxcwQZATCsVO7EVKluCh9MpRRipuSl1B_JCNO0";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ─── Types ────────────────────────────────────────────────────
export type AgentStatus = "active" | "idle" | "error" | "archived";
export type RunStatus = "pending" | "running" | "completed" | "error";

export interface Agent {
  id: string;
  user_id?: string | null;
  name: string;
  persona: string;
  description?: string;
  status: AgentStatus;
  primary_provider: string;
  primary_model: string;
  fallback_provider?: string | null;
  fallback_model?: string | null;
  provider_chain: string[];
  system_prompt?: string;
  temperature: number;
  max_tokens: number;
  total_runs: number;
  total_tokens: number;
  created_at: string;
  updated_at: string;
}

export interface Skill {
  id: string;
  user_id?: string | null;
  name: string;
  identifier: string;
  category: string;
  version: string;
  description?: string;
  permissions: "read" | "write" | "execute" | "admin";
  rate_limit: number;
  is_active: boolean;
  parameters: Record<string, unknown>;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface AgentRun {
  id: string;
  agent_id: string;
  user_id?: string | null;
  provider_used?: string;
  model_used?: string;
  prompt?: string;
  response?: string;
  status: RunStatus;
  tokens_used: number;
  latency_ms: number;
  fallback_triggered: boolean;
  started_at: string;
  ended_at?: string;
}

// ─── Data access helpers ──────────────────────────────────────

export const db = {
  agents: {
    list: () =>
      supabase.from("agents").select("*").order("created_at", { ascending: true }),
    create: (data: Partial<Agent>) =>
      supabase.from("agents").insert(data).select().single(),
    update: (id: string, data: Partial<Agent>) =>
      supabase.from("agents").update(data).eq("id", id).select().single(),
    remove: (id: string) =>
      supabase.from("agents").delete().eq("id", id),
  },
  skills: {
    list: () =>
      supabase.from("skills").select("*").order("created_at", { ascending: true }),
    create: (data: Partial<Skill>) =>
      supabase.from("skills").insert(data).select().single(),
    update: (id: string, data: Partial<Skill>) =>
      supabase.from("skills").update(data).eq("id", id).select().single(),
    remove: (id: string) =>
      supabase.from("skills").delete().eq("id", id),
  },
  runs: {
    list: (limit = 200) =>
      supabase.from("agent_runs").select("*").order("started_at", { ascending: false }).limit(limit),
    create: (data: Partial<AgentRun>) =>
      supabase.from("agent_runs").insert(data).select().single(),
  },
};
