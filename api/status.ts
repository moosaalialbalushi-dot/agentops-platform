// ─── /api/status.ts ───────────────────────────────────────────────────────────
// Returns which AI provider environment variables are configured on the server.
// No keys are returned — only a boolean presence check.
// ─────────────────────────────────────────────────────────────────────────────

export const config = { maxDuration: 5 };

export default function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const providers: Record<string, boolean> = {
    claude:      !!process.env.ANTHROPIC_API_KEY,
    gemini:      !!process.env.GEMINI_API_KEY,
    openai:      !!process.env.OPENAI_API_KEY,
    deepseek:    !!process.env.DEEPSEEK_API_KEY,
    groq:        !!process.env.GROQ_API_KEY,
    mistral:     !!process.env.MISTRAL_API_KEY,
    cohere:      !!process.env.COHERE_API_KEY,
    openrouter:  !!process.env.OPENROUTER_API_KEY,
    notebooklm:  !!process.env.GEMINI_API_KEY,  // uses Gemini key
    imagen:      !!process.env.GEMINI_API_KEY,  // uses Gemini key
    veo:         !!process.env.GEMINI_API_KEY,  // uses Gemini key
    custom:      !!process.env.CUSTOM_API_KEY,
  };

  return res.status(200).json({ providers });
}
