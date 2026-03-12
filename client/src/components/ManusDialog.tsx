import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.use(express.json());

  // ─── UPGRADED SECURE AI ROUTER ───
  // This matches exactly what your App.jsx expects!
  app.post('/api/chat', async (req, res) => {
    const startTime = Date.now();
    try {
      // Receive all the advanced data from your frontend
      const { provider, model, system_prompt, message, fallback_provider, fallback_model } = req.body;

      let responseText = "";
      let usedProvider = provider;
      let usedModel = model;
      let isFallback = false;

      // Master function to call specific AIs
      const callAI = async (prov: string, mod: string, sysPrompt: string, userMsg: string) => {
        // --- DEEPSEEK ---
        if (prov === 'deepseek') {
          const response = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
              model: mod || 'deepseek-chat',
              messages: [
                { role: 'system', content: sysPrompt },
                { role: 'user', content: userMsg }
              ]
            })
          });
          const data = await response.json();
          if (data.error) throw new Error(data.error.message);
          return data.choices[0].message.content;
        }

        // --- CLAUDE (Anthropic) ---
        if (prov === 'claude') {
          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': process.env.ANTHROPIC_API_KEY || '',
              'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
              model: mod || 'claude-3-5-sonnet-20240620',
              max_tokens: 1024,
              system: sysPrompt,
              messages: [{ role: 'user', content: userMsg }]
            })
          });
          const data = await response.json();
          if (data.error) throw new Error(data.error.message);
          return data.content[0].text;
        }

        // --- GEMINI ---
        if (prov === 'gemini') {
          const apiKey = process.env.GEMINI_API_KEY;
          const targetModel = mod || 'gemini-1.5-flash';
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: sysPrompt }] },
              contents: [{ parts: [{ text: userMsg }] }]
            })
          });
          const data = await response.json();
          if (data.error) throw new Error(data.error.message);
          return data.candidates[0].content.parts[0].text;
        }

        throw new Error("Unknown AI provider");
      };

      try {
        // 1. Try the primary AI
        responseText = await callAI(provider, model, system_prompt, message);
      } catch (err) {
        // 2. If it fails, trigger the Fallback AI (just like your frontend wants!)
        if (fallback_provider) {
          isFallback = true;
          usedProvider = fallback_provider;
          usedModel = fallback_model;
          responseText = await callAI(fallback_provider, fallback_model, system_prompt, message);
        } else {
          throw err;
        }
      }

      // Calculate stats for your UI
      const latency_ms = Date.now() - startTime;
      const tokens_used = Math.round((message.length + responseText.length) / 4); // Fast estimation

      // Send the perfect payload back to App.jsx
      return res.json({
        response: responseText,
        provider_used: usedProvider,
        model_used: usedModel,
        fallback_triggered: isFallback,
        latency_ms,
        tokens_used
      });

    } catch (error: any) {
      console.error("AI Error:", error);
      res.status(500).json({ error: error.message || "Failed to communicate with AI" });
    }
  });
  // ─── END UPGRADED ROUTER ───

  // Serve static files
  const staticPath = process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
