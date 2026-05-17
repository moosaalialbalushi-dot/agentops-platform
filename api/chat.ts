import { callProvider, ChatMessage, ProviderParams } from "../shared/ai-providers";
import { handleApiError, sendError } from "../shared/api-utils";

export const config = { maxDuration: 60 };

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
    message,
    messages,
    max_tokens,
    temperature,
    fallback_provider,
    fallback_model,
  } = req.body || {};

  if (!provider) return sendError(res, "Missing required field: provider", 400);
  if (!message && (!messages || messages.length === 0))
    return sendError(res, "Missing required field: message or messages", 400);

  const chatMessages: ChatMessage[] =
    messages && messages.length > 0
      ? messages
      : [{ role: "user", content: message }];

  const params: ProviderParams = {
    model,
    system_prompt,
    messages: chatMessages,
    max_tokens: max_tokens ? parseInt(String(max_tokens), 10) : 1024,
    temperature: temperature !== undefined ? parseFloat(String(temperature)) : 0.7,
  };

  try {
    const result = await callProvider(provider, params);
    return res.status(200).json({
      response: result.response,
      provider_used: provider,
      model_used: model || provider,
      tokens_used: result.tokens_used,
      latency_ms: result.latency_ms,
      fallback_triggered: false,
    });
  } catch (primaryError: any) {
    console.error(`[AgentOps] Primary provider "${provider}" failed:`, primaryError.message);

    if (fallback_provider) {
      try {
        const fallbackParams = { ...params, model: fallback_model || undefined };
        const result = await callProvider(fallback_provider, fallbackParams);
        return res.status(200).json({
          response: result.response,
          provider_used: fallback_provider,
          model_used: fallback_model || fallback_provider,
          tokens_used: result.tokens_used,
          latency_ms: result.latency_ms,
          fallback_triggered: true,
        });
      } catch (fallbackError: any) {
        console.error(`[AgentOps] Fallback provider "${fallback_provider}" also failed:`, fallbackError.message);
        return sendError(res, `Both providers failed. Primary (${provider}): ${primaryError.message}. Fallback (${fallback_provider}): ${fallbackError.message}`, 502);
      }
    }

    return sendError(res, `Provider "${provider}" failed: ${primaryError.message}`, 502);
  }
}
