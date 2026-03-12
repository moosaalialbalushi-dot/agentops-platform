import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  // --- 1. CRITICAL ADDITION: This allows the server to read JSON data from the frontend ---
  app.use(express.json());

  // --- 2. YOUR AI API ROUTES GO HERE ---
  // Secure multi-AI route
  app.post('/api/chat', async (req, res) => {
    try {
      const { message, provider } = req.body;

      // DeepSeek Route
      if (provider === 'deepseek') {
        const response = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: message }]
          })
        });
        const data = await response.json();
        return res.json({ reply: data.choices[0].message.content });
      }

      // Anthropic Route
      if (provider === 'anthropic') {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.ANTHROPIC_API_KEY || '',
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-3-5-sonnet-20240620',
            max_tokens: 1024,
            messages: [{ role: 'user', content: message }]
          })
        });
        const data = await response.json();
        return res.json({ reply: data.content[0].text });
      }

      // Gemini Route
      if (provider === 'gemini') {
        const apiKey = process.env.GEMINI_API_KEY;
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: message }] }]
          })
        });
        const data = await response.json();
        return res.json({ reply: data.candidates[0].content.parts[0].text });
      }

      // If no matching provider is found
      return res.status(400).json({ error: "Invalid AI provider selected" });

    } catch (error) {
      console.error("AI Error:", error);
      res.status(500).json({ error: "Something went wrong communicating with the AI" });
    }
  });
  // --- END OF AI ROUTES ---

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = process.env.PORT || 3000;

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
