export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const startTime = Date.now();
  try {
    const { provider, model, system_prompt, message, fallback_provider, fallback_model } = req.body;
    let responseText = "";
    let usedProvider = provider;
    let usedModel = model;
    let isFallback = false;

    const callAI = async (prov: string, mod: string, sysPrompt: string, userMsg: string) => {
      if (prov === 'deepseek') {
        const response = await fetch('https://api.deepseek.com/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}` },
          body: JSON.stringify({ model: mod || 'deepseek-chat', messages: [{ role: 'system', content: sysPrompt }, { role: 'user', content: userMsg }] })
        });
        const data = await response.json();
        return data.choices[0].message.content;
      }
      if (prov === 'claude') {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY || '', 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model: mod || 'claude-3-5-sonnet-20240620', max_tokens: 1024, system: sysPrompt, messages: [{ role: 'user', content: userMsg }] })
        });
        const data = await response.json();
        return data.content[0].text;
      }
      if (prov === 'gemini') {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${mod || 'gemini-1.5-flash'}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ systemInstruction: { parts: [{ text: sysPrompt }] }, contents: [{ parts: [{ text: userMsg }] }] })
        });
        const data = await response.json();
        return data.candidates[0].content.parts[0].text;
      }
      throw new Error("Unknown AI provider");
    };

    try {
      responseText = await callAI(provider, model, system_prompt, message);
    } catch (err) {
      if (fallback_provider) {
        isFallback = true;
        usedProvider = fallback_provider;
        usedModel = fallback_model;
        responseText = await callAI(fallback_provider, fallback_model, system_prompt, message);
      } else throw err;
    }

    return res.status(200).json({
      response: responseText,
      provider_used: usedProvider,
      model_used: usedModel,
      fallback_triggered: isFallback,
      latency_ms: Date.now() - startTime,
      tokens_used: Math.round((message.length + responseText.length) / 4)
    });

  } catch (error: any) {
    res.status(500).json({ error: error.message || "Failed to communicate with AI" });
  }
}
