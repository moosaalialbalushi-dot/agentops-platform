import React, { useState } from "react";
import { C, PROVIDERS } from "../lib/constants";

const ENV_KEY_DEFS = [
  { env: "ANTHROPIC_API_KEY", provider: "claude", label: "Claude (Anthropic)", logo: "◆", color: "#d97706", hint: "sk-ant-api03-...", where: "console.anthropic.com → API Keys" },
  { env: "GEMINI_API_KEY", provider: "gemini", label: "Google Gemini / Imagen / NotebookLM / Veo", logo: "✦", color: "#4285f4", hint: "AIzaSy...", where: "aistudio.google.com → Get API key" },
  { env: "ZHIPU_API_KEY", provider: "zhipu", label: "Z AI — Zhipu (GLM-4, GLM-Z1 reasoning)", logo: "Z", color: "#00b4d8", hint: "your-zhipu-key", where: "bigmodel.cn → API Keys" },
  { env: "OPENROUTER_API_KEY", provider: "openrouter", label: "OpenRouter (300+ models, free + paid)", logo: "⊛", color: "#7c3aed", hint: "sk-or-v1-...", where: "openrouter.ai/keys" },
  { env: "DEEPSEEK_API_KEY", provider: "deepseek", label: "DeepSeek", logo: "◉", color: "#10b981", hint: "sk-...", where: "platform.deepseek.com → API keys" },
  { env: "OPENAI_API_KEY", provider: "openai", label: "OpenAI (GPT-4, o3, DALL-E)", logo: "⊕", color: "#74aa9c", hint: "sk-proj-...", where: "platform.openai.com/api-keys" },
  { env: "GROQ_API_KEY",       provider: "groq",       label: "Groq (ultra-fast Llama / Mixtral)", logo: "◧", color: "#f55036", hint: "gsk_...", where: "console.groq.com/keys" },
  { env: "MISTRAL_API_KEY",    provider: "mistral",    label: "Mistral AI", logo: "◐", color: "#ff7000", hint: "...", where: "console.mistral.ai/api-keys" },
  { env: "COHERE_API_KEY",     provider: "cohere",     label: "Cohere", logo: "◑", color: "#39594d", hint: "...", where: "dashboard.cohere.com/api-keys" },
  { env: "ERNIE_API_KEY",      provider: "ernie_image", label: "Ernie Image", logo: "E", color: "#ff7000", hint: "...", where: "cloud.baidu.com" },
  { env: "CUSTOM_API_KEY",     provider: "custom",     label: "Custom Provider", logo: "✳", color: "#8b5cf6", hint: "your key", where: "Your provider's dashboard" },
  { env: "CUSTOM_API_URL",     provider: "custom",     label: "Custom API Base URL", logo: "🌐", color: "#64748b", hint: "https://...", where: "Your provider's docs" },
];

export function ApiKeysPage() {
  const [status, setStatus] = useState<Record<string, boolean> | null>(null);
  const [checking, setChecking] = useState(false);

  const checkStatus = async () => {
    setChecking(true);
    try {
      const r = await fetch("/api/status");
      const res = await r.json();
      const data = res.data || res;
      setStatus(data.providers || {});
    } catch {
      setStatus({});
    } finally { setChecking(false); }
  };

  return (
    <div className="slide-in" style={{ maxWidth: 720 }}>
      <div style={{ background: C.accent + "12", border: `1px solid ${C.accent}30`, borderRadius: 10, padding: "14px 16px", marginBottom: 22 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: C.accentHi }}>⚙ How to configure API keys</div>
        <ol style={{ paddingLeft: 18, fontSize: 12, lineHeight: 2, color: C.text }}>
          <li>Open your <strong>Vercel Dashboard</strong> → select the <em>agentops-platform</em> project</li>
          <li>Go to <strong>Settings → Environment Variables</strong></li>
          <li>Add each key using the exact variable name shown below</li>
          <li>Click <strong>Save</strong>, then <strong>Redeploy</strong> the project for changes to take effect</li>
        </ol>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 22 }}>
        {ENV_KEY_DEFS.map(k => (
          <div key={k.env} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, padding: "12px 14px", display: "flex", alignItems: "flex-start", gap: 12 }}>
            <div style={{ width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", background: k.color + "18", color: k.color, border: `1px solid ${k.color}30`, borderRadius: 8, fontSize: 15, flexShrink: 0 }}>{k.logo}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 3 }}>{k.label}</div>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: C.cyan, background: C.surface, padding: "3px 8px", borderRadius: 5, display: "inline-block", marginBottom: 4 }}>{k.env}</div>
              <div style={{ fontSize: 11, color: C.muted }}>Get it at: <span style={{ color: C.text }}>{k.where}</span></div>
            </div>
            {status && (
              <span style={{ fontSize: 10, color: status[k.provider] ? C.green : C.dim, background: (status[k.provider] ? C.green : C.dim) + "15", padding: "3px 9px", borderRadius: 4, fontFamily: "'JetBrains Mono',monospace", flexShrink: 0, alignSelf: "center" }}>
                {status[k.provider] ? "✓ SET" : "NOT SET"}
              </span>
            )}
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: status ? 14 : 0 }}>
          <div style={{ fontWeight: 700, fontSize: 12 }}>◎ Live Connection Status</div>
          <button className="btn btn-primary" onClick={checkStatus} disabled={checking} style={{ fontSize: 11, padding: "5px 14px" }}>
            {checking ? "Checking…" : "Check Now"}
          </button>
        </div>
        {status && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {Object.entries(PROVIDERS).map(([k, p]) => {
              const isSet = !!status[k];
              return (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: C.surface, borderRadius: 7, border: `1px solid ${isSet ? C.green + "40" : C.border}` }}>
                  <span style={{ color: (p as any).color, fontSize: 12 }}>{(p as any).logo}</span>
                  <span style={{ fontSize: 11, fontWeight: 500 }}>{(p as any).label}</span>
                  <span style={{ fontSize: 10, color: isSet ? C.green : C.dim, fontFamily: "'JetBrains Mono',monospace" }}>{isSet ? "ON" : "OFF"}</span>
                </div>
              );
            })}
          </div>
        )}
        {!status && <div style={{ fontSize: 12, color: C.muted }}>Click "Check Now" to verify which providers are configured on the server.</div>}
      </div>
    </div>
  );
}
