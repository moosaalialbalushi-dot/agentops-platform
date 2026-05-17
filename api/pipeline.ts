import { callProvider, ChatMessage, ProviderParams } from "../shared/ai-providers";
import { sendError, sendSuccess } from "../shared/api-utils";

export const config = { maxDuration: 120 };

async function executeStep(step: any, input: string, prevOutput: string) {
  const prompt = (step.prompt_template || "{{input}}")
    .replace(/\{\{input\}\}/g, input)
    .replace(/\{\{prev\}\}/g, prevOutput || input);

  const params: ProviderParams = {
    model: step.model,
    system_prompt: step.system_prompt || "You are a helpful AI assistant.",
    messages: [{ role: "user", content: prompt }],
    max_tokens: step.max_tokens || 2048,
    temperature: step.temperature ?? 0.7,
  };

  const result = await callProvider(step.provider, params);
  return {
    text: result.response,
    tokens: result.tokens_used,
    latency_ms: result.latency_ms,
    isImage: result.is_image || false,
  };
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { steps, input, skill_name } = req.body || {};

  if (!input) return sendError(res, "Missing required field: input", 400);
  if (!steps || !Array.isArray(steps) || steps.length === 0)
    return sendError(res, "Missing required field: steps (array)", 400);

  const stepsOutput: any[] = [];
  let prevOutput = "";
  let fatalError = false;

  const groups: any[][] = [];
  for (const step of steps) {
    if (step.parallel && groups.length > 0 && groups[groups.length - 1][0]?.parallel) {
      groups[groups.length - 1].push(step);
    } else {
      groups.push([step]);
    }
  }

  let globalIndex = 0;
  for (const group of groups) {
    if (fatalError) break;

    if (group.length === 1) {
      const step = group[0];
      const idx = globalIndex++;
      try {
        const result = await executeStep(step, input, prevOutput);
        stepsOutput.push({
          index: idx,
          label: step.label || `Step ${idx + 1}`,
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
          index: idx,
          label: step.label || `Step ${idx + 1}`,
          provider: step.provider,
          model: step.model,
          output: `⚠ Step failed: ${e.message}`,
          is_image: false,
          tokens: 0,
          latency_ms: 0,
          error: true,
        });
        fatalError = true;
      }
    } else {
      const baseIdx = globalIndex;
      globalIndex += group.length;
      const settled = await Promise.allSettled(
        group.map(step => executeStep(step, input, prevOutput))
      );
      const parallelOutputs: string[] = [];
      let groupHadError = false;
      settled.forEach((result, i) => {
        const step = group[i];
        const idx = baseIdx + i;
        if (result.status === "fulfilled") {
          const r = result.value;
          stepsOutput.push({
            index: idx,
            label: step.label || `Step ${idx + 1}`,
            provider: step.provider,
            model: step.model,
            output: r.text,
            is_image: r.isImage || false,
            tokens: r.tokens,
            latency_ms: r.latency_ms,
            parallel: true,
          });
          parallelOutputs.push(r.isImage ? `[image generated: ${r.text.slice(0, 60)}...]` : r.text);
        } else {
          stepsOutput.push({
            index: idx,
            label: step.label || `Step ${idx + 1}`,
            provider: step.provider,
            model: step.model,
            output: `⚠ Step failed: ${result.reason?.message}`,
            is_image: false,
            tokens: 0,
            latency_ms: 0,
            error: true,
            parallel: true,
          });
          groupHadError = true;
        }
      });
      prevOutput = parallelOutputs.join("\n\n---\n\n");
      if (groupHadError) fatalError = true;
    }
  }

  const finalStep = stepsOutput[stepsOutput.length - 1];
  return sendSuccess(res, {
    skill_name: skill_name || "Pipeline",
    steps_output: stepsOutput,
    final_output: finalStep?.output || "",
    is_image: finalStep?.is_image || false,
    total_tokens: stepsOutput.reduce((s, x) => s + (x.tokens || 0), 0),
    total_latency_ms: stepsOutput.reduce((s, x) => s + (x.latency_ms || 0), 0),
  });
}
