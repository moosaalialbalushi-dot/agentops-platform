import React, { useState, useEffect } from "react";
import { C, PROVIDERS } from "./lib/constants";
import { db, Agent, Skill, AgentRun } from "./lib/supabase";
import { ToastProvider } from "./components/ui/AgentOpsToastProvider";
import { Spinner } from "./components/ui/AgentOpsSpinner";
import { CommandCenter } from "./pages/CommandCenter";
import { AgentsPage } from "./pages/AgentsPage";
import { SkillsPage } from "./pages/SkillsPage";
import { ChatPage } from "./pages/ChatPage";
import { RunHistoryPage } from "./pages/RunHistoryPage";
import { ApiKeysPage } from "./pages/ApiKeysPage";
import { DatabasePage } from "./pages/DatabasePage";
import { ConnectorsPage } from "./pages/ConnectorsPage";
import { AuditLogPage } from "./pages/AuditLogPage";
import { HelpPage } from "./pages/HelpPage";
import { CreatorPage } from "./pages/CreatorPage";
import { PlaygroundPage } from "./pages/PlaygroundPage";

const NAV = [
  { id: "command", icon: "◎", label: "Command Center", group: "main" },
  { id: "agents", icon: "⬡", label: "Agents", group: "main", countKey: "agents" },
  { id: "skills", icon: "◈", label: "Skills", group: "main", countKey: "skills" },
  { id: "connectors", icon: "⌘", label: "Connectors", group: "main", countKey: "connectors" },
  { id: "chat", icon: "💬", label: "Chat", group: "main" },
  { id: "playground", icon: "⚡", label: "Playground", group: "main" },
  { id: "runs", icon: "▶", label: "Run History", group: "data", countKey: "runs" },
  { id: "audit", icon: "▦", label: "Audit Log", group: "data" },
  { id: "database", icon: "⬟", label: "Database", group: "data" },
  { id: "apikeys", icon: "🔑", label: "API Keys", group: "data" },
  { id: "creator", icon: "✨", label: "AI Creator", group: "main" },
  { id: "help", icon: "?", label: "Help & Guide", group: "data" },
];

