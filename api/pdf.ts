// ─── /api/pdf.ts ─────────────────────────────────────────────────────────────
// Extracts text from a PDF or image using Gemini's multimodal capabilities.
// Called by the client when a user uploads a PDF file in chat.
// Requires: GEMINI_API_KEY environment variable.
// ─────────────────────────────────────────────────────────────────────────────

export const config = { maxDuration: 60 };

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(400).json({
      error: "PDF reading requires a GEMINI_API_KEY. Add it in Vercel → Settings → Environment Variables."
    });
  }

  const { file_data, mime_type, prompt } = req.body || {};
  if (!file_data) return res.status(400).json({ error: "Missing file_data (base64 string)" });

  // Strip the data: URL prefix if present
  const base64 = file_data.replace(/^data:[^;]+;base64,/, "");
  const fileMime = mime_type || "application/pdf";

  const extractPrompt = prompt ||
    "Extract and transcribe all text from this document completely and accurately. " +
    "Preserve the structure (headings, tables, bullet points). " +
    "If there are images or charts, describe them briefly.";

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: fileMime, data: base64 } },
              { text: extractPrompt },
            ],
          }],
          generationConfig: { maxOutputTokens: 8192, temperature: 0.1 },
        }),
      }
    );
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error?.message || `Gemini error ${r.status}`);
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return res.status(200).json({ text, pages_detected: (text.match(/\n\n/g) || []).length });
  } catch (err: any) {
    return res.status(502).json({ error: err.message });
  }
}
