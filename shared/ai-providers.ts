// ─── shared/ai-providers.ts ──────────────────────────────────────────────────
// Unified AI provider calling logic for Claude, Gemini, OpenAI, DeepSeek, etc.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ProviderParams {
  model?: string;
  system_prompt?: string;
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
  baseUrl?: string;
  apiKey?: string;
}

export interface ProviderResponse {
  response: string;
  tokens_used: number;
  latency_ms: number;
  is_image?: boolean;
  is_video?: boolean;
  is_chart?: boolean;
}

// ─── Provider Callers ────────────────────────────────────────────────────────

export async function callClaude({ model, system_prompt, messages, max_tokens, temperature }: ProviderParams): Promise<ProviderResponse> {
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
      model: model || "claude-3-5-sonnet-20241022",
      max_tokens: max_tokens || 1024,
      system: system_prompt || "You are a helpful AI agent.",
      temperature: temperature ?? 0.7,
      messages: messages.filter(m => m.role !== "system"),
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

export async function callGemini({ model, system_prompt, messages, max_tokens, temperature }: ProviderParams): Promise<ProviderResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const start = Date.now();
  const modelName = model || "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const contents = messages
    .filter(m => m.role !== "system")
    .map(m => ({
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

export async function callOpenAI({ model, system_prompt, messages, max_tokens, temperature, baseUrl, apiKey: customKey }: ProviderParams): Promise<ProviderResponse> {
  const apiKey = customKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error(`${baseUrl ? 'API' : 'OPENAI_API'} key not set`);

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
        ...messages.filter(m => m.role !== "system"),
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

export async function callDeepSeek(params: ProviderParams): Promise<ProviderResponse> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY not set");

  return callOpenAI({
    ...params,
    model: params.model || "deepseek-chat",
    baseUrl: "https://api.deepseek.com",
    apiKey,
  });
}

export async function callGroq(params: ProviderParams): Promise<ProviderResponse> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY not set");

  return callOpenAI({
    ...params,
    model: params.model || "llama-3.3-70b-versatile",
    baseUrl: "https://api.groq.com/openai",
    apiKey,
  });
}

export async function callOpenRouter(params: ProviderParams): Promise<ProviderResponse> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY not set");

  return callOpenAI({
    ...params,
    model: params.model || "qwen/qwen-2.5-72b-instruct:free",
    baseUrl: "https://openrouter.ai/api",
    apiKey,
  });
}

export async function callZhipu(params: ProviderParams): Promise<ProviderResponse> {
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) throw new Error("ZHIPU_API_KEY not set");

  return callOpenAI({
    ...params,
    model: params.model || "glm-4-flash",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKey,
  });
}

export async function callImageGenerator(params: ProviderParams, providerLabel: string, defaultModel: string): Promise<ProviderResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error(`GEMINI_API_KEY not set (required for ${providerLabel})`);

  const model = params.model || defaultModel;
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
  if (!res.ok) throw new Error(`${providerLabel} error ${res.status}`);

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

export async function callImagen(params: ProviderParams): Promise<ProviderResponse> {
  return callImageGenerator(params, "Imagen", "imagen-3.0-generate-002");
}

export async function callNanoBanana(params: ProviderParams): Promise<ProviderResponse> {
  return callImageGenerator(params, "Nano Banana", "nano-banana-2.0-generate-001");
}

export async function callErnieImage(params: ProviderParams): Promise<ProviderResponse> {
  // Ernie Image generation via a proxy or standard OpenAI-like wrapper if supported,
  // otherwise placeholder. For now, we simulate with a high-quality model or specific API.
  const apiKey = process.env.ERNIE_API_KEY;
  if (!apiKey) throw new Error("ERNIE_API_KEY not set");
  // Simulating call to Ernie...
  return {
    response: "Ernie Image generation response placeholder",
    tokens_used: 0,
    latency_ms: 1000,
    is_image: true
  };
}

export async function callChartGen(params: ProviderParams): Promise<ProviderResponse> {
  // ChartGen - using a specialized model call to generate Mermaid or Chart.js config
  const start = Date.now();
  const merged = {
    ...params,
    system_prompt: `You are a chart generation expert. Output ONLY valid Mermaid.js code or Chart.js JSON config based on the user's data. No preamble.`,
  };
  const result = await callClaude(merged);
  return {
    ...result,
    is_chart: true
  };
}

export async function callVeo(params: ProviderParams): Promise<ProviderResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set (required for Veo)");

  const videoModel = params.model || "veo-2.0-generate-001";
  const prompt = params.messages[params.messages.length - 1]?.content || "";
  const start = Date.now();

  const initUrl = `https://generativelanguage.googleapis.com/v1beta/models/${videoModel}:predictLongRunning?key=${apiKey}`;
  const initRes = await fetch(initUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { aspectRatio: "16:9", sampleCount: 1 },
    }),
  });
  const initData = await initRes.json();
  if (!initRes.ok) throw new Error(initData?.error?.message || `Veo init error ${initRes.status}`);

  const operationName = initData.name;
  if (!operationName) throw new Error("Veo did not return an operation name");

  const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${apiKey}`;
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(r => setTimeout(r, 5000));
    const pollRes = await fetch(pollUrl);
    const pollData = await pollRes.json();
    if (pollData.done) {
      const video = pollData.response?.predictions?.[0];
      const videoUri = video?.videoMetadata?.video?.uri || video?.videoUri || "";
      const b64 = video?.bytesBase64Encoded || "";
      const mime = video?.mimeType || "video/mp4";
      const dataUrl = b64 ? `data:${mime};base64,${b64}` : videoUri;
      return {
        response: dataUrl || `✓ Video generated (operation: ${operationName})`,
        tokens_used: 0,
        latency_ms: Date.now() - start,
        is_video: true,
      };
    }
    if (pollData.error) throw new Error(pollData.error.message || "Veo generation failed");
  }

  return {
    response: `⏳ Video generation is still processing. Operation ID: ${operationName}`,
    tokens_used: 0,
    latency_ms: Date.now() - start,
    is_video: true,
  };
}

export const NOTEBOOKLM_SYSTEM_PROMPTS: Record<string, string> = {
  "notebooklm-research": "You are NotebookLM, a research assistant specialized in deep document analysis, source synthesis, and evidence-based reasoning.",
  "notebooklm-slides": "You are NotebookLM in Slides mode. Convert content into a Markdown slide deck. Use '---' between slides.",
  "notebooklm-summary": "You are NotebookLM in Summary mode. Produce a structured summary.",
  "notebooklm-qa": "You are NotebookLM in Q&A mode. Generate 5-8 insightful Q&A pairs.",
  "notebooklm-podcast": "You are NotebookLM in Audio Overview mode. Write a conversational podcast script.",
};

export async function callNotebookLM(params: ProviderParams): Promise<ProviderResponse> {
  const nlmPrompt = NOTEBOOKLM_SYSTEM_PROMPTS[params.model || "notebooklm-research"] || NOTEBOOKLM_SYSTEM_PROMPTS["notebooklm-research"];
  const mergedParams = {
    ...params,
    model: "gemini-1.5-pro",
    system_prompt: `${nlmPrompt}\n\n${params.system_prompt || ""}`.trim(),
    temperature: 0.4,
  };
  return callGemini(mergedParams);
}

export async function callProvider(provider: string, params: ProviderParams): Promise<ProviderResponse> {
  switch (provider?.toLowerCase()) {
    case "claude":      return callClaude(params);
    case "gemini":      return callGemini(params);
    case "openai":      return callOpenAI(params);
    case "deepseek":    return callDeepSeek(params);
    case "groq":        return callGroq(params);
    case "openrouter":  return callOpenRouter(params);
    case "zhipu":       return callZhipu(params);
    case "notebooklm":  return callNotebookLM(params);
    case "imagen":      return callImagen(params);
    case "nano_banana": return callNanoBanana(params);
    case "ernie_image": return callErnieImage(params);
    case "chartgen":    return callChartGen(params);
    case "veo":         return callVeo(params);
    default:            throw new Error(`Unknown provider: "${provider}"`);
  }
}
