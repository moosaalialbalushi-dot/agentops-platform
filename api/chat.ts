// ─── /api/chat.js ────────────────────────────────────────────────────────────
// Vercel Serverless Function — Multi-provider AI proxy
// Supports: Claude, Gemini, DeepSeek, OpenAI, Groq + fallback logic
// Supports multi-turn conversation history via `messages` array
//
// Required Environment Variables (set in Vercel Dashboard → Settings → Env):
//   ANTHROPIC_API_KEY   → for Claude
//   GEMINI_API_KEY      → for Gemini
//   DEEPSEEK_API_KEY    → for DeepSeek
//   OPENAI_API_KEY      → for OpenAI
//   GROQ_API_KEY        → for Groq
// ─────────────────────────────────────────────────────────────────────────────

export const config = { maxDuration: 60 };

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ProviderParams {
  model?: string;
  system_prompt?: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  baseUrl?: string;
  apiKey?: string;
}

// ─── Provider Callers ────────────────────────────────────────────────────────

async function callClaude({ model, system_prompt, messages, max_tokens, temperature }: ProviderParams) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const start = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || "claude-sonnet-4-6",
      max_tokens: max_tokens || 1024,
      system: system_prompt || "You are a helpful AI agent.",
      temperature: temperature ?? 0.7,
      messages, // full conversation history [{role:"user"|"assistant", content}]
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Claude error ${res.status}`);

  return {
    response: data.content?.[0]?.text || "",
    tokens_used: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    latency_ms: Date.now() - start,
  };
}

async function callGemini({ model, system_prompt, messages, max_tokens, temperature }: ProviderParams) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const start = Date.now();
  const modelName = model || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  // Convert messages to Gemini format (role "model" instead of "assistant")
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: system_prompt ? { parts: [{ text: system_prompt }] } : undefined,
      contents,
      generationConfig: {
        maxOutputTokens: max_tokens || 1024,
        temperature: temperature ?? 0.7,
      },
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Gemini error ${res.status}`);

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const tokens = (data.usageMetadata?.promptTokenCount || 0) + (data.usageMetadata?.candidatesTokenCount || 0);

  return { response: text, tokens_used: tokens, latency_ms: Date.now() - start };
}

async function callOpenAI({ model, system_prompt, messages, max_tokens, temperature, baseUrl, apiKey: customKey }: ProviderParams) {
  const apiKey = customKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const start = Date.now();
  const res = await fetch(`${baseUrl || "https://api.openai.com"}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "gpt-4o",
      max_tokens: max_tokens || 1024,
      temperature: temperature ?? 0.7,
      messages: [
        { role: "system", content: system_prompt || "You are a helpful AI agent." },
        ...messages, // full conversation history
      ],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `OpenAI error ${res.status}`);

  return {
    response: data.choices?.[0]?.message?.content || "",
    tokens_used: data.usage?.total_tokens || 0,
    latency_ms: Date.now() - start,
  };
}

async function callDeepSeek({ model, system_prompt, messages, max_tokens, temperature }: ProviderParams) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set");

  return callOpenAI({
    model: model || "deepseek-chat",
    system_prompt,
    messages,
    max_tokens,
    temperature,
    baseUrl: "https://api.deepseek.com",
    apiKey,
  });
}

async function callGroq({ model, system_prompt, messages, max_tokens, temperature }: ProviderParams) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not set");

  return callOpenAI({
    model: model || "llama-3.3-70b-versatile",
    system_prompt,
    messages,
    max_tokens,
    temperature,
    baseUrl: "https://api.groq.com/openai",
    apiKey,
  });
}

// ─── NotebookLM — powered by Gemini 2.5 Pro with specialized prompts ────────

const NOTEBOOKLM_PROMPTS: Record<string, string> = {
  "notebooklm-research":
    "You are NotebookLM, a research assistant specialized in deep document analysis, source synthesis, and evidence-based reasoning. Extract key insights, identify connections between ideas, and produce well-cited summaries with clear headings.",
  "notebooklm-slides":
    "You are NotebookLM in Slides mode. Convert content into a Markdown slide deck. Use '---' between slides. Each slide: ## Title, 3-5 bullets, and 'Notes: ...' for speaker notes.",
  "notebooklm-summary":
    "You are NotebookLM in Summary mode. Produce a structured summary with: Executive Summary, Key Concepts, Important Details, and Takeaways sections.",
  "notebooklm-qa":
    "You are NotebookLM in Q&A mode. Generate 5-8 insightful Q&A pairs covering the most important aspects. Format: **Q: ...** / **A: ...**",
  "notebooklm-podcast":
    "You are NotebookLM in Audio Overview mode. Write a conversational podcast script (Host A / Host B) that explains the content in an engaging, accessible way.",
};

async function callNotebookLM(params: ProviderParams) {
  const nlmPrompt = NOTEBOOKLM_PROMPTS[params.model || "notebooklm-research"]
    || NOTEBOOKLM_PROMPTS["notebooklm-research"];
  const merged = {
    ...params,
    model: "gemini-2.5-pro-preview-05-06",
    system_prompt: `${nlmPrompt}\n\n${params.system_prompt || ""}`.trim(),
    temperature: 0.4,
  };
  return callGemini(merged);
}

// ─── Imagen — Google image generation via Gemini API key ─────────────────────

async function callImagen(params: ProviderParams) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set (required for Imagen)");

  const model = params.model || "imagen-3.0-generate-002";
  const prompt = params.messages[params.messages.length - 1]?.content || "";
  const start = Date.now();

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1 },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Imagen error ${res.status}`);

  const b64 = data.predictions?.[0]?.bytesBase64Encoded;
  const mime = data.predictions?.[0]?.mimeType || "image/png";
  const dataUrl = b64 ? `data:${mime};base64,${b64}` : "";

  return {
    response: dataUrl,
    tokens_used: 0,
    latency_ms: Date.now() - start,
    is_image: true,
  };
}

