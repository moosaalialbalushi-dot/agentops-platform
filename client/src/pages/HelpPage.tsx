import React from "react";
import { C } from "../lib/constants";

export function HelpPage() {
  const S = {
    card: { background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px 18px", marginBottom: 14 },
    h: { fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 800, marginBottom: 10, color: C.accentHi },
    h2: { fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 5, marginTop: 10 },
    p: { fontSize: 12, color: C.muted, lineHeight: 1.8, marginBottom: 6 },
    tag: { display: "inline-block", fontSize: 10, padding: "2px 8px", borderRadius: 4, fontFamily: "'JetBrains Mono',monospace", marginRight: 5, marginBottom: 3 }
  };

  return (
    <div className="slide-in" style={{ maxWidth: 760 }}>

      <div style={S.card}>
        <div style={S.h}>⬡ Agents — what they are</div>
        <p style={S.p}>An <strong>Agent</strong> is an AI assistant you configure. Each agent has a name, a personality (persona), one or more AI providers, and a system prompt that tells it how to behave.</p>
        <p style={{ ...S.p, marginBottom: 0 }}>Agents can have <strong>Skills</strong> assigned to them. When you chat with an agent, it knows about its skills and can use them.</p>
        <div style={S.h2}>Personas</div>
        <p style={S.p}>
          <span style={{ ...S.tag, background: C.cyan + "15", color: C.cyan }}>◎ Researcher</span> — deep analysis, citations, reports<br />
          <span style={{ ...S.tag, background: "#ef444415", color: "#ef4444" }}>⬟ Guardian</span> — compliance, security, risk review<br />
          <span style={{ ...S.tag, background: C.purple + "15", color: C.purple }}>⌘ Connector</span> — integrations, data pipelines, external APIs<br />
          <span style={{ ...S.tag, background: "#f59e0b15", color: "#f59e0b" }}>◈ Strategist</span> — planning, decisions, roadmaps<br />
          <span style={{ ...S.tag, background: C.accent + "15", color: C.accent }}>⬡ Architect</span> — system design, technical structure<br />
          <span style={{ ...S.tag, background: C.green + "15", color: C.green }}>⚙ Engineer</span> — code, automation, technical tasks
        </p>
        <div style={S.h2}>Quick Create an Agent</div>
        <p style={S.p}>Go to <strong>Agents → + New Agent</strong>. Minimum required: just a <em>name</em> and select a <em>provider</em>. Everything else is optional — the agent will still work with defaults.</p>
        <p style={S.p}>💡 Tip: Use the <strong>✨ Enhance</strong> button on the System Prompt to let AI improve your instructions automatically.</p>
      </div>

      <div style={S.card}>
        <div style={S.h}>◈ Skills — what they are</div>
        <p style={S.p}>A <strong>Skill</strong> is a reusable task or prompt that an agent can run. Skills appear as quick-action buttons in the chat window.</p>
        <div style={S.h2}>Single-step skill</div>
        <p style={S.p}>Fills in the Description field as a prompt. The agent runs it once and returns the result. Good for: summarisation, translation, formatting, tone rewriting.</p>
        <div style={S.h2}>Pipeline skill (multi-step)</div>
        <p style={S.p}>Chains multiple AI steps together. Each step can use a different provider/model. Use <code>{"{{input}}"}</code> for the user's message and <code>{"{{prev}}"}</code> for the previous step's output.</p>
        <p style={S.p}>Example pipeline: Step 1 (DeepSeek) → research the topic → Step 2 (NotebookLM) → format as slides → Step 3 (Claude) → write executive summary.</p>
      </div>

      <div style={S.card}>
        <div style={S.h}>⌘ Connectors — what they are</div>
        <p style={S.p}>Connectors are external services your agents can interact with: WhatsApp, Slack, Email, GitHub, Google Drive, Telegram, webhooks, and custom APIs.</p>
        <p style={S.p}>Currently the Connectors page lets you <strong>register and configure</strong> the connection details (tokens, URLs, bot keys). The agent uses these connection details when you include the connector in its workflow.</p>
        <p style={S.p}>Think of them as the "phone numbers" your agent knows — you store the connection info once, then assign the connector to an agent.</p>
      </div>

      <div style={S.card}>
        <div style={S.h}>💬 Chat — how to use it</div>
        <div style={S.h2}>Sending messages</div>
        <p style={S.p}>Select an agent from the dropdown at the top. Type and press <strong>Enter</strong>. The agent remembers the full conversation history (multi-turn).</p>
        <div style={S.h2}>Attaching PDFs</div>
        <p style={S.p}>Click 📎 and select a PDF, image, or text file. PDFs are automatically read using Gemini (requires <code>GEMINI_API_KEY</code> in Vercel). The extracted text is included in your message to any provider.</p>
        <div style={S.h2}>Chat history</div>
        <p style={S.p}>Click <strong>🕐 History</strong> to see all past conversations with the current agent. Click any conversation to restore it. Each session auto-saves after every AI reply.</p>
        <div style={S.h2}>Exporting</div>
        <p style={S.p}>Click <strong>↓ Export</strong> → choose Markdown, JSON, or <strong>Print / PDF</strong> to save the conversation as a PDF file using your browser's print dialog.</p>
      </div>

      <div style={S.card}>
        <div style={S.h}>⊞ NotebookLM — how it works</div>
        <p style={S.p}>There is <strong>no public API for Google NotebookLM</strong>. In this app, "NotebookLM" is a simulation using <strong>Gemini 2.5 Pro</strong> with specialised research prompts.</p>
        <p style={S.p}>It requires <code>GEMINI_API_KEY</code> in Vercel env vars. The modes:</p>
        <p style={S.p}>
          <span style={{ ...S.tag, background: C.accent + "15", color: C.accent }}>research</span> Deep report with citations<br />
          <span style={{ ...S.tag, background: C.accent + "15", color: C.accent }}>slides</span> Markdown slide deck (--- separators)<br />
          <span style={{ ...S.tag, background: C.accent + "15", color: C.accent }}>summary</span> Executive summary + key concepts<br />
          <span style={{ ...S.tag, background: C.accent + "15", color: C.accent }}>Q&amp;A</span> 5–8 question/answer pairs<br />
          <span style={{ ...S.tag, background: C.accent + "15", color: C.accent }}>podcast</span> Two-host conversational script
        </p>
      </div>

      <div style={S.card}>
        <div style={S.h}>▶ Veo — video generation</div>
        <p style={S.p}>Google Veo 2 generates videos from text prompts. Select <strong>Veo</strong> as a provider in an agent, choose model <code>veo-2.0-generate-001</code>, and describe what you want in the chat.</p>
        <p style={S.p}>Requires <code>GEMINI_API_KEY</code>. Video generation takes 1–3 minutes. The app polls for up to 55 seconds; if it's not ready, it returns an Operation ID you can use to check later.</p>
      </div>

      <div style={S.card}>
        <div style={S.h}>⚙ Setting up API keys</div>
        <p style={S.p}>All API keys live in <strong>Vercel → Settings → Environment Variables</strong>. After adding keys, click <strong>Redeploy</strong>. Use the <strong>API Keys → Check Now</strong> button to verify which providers are live.</p>
        <p style={S.p}>
          <span style={{ ...S.tag, background: "#d9770615", color: "#d97706" }}>ANTHROPIC_API_KEY</span> Claude — console.anthropic.com<br />
          <span style={{ ...S.tag, background: "#4285f415", color: "#4285f4" }}>GEMINI_API_KEY</span> Gemini + Imagen + NotebookLM + Veo — aistudio.google.com<br />
          <span style={{ ...S.tag, background: "#7c3aed15", color: "#7c3aed" }}>OPENROUTER_API_KEY</span> 300+ models (free + paid) — openrouter.ai/keys<br />
          <span style={{ ...S.tag, background: "#f5503615", color: "#f55036" }}>GROQ_API_KEY</span> Llama/Mixtral (fast &amp; free) — console.groq.com
        </p>
      </div>

    </div>
  );
}