export default function App() {
  const [page, setPage] = useState("command");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [connectors, setConnectors] = useState<any[]>([]);
  const [conversations, setConversations] = useState<any[]>([]);
  const [chatAgent, setChatAgent] = useState<Agent | null>(null);
  const [loading, setLoading] = useState(true);
  const [providerStatus, setProviderStatus] = useState<Record<string, boolean>>({ claude: false, gemini: false, deepseek: false });

  const loadData = async () => {
    setLoading(true);
    try {
      const [a, s, r, cn, cv] = await Promise.all([
        db.agents.list(),
        db.skills.list(),
        db.runs.list(200),
        db.supabase.from("connectors").select("*").order("created_at", { ascending: true }),
        db.supabase.from("conversations").select("*").order("updated_at", { ascending: false }).limit(100),
      ]);

      const loadedAgents = a.data || [];
      setAgents(loadedAgents);
      setSkills(s.data || []);
      setRuns(r.data || []);
      setConnectors(cn.data || []);
      setConversations(cv.data || []);

      if (!chatAgent && loadedAgents.length > 0) setChatAgent(loadedAgents[0]);
    } catch (error) {
      console.error("Failed to load data:", error);
    } finally {
      setLoading(false);
    }

    // Load provider status in background
    fetch("/api/status")
      .then(r => r.json())
      .then(d => {
        const statusData = d.data || d;
        if (statusData?.providers) setProviderStatus(statusData.providers);
      })
      .catch(() => { });
  };

  useEffect(() => { loadData(); }, []);

  const goChat = (agent: Agent) => { setChatAgent(agent); setPage("chat"); };

  const counts = {
    agents: agents.length,
    skills: skills.length,
    runs: runs.length,
    connectors: connectors.length
  };

  return (
    <>
      <ToastProvider />
      <div className="app">
        <div className="nebula" />

        {/* SIDEBAR */}
        <div className="sidebar">
          <div className="logo-wrap">
            <div className="logo-hex">⬡</div>
            <div className="logo-text">
              <div className="name">AGENTOPS</div>
              <div className="ver">PLATFORM v2.0</div>
            </div>
          </div>

          <div className="nav">
            <div className="nav-section">Main</div>
            {NAV.filter(n => n.group === "main").map(n => (
              <div key={n.id} className={`nav-item ${page === n.id ? "active" : ""}`} onClick={() => setPage(n.id)}>
                <span className="nav-icon">{n.icon}</span>
                {n.label}
                {n.countKey && <span className="nav-count">{(counts as any)[n.countKey] || 0}</span>}
              </div>
            ))}

            <div className="nav-section">Data</div>
            {NAV.filter(n => n.group === "data").map(n => (
              <div key={n.id} className={`nav-item ${page === n.id ? "active" : ""}`} onClick={() => setPage(n.id)}>
                <span className="nav-icon">{n.icon}</span>
                {n.label}
                {n.countKey && (counts as any)[n.countKey] > 0 && <span className="nav-count">{(counts as any)[n.countKey]}</span>}
              </div>
            ))}

            <div className="nav-section">AI Providers</div>
            {(["claude", "gemini", "zhipu", "deepseek", "openai", "groq", "nano_banana", "ernie_image", "chartgen"]).map(key => {
              const p = (PROVIDERS as any)[key]; if (!p) return null;
              const isOn = providerStatus[key] ?? false;
              return (
                <div key={key} className="provider-row" onClick={() => setPage("apikeys")}>
                  <span className="provider-dot" style={{ background: p.color }} />
                  <span style={{ color: C.muted, flex: 1, fontSize: 11 }}>{p.label}</span>
                  <span className="provider-status" style={{ background: isOn ? C.green + "18" : C.dim + "18", color: isOn ? C.green : C.dim }}>
                    {isOn ? "ON" : "OFF"}
                  </span>
                </div>
              );
            })}
          </div>

          <div style={{ padding: "10px 14px", borderTop: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.muted, marginBottom: 4 }}>
              <span>Supabase</span>
              <span style={{ color: C.green, fontFamily: "'JetBrains Mono',monospace" }}>
                ● LIVE
              </span>
            </div>
            <button className="btn btn-ghost btn-xs" style={{ width: "100%" }} onClick={loadData}>
              {loading ? <><Spinner /> Loading…</> : "⟳ Refresh Data"}
            </button>
          </div>
        </div>

        {/* MAIN */}
        <div className="main">
          <div className="topbar">
            <div style={{ display: "flex", alignItems: "center" }}>
              <div className="page-title">{NAV.find(n => n.id === page)?.label || "AgentOps"}</div>
              <span className="breadcrumb">/ {page}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {loading && <Spinner />}
              {chatAgent && page !== "chat" && (
                <button className="btn btn-ghost btn-sm" onClick={() => setPage("chat")}>
                  💬 {chatAgent.name}
                </button>
              )}
            </div>
          </div>

          {page !== "chat" && (
            <div className="content">
              {page === "command" && <CommandCenter agents={agents} skills={skills} runs={runs} onChat={goChat} />}
              {page === "agents" && <AgentsPage agents={agents} setAgents={setAgents} skills={skills} onChat={goChat} loading={loading} />}
              {page === "skills" && <SkillsPage skills={skills} setSkills={setSkills} loading={loading} />}
              {page === "connectors" && <ConnectorsPage connectors={connectors} setConnectors={setConnectors} loading={loading} />}
              {page === "audit" && <AuditLogPage />}
              {page === "runs" && <RunHistoryPage runs={runs} agents={agents} />}
              {page === "help" && <HelpPage />}
              {page === "database" && <DatabasePage agents={agents} skills={skills} runs={runs} />}
              {page === "apikeys" && <ApiKeysPage />}
              {page === "creator" && <CreatorPage agents={agents} setAgents={setAgents} skills={skills} setSkills={setSkills} />}
              {page === "playground" && <PlaygroundPage skills={skills} />}
            </div>
          )}

          {page === "chat" && chatAgent && (
            <ChatPage
              agent={chatAgent}
              agents={agents}
              onSelectAgent={a => { setChatAgent(a); }}
              setAgents={setAgents}
              skills={skills}
              conversations={conversations}
              setConversations={setConversations}
            />
          )}
        </div>
      </div>
    </>
  );
}