// ─── Provider Router ─────────────────────────────────────────────────────────

async function callProvider(provider: string, params: ProviderParams) {
  switch (provider?.toLowerCase()) {
    case "claude":      return callClaude(params);
    case "gemini":      return callGemini(params);
    case "openai":      return callOpenAI(params);
    case "deepseek":    return callDeepSeek(params);
    case "groq":        return callGroq(params);
    case "notebooklm":  return callNotebookLM(params);
    case "imagen":      return callImagen(params);
    default:            throw new Error(`Unknown provider: "${provider}". Supported: claude, gemini, openai, deepseek, groq, notebooklm, imagen`);
  }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });

  const {
    provider,
    model,
    system_prompt,
    message,           // single message (backwards compat)
    messages,          // full conversation history [{role, content}] — preferred
    max_tokens,
    temperature,
    fallback_provider,
    fallback_model,
  } = req.body || {};

  if (!provider) return res.status(400).json({ error: "Missing required field: provider" });
  if (!message && (!messages || messages.length === 0))
    return res.status(400).json({ error: "Missing required field: message or messages" });

  // Build the messages array: prefer full history, fall back to single message
  const chatMessages: ChatMessage[] =
    messages && messages.length > 0
      ? messages
      : [{ role: "user" as const, content: message }];

  const params: ProviderParams = { model, system_prompt, messages: chatMessages, max_tokens, temperature };

  // ── Try primary provider ──────────────────────────────────────────────────
  try {
    const result = await callProvider(provider, params);
    return res.status(200).json({
      response:           result.response,
      provider_used:      provider,
      model_used:         model || provider,
      tokens_used:        result.tokens_used,
      latency_ms:         result.latency_ms,
      fallback_triggered: false,
    });
  } catch (primaryError: any) {
    console.error(`[AgentOps] Primary provider "${provider}" failed:`, primaryError.message);

    // ── Try fallback provider if configured ──────────────────────────────────
    if (fallback_provider) {
      try {
        const fallbackParams = { ...params, model: fallback_model || undefined };
        const result = await callProvider(fallback_provider, fallbackParams);
        return res.status(200).json({
          response:           result.response,
          provider_used:      fallback_provider,
          model_used:         fallback_model || fallback_provider,
          tokens_used:        result.tokens_used,
          latency_ms:         result.latency_ms,
          fallback_triggered: true,
        });
      } catch (fallbackError: any) {
        console.error(`[AgentOps] Fallback provider "${fallback_provider}" also failed:`, fallbackError.message);
        return res.status(502).json({
          error: `Both providers failed. Primary (${provider}): ${primaryError.message}. Fallback (${fallback_provider}): ${fallbackError.message}`,
        });
      }
    }

    return res.status(502).json({
      error: `Provider "${provider}" failed: ${primaryError.message}`,
    });
  }
}
