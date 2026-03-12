// ─── /api/chat.js ────────────────────────────────────────────────────────────
// Vercel Serverless Function — Multi-provider AI proxy
// Supports: Claude, Gemini, DeepSeek, OpenAI, Groq + fallback logic
//
// Required Environment Variables (set in Vercel Dashboard → Settings → Env):
//   ANTHROPIC_API_KEY   → for Claude
//   GEMINI_API_KEY      → for Gemini
//   DEEPSEEK_API_KEY    → for DeepSeek
//   OPENAI_API_KEY      → for OpenAI
//   GROQ_API_KEY        → for Groq
// ─────────────────────────────────────────────────────────────────────────────

export const config = { maxDuration: 60 };

// ─── Provider Callers ────────────────────────────────────────────────────────

async function callClaude({ model, system_prompt, message, max_tokens }) {
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
      messages: [{ role: "user", content: message }],
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

async function callGemini({ model, system_prompt, message, max_tokens }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const start = Date.now();
  const modelName = model || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: system_prompt ? { parts: [{ text: system_prompt }] } : undefined,
      contents: [{ role: "user", parts: [{ text: message }] }],
      generationConfig: { maxOutputTokens: max_tokens || 1024 },
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Gemini error ${res.status}`);

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const tokens = (data.usageMetadata?.promptTokenCount || 0) + (data.usageMetadata?.candidatesTokenCount || 0);

  return { response: text, tokens_used: tokens, latency_ms: Date.now() - start };
}

async function callOpenAI({ model, system_prompt, message, max_tokens, baseUrl, apiKey: customKey }) {
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
      messages: [
        { role: "system", content: system_prompt || "You are a helpful AI agent." },
        { role: "user", content: message },
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

async function callDeepSeek({ model, system_prompt, message, max_tokens }) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set");

  // DeepSeek uses the OpenAI-compatible API
  return callOpenAI({
    model: model || "deepseek-chat",
    system_prompt,
    message,
    max_tokens,
    baseUrl: "https://api.deepseek.com",
    apiKey,
  });
}

async function callGroq({ model, system_prompt, message, max_tokens }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not set");

  // Groq also uses the OpenAI-compatible API
  return callOpenAI({
    model: model || "llama-3.3-70b-versatile",
    system_prompt,
    message,
    max_tokens,
    baseUrl: "https://api.groq.com/openai",
    apiKey,
  });
}

// ─── Provider Router ─────────────────────────────────────────────────────────

async function callProvider(provider, params) {
  switch (provider?.toLowerCase()) {
    case "claude":    return callClaude(params);
    case "gemini":    return callGemini(params);
    case "openai":    return callOpenAI(params);
    case "deepseek":  return callDeepSeek(params);
    case "groq":      return callGroq(params);
    default:          throw new Error(`Unknown provider: "${provider}". Supported: claude, gemini, openai, deepseek, groq`);
  }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Allow CORS for local dev
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed. Use POST." });

  const {
    provider,
    model,
    system_prompt,
    message,
    max_tokens,
    fallback_provider,
    fallback_model,
  } = req.body || {};

  // Validate required fields
  if (!provider) return res.status(400).json({ error: "Missing required field: provider" });
  if (!message)  return res.status(400).json({ error: "Missing required field: message" });

  const params = { model, system_prompt, message, max_tokens };

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
  } catch (primaryError) {
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
      } catch (fallbackError) {
        console.error(`[AgentOps] Fallback provider "${fallback_provider}" also failed:`, fallbackError.message);
        return res.status(502).json({
          error: `Both providers failed. Primary (${provider}): ${primaryError.message}. Fallback (${fallback_provider}): ${fallbackError.message}`,
        });
      }
    }

    // No fallback configured — return the primary error
    return res.status(502).json({
      error: `Provider "${provider}" failed: ${primaryError.message}`,
    });
  }
}
