// ─── /api/pipeline.ts ────────────────────────────────────────────────────────
// Multi-step skill pipeline executor
// Each step runs a provider call; output of step N feeds into step N+1 via {{prev}}
// Supports: text generation, image generation (Imagen), NotebookLM-style analysis
// ─────────────────────────────────────────────────────────────────────────────

export const config = { maxDuration: 120 };

// ─── Shared provider callers (mirrors api/chat.ts) ───────────────────────────

async function callOpenAICompat(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: { role: string; content: string }[],
  maxTokens = 2048,
  temperature = 0.7
) {
  const start = Date.now();
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `${baseUrl} error ${res.status}`);
  return {
    text: data.choices?.[0]?.message?.content || "",
    tokens: data.usage?.total_tokens || 0,
    latency_ms: Date.now() - start,
  };
}

async function callClaude(model: string, systemPrompt: string, messages: { role: string; content: string }[], maxTokens = 2048, temperature = 0.7) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  const start = Date.now();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature, system: systemPrompt, messages }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Claude error ${res.status}`);
  return {
    text: data.content?.[0]?.text || "",
    tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
    latency_ms: Date.now() - start,
  };
}

async function callGemini(model: string, systemPrompt: string, messages: { role: string; content: string }[], maxTokens = 2048, temperature = 0.7) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");
  const start = Date.now();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
      contents,
      generationConfig: { maxOutputTokens: maxTokens, temperature },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Gemini error ${res.status}`);
  return {
    text: data.candidates?.[0]?.content?.parts?.[0]?.text || "",
    tokens: (data.usageMetadata?.promptTokenCount || 0) + (data.usageMetadata?.candidatesTokenCount || 0),
    latency_ms: Date.now() - start,
  };
}

// Imagen — Google image generation
async function callImagen(model: string, prompt: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set (used for Imagen)");
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
  return {
    text: b64 ? `data:${mime};base64,${b64}` : "",
    isImage: true,
    tokens: 0,
    latency_ms: Date.now() - start,
  };
}

// NotebookLM — uses Gemini 2.5 Pro with specialized research/document prompt
const NOTEBOOKLM_SYSTEM_PROMPTS: Record<string, string> = {
  "notebooklm-research":
    "You are NotebookLM, a research assistant specialized in deep document analysis, source synthesis, and evidence-based reasoning. Extract key insights, identify connections between ideas, and produce well-cited summaries. Structure your output with clear headings.",
  "notebooklm-slides":
    "You are NotebookLM in Slides mode. Convert the provided content into a clean slide deck in Markdown format. Use '---' to separate slides. Each slide should have a title (## heading), 3-5 bullet points, and speaker notes prefixed with 'Notes:'. Keep language concise and visual.",
  "notebooklm-summary":
    "You are NotebookLM in Summary mode. Create a comprehensive yet concise summary of the provided material. Include: Executive Summary, Key Concepts, Important Details, and Takeaways. Use clear headers and bullet points.",
  "notebooklm-qa":
    "You are NotebookLM in Q&A mode. Generate a set of insightful questions and detailed answers based on the provided content. Produce 5-8 Q&A pairs that cover the most important aspects. Format as: **Q: ...** followed by **A: ...**",
  "notebooklm-podcast":
    "You are NotebookLM in Audio Overview mode. Generate a conversational podcast script between two hosts (Host A and Host B) that discusses and explains the provided content in an engaging way. Make it informative yet approachable. Format: 'Host A: ...' / 'Host B: ...'",
};

async function callNotebookLM(model: string, userContent: string, maxTokens = 4096) {
  const systemPrompt = NOTEBOOKLM_SYSTEM_PROMPTS[model] || NOTEBOOKLM_SYSTEM_PROMPTS["notebooklm-research"];
  const geminiModel = "gemini-2.5-pro-preview-05-06";
  return callGemini(geminiModel, systemPrompt, [{ role: "user", content: userContent }], maxTokens, 0.4);
}

// ─── Step executor ───────────────────────────────────────────────────────────

async function executeStep(step: any, input: string, prevOutput: string) {
  const prompt = (step.prompt_template || "{{input}}")
    .replace(/\{\{input\}\}/g, input)
    .replace(/\{\{prev\}\}/g, prevOutput || input);

  const model = step.model || "";
  const maxTokens = step.max_tokens || 2048;
  const temp = step.temperature ?? 0.7;
  const systemPrompt = step.system_prompt || "You are a helpful AI assistant.";
  const msgs = [{ role: "user", content: prompt }];

  switch (step.provider?.toLowerCase()) {
    case "claude":
      return callClaude(model || "claude-sonnet-4-6", systemPrompt, msgs, maxTokens, temp);

    case "gemini":
      return callGemini(model || "gemini-2.0-flash", systemPrompt, msgs, maxTokens, temp);

    case "openai":
      return callOpenAICompat(
        "https://api.openai.com",
        process.env.OPENAI_API_KEY || "",
        model || "gpt-4o",
        systemPrompt, msgs, maxTokens, temp
      );

    case "deepseek":
      return callOpenAICompat(
        "https://api.deepseek.com",
        process.env.DEEPSEEK_API_KEY || "",
        model || "deepseek-chat",
        systemPrompt, msgs, maxTokens, temp
      );

    case "groq":
      return callOpenAICompat(
        "https://api.groq.com/openai",
        process.env.GROQ_API_KEY || "",
        model || "llama-3.3-70b-versatile",
        systemPrompt, msgs, maxTokens, temp
      );

    case "imagen":
      return callImagen(model || "imagen-3.0-generate-002", prompt);

    case "notebooklm":
      return callNotebookLM(model, prompt, maxTokens);

    default:
      throw new Error(`Unknown pipeline step provider: "${step.provider}"`);
  }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { steps, input, skill_name } = req.body || {};

  if (!input) return res.status(400).json({ error: "Missing required field: input" });
  if (!steps || !Array.isArray(steps) || steps.length === 0)
    return res.status(400).json({ error: "Missing required field: steps (array)" });

  const stepsOutput: any[] = [];
  let prevOutput = "";

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    try {
      const result = await executeStep(step, input, prevOutput);
      stepsOutput.push({
        index: i,
        label: step.label || `Step ${i + 1}`,
        provider: step.provider,
        model: step.model,
        output: result.text,
        is_image: result.isImage || false,
        tokens: result.tokens,
        latency_ms: result.latency_ms,
      });
      prevOutput = result.isImage ? `[image generated: ${result.text.slice(0, 60)}...]` : result.text;
    } catch (e: any) {
      stepsOutput.push({
        index: i,
        label: step.label || `Step ${i + 1}`,
        provider: step.provider,
        model: step.model,
        output: `⚠ Step failed: ${e.message}`,
        is_image: false,
        tokens: 0,
        latency_ms: 0,
        error: true,
      });
      // Stop pipeline on error
      break;
    }
  }

  const finalStep = stepsOutput[stepsOutput.length - 1];
  return res.status(200).json({
    skill_name: skill_name || "Pipeline",
    steps_output: stepsOutput,
    final_output: finalStep?.output || "",
    is_image: finalStep?.is_image || false,
    total_tokens: stepsOutput.reduce((s, x) => s + (x.tokens || 0), 0),
    total_latency_ms: stepsOutput.reduce((s, x) => s + (x.latency_ms || 0), 0),
  });
}
