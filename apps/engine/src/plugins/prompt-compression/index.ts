import type { PluginCapabilities, PluginPromptCompressionConfig } from "@openleash/shared";
import { promptCompressionManifest as manifest } from "./manifest.js";
import { pluginRun, type PromptPipelineResult } from "../types.js";

export { manifest };

type TokenSaverLlmResult = {
  compressed: string;
  reason: string;
};

export async function runPromptCompression({
  prompt,
  config,
  capabilities,
  startedAt,
  supportsPromptReplacement = true
}: {
  prompt: string;
  config: PluginPromptCompressionConfig;
  capabilities: PluginCapabilities;
  startedAt: number;
  supportsPromptReplacement?: boolean;
}) {
  if (!config.enabled) {
    return {
      prompt,
      result: undefined,
      run: pluginRun({
        pluginId: manifest.id,
        event: "prompt.beforeSubmit",
        status: "skipped",
        summary: "token-saver is disabled.",
        startedAt
      })
    };
  }

  if (!supportsPromptReplacement) {
    return {
      prompt,
      result: undefined,
      run: pluginRun({
        pluginId: manifest.id,
        event: "prompt.beforeSubmit",
        status: "skipped",
        summary: "token-saver skipped: this agent hook cannot replace submitted prompts.",
        startedAt,
        metadata: {
          deliveryStatus: "unsupported",
          inputCharacters: prompt.length,
          outputCharacters: prompt.length,
          savedCharacters: 0,
          savedPercent: 0,
          triggeredAt: new Date(startedAt).toISOString()
        }
      })
    };
  }

  const llm = await capabilities.llm.evaluateJson<TokenSaverLlmResult>({
    purpose: "token-saver",
    system: tokenSaverSystemPrompt(config.level),
    prompt: JSON.stringify({
      level: config.level,
      conciseResponse: config.conciseResponse,
      text: prompt
    }),
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["compressed", "reason"],
      properties: {
        compressed: { type: "string" },
        reason: { type: "string" }
      }
    },
    temperature: 0,
    maxOutputTokens: maxOutputTokensFor(prompt, config.level)
  });
  const llmCompressed = typeof llm?.json?.compressed === "string" ? llm.json.compressed.trim() : "";
  let finalPrompt = usefulCompression(prompt, llmCompressed) ? llmCompressed : heuristicCompress(prompt, config.level);
  if (config.conciseResponse) {
    finalPrompt = `${finalPrompt.trim()}\n\nRespond concisely. Be short, direct, and avoid filler.`;
  }
  if (finalPrompt.length >= prompt.length) finalPrompt = prompt;
  const model = llm?.model ?? "token-saver-heuristic";
  const compression: NonNullable<PromptPipelineResult["compression"]> = {
    enabled: true,
    originalLength: prompt.length,
    compressedLength: finalPrompt.length,
    ratio: prompt.length > 0 ? finalPrompt.length / prompt.length : 1
  };
  await capabilities.usage.record({
    kind: "llm.tokens",
    model,
    provider: llm?.provider ?? "openleash-plugin",
    inputTokens: prompt.length,
    outputTokens: finalPrompt.length,
    savedTokens: Math.max(0, prompt.length - finalPrompt.length),
    details: {
      level: config.level,
      conciseResponse: config.conciseResponse,
      reason: llm?.json?.reason,
      source: llm?.source ?? "heuristic",
      ratio: compression.ratio
    }
  });
  const savedPercent = prompt.length > 0 ? Math.max(0, Math.round((1 - finalPrompt.length / prompt.length) * 100)) : 0;
  await capabilities.island.annotateSession({
    key: "token-savings",
    label: "token-saver",
    value: `${savedPercent}% saved`,
    detail: savedPercent > 0
      ? `Reduced the latest prompt from ${prompt.length} to ${finalPrompt.length} characters.`
      : "Checked the latest prompt; shortening it would not preserve enough useful context.",
    tone: savedPercent > 0 ? "success" : "neutral",
    ttlSeconds: 3_600,
    action: { id: "open-token-saver", label: "token-saver settings", type: "open-plugin-settings" }
  });
  const summary = compressionSummary(prompt, finalPrompt, compression);
  const result = {
    finalPrompt,
    blocked: false,
    summary,
    model,
    compression
  };

  return {
    prompt: finalPrompt,
    result,
    run: pluginRun({
      pluginId: manifest.id,
      event: "prompt.beforeSubmit",
      status: finalPrompt !== prompt ? "modified" : "passed",
      summary,
      startedAt,
      metadata: {
        model,
        source: llm?.source ?? "heuristic",
        compression,
        input: prompt,
        output: finalPrompt,
        inputCharacters: prompt.length,
        outputCharacters: finalPrompt.length,
        savedCharacters: Math.max(0, prompt.length - finalPrompt.length),
        savedPercent: prompt.length > 0 ? Math.round((1 - finalPrompt.length / prompt.length) * 1000) / 10 : 0,
        triggeredAt: new Date(startedAt).toISOString(),
        deliveryStatus: finalPrompt !== prompt ? "returned-to-agent-adapter" : "unchanged"
      }
    })
  };
}

function tokenSaverSystemPrompt(level: PluginPromptCompressionConfig["level"]) {
  const aggressiveness = level === "maximum"
    ? "Compress aggressively."
    : level === "light"
      ? "Compress lightly."
      : "Compress moderately.";
  return [
    "You are the token-saver OpenLeash plugin.",
    aggressiveness,
    "Rewrite the provided prompt to use fewer tokens while preserving all user intent, hard constraints, security requirements, file paths, commands, identifiers, quoted values, and acceptance criteria.",
    "Do not add facts. Do not remove tasks. Do not summarize code or secrets away if they are required for the user's request.",
    "Return JSON only."
  ].join("\n");
}

function maxOutputTokensFor(prompt: string, level: PluginPromptCompressionConfig["level"]) {
  const divisor = level === "maximum" ? 5 : level === "light" ? 2 : 3;
  return Math.max(256, Math.min(4096, Math.ceil(prompt.length / divisor)));
}

function usefulCompression(original: string, candidate: string) {
  if (!candidate) return false;
  if (candidate.length >= original.length * 0.98) return false;
  if (candidate.length < 40 && original.length > 300) return false;
  return true;
}

function heuristicCompress(prompt: string, level: PluginPromptCompressionConfig["level"]) {
  const normalized = prompt.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (level === "light") return normalized;
  const limit = level === "maximum" ? 1800 : 3600;
  return normalized.length > limit ? `${normalized.slice(0, limit).trim()}\n\n[token-saver removed repetitive trailing context.]` : normalized;
}

function compressionSummary(
  originalPrompt: string,
  finalPrompt: string,
  compression: NonNullable<PromptPipelineResult["compression"]>
) {
  if (finalPrompt === originalPrompt) return "token-saver checked with no changes.";
  return `token-saver reduced prompt from ${compression.originalLength} to ${compression.compressedLength} chars.`;
}
