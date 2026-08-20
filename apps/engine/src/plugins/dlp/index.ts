import type { PluginCapabilities, PluginDlpCategory, PluginDlpConfig } from "@openleash/shared";
import { dlpManifest as manifest } from "./manifest.js";
import { pluginRun, type PromptPipelineResult } from "../types.js";

export { manifest };

type DlpFinding = { category: PluginDlpCategory; quote: string; reason: string };
type DlpInspection = {
  prompt: string;
  blocked: boolean;
  requiresApproval: boolean;
  matched: boolean;
  masked: boolean;
  model: string;
  categories: PluginDlpCategory[];
  findings: DlpFinding[];
};
type DlpLlmResult = {
  matched: boolean;
  categories: PluginDlpCategory[];
  findings: DlpFinding[];
  maskedText: string;
  recommendation: "allow" | "mask" | "block";
  explanation: string;
};

export async function runDlp({
  prompt,
  config,
  capabilities,
  startedAt
}: {
  prompt: string;
  config: PluginDlpConfig;
  capabilities: PluginCapabilities;
  startedAt: number;
}) {
  if (!config.enabled) {
    return {
      prompt,
      result: undefined,
      run: pluginRun({
        pluginId: manifest.id,
        event: "prompt.beforeSubmit",
        status: "skipped",
        summary: "DLP is disabled.",
        startedAt
      })
    };
  }

  const inspected = await inspectPrompt(prompt, config, capabilities);
  const dlp: NonNullable<PromptPipelineResult["dlp"]> = {
    enabled: true,
    action: config.action,
    matched: inspected.matched,
    categories: inspected.categories,
    findings: inspected.findings,
    masked: inspected.masked
  };
  const summary = dlpSummary(dlp, inspected.blocked);
  if (inspected.matched) {
    await capabilities.signals.emit({
      kind: "secret.detected",
      severity: inspected.blocked ? "high" : "medium",
      title: inspected.blocked ? "Sensitive data blocked" : "Sensitive data detected",
      summary,
      decision: inspected.blocked ? "blocked" : inspected.requiresApproval ? "ask" : inspected.masked ? "observed" : "allow",
      status: inspected.masked ? "masked" : inspected.blocked ? "blocked" : inspected.requiresApproval ? "needs_question" : "observed",
      target: { type: "prompt", name: "agent prompt" },
      evidence: inspected.findings.map((finding) => ({
        category: finding.category,
        reason: finding.reason,
        quote: finding.quote
      })),
      details: {
        categories: inspected.categories,
        action: config.action,
        model: inspected.model
      },
      correlationKeys: inspected.categories.map((category) => `dlp:${category}`)
    });
  }
  const result = {
    finalPrompt: inspected.prompt,
    blocked: inspected.blocked,
    requiresApproval: inspected.requiresApproval,
    summary,
    model: inspected.model,
    dlp
  };

  return {
    prompt: inspected.prompt,
    result,
    run: pluginRun({
      pluginId: manifest.id,
      event: "prompt.beforeSubmit",
      status: inspected.blocked ? "blocked" : inspected.requiresApproval ? "needs_question" : inspected.masked ? "modified" : "passed",
      summary,
      startedAt,
      findings: inspected.findings.map((finding) => ({
        title: `${finding.category.toUpperCase()} detected`,
        severity: inspected.blocked ? "high" : "medium",
        summary: finding.reason,
        evidence: [finding.quote]
      })),
      metadata: {
        model: inspected.model,
        dlp
      }
    })
  };
}

async function inspectPrompt(prompt: string, config: PluginDlpConfig, capabilities: PluginCapabilities): Promise<DlpInspection> {
  const heuristic = heuristicDlp(prompt, config);
  const llm = await capabilities.llm.evaluateJson<DlpLlmResult>({
    purpose: "data-leakage-prevention",
    system: dlpSystemPrompt(config),
    prompt: JSON.stringify({
      action: config.action,
      categories: config.categories,
      text: prompt,
      heuristicFindings: heuristic.findings
    }),
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["matched", "categories", "findings", "maskedText", "recommendation", "explanation"],
      properties: {
        matched: { type: "boolean" },
        categories: { type: "array", items: { type: "string", enum: ["pii", "phi", "tokens", "keys", "credentials"] } },
        findings: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["category", "quote", "reason"],
            properties: {
              category: { type: "string", enum: ["pii", "phi", "tokens", "keys", "credentials"] },
              quote: { type: "string" },
              reason: { type: "string" }
            }
          }
        },
        maskedText: { type: "string" },
        recommendation: { type: "string", enum: ["allow", "mask", "block"] },
        explanation: { type: "string" }
      }
    },
    temperature: 0,
    maxOutputTokens: 1800
  });
  const llmFindings = sanitizeFindings(llm?.json?.findings ?? [], config);
  const findings = dedupeFindings([...heuristic.findings, ...llmFindings]);
  const categories = [...new Set(findings.map((finding) => finding.category))];
  const matched = heuristic.matched || Boolean(llm?.json?.matched) || findings.length > 0;
  const blocked = config.action === "block" && matched;
  const requiresApproval = config.action === "ask" && matched;
  const llmMasked = typeof llm?.json?.maskedText === "string" && llm.json.maskedText.trim() ? llm.json.maskedText : "";
  const maskedText = config.action === "mask"
    ? usefulMaskedText(prompt, llmMasked) ? llmMasked : maskWithFindings(heuristic.prompt, findings)
    : prompt;
  const masked = config.action === "mask" && maskedText !== prompt;
  return {
    prompt: masked ? maskedText : prompt,
    blocked,
    requiresApproval,
    matched,
    masked,
    model: llm?.model ?? heuristic.model,
    categories,
    findings
  };
}

function dlpSystemPrompt(config: PluginDlpConfig) {
  return [
    "You are the data-leakage-prevention OpenLeash plugin.",
    "Inspect the text for only these enabled categories: " + config.categories.join(", ") + ".",
    "Detect actual sensitive values, not generic discussion of security.",
    "If masking, replace only sensitive values with stable placeholders such as [TOKEN_MASKED], [EMAIL_MASKED], [PRIVATE_KEY_MASKED], [CREDENTIAL_MASKED], [PHI_MASKED]. Preserve the rest of the text.",
    "Return JSON only."
  ].join("\n");
}

function heuristicDlp(prompt: string, config: PluginDlpConfig): DlpInspection {
  let text = prompt;
  const findings: DlpFinding[] = [];
  const add = (category: PluginDlpCategory, regex: RegExp, replacement: string | ((match: string) => string), reason: string) => {
    if (!config.categories.includes(category)) return;
    text = text.replace(regex, (match) => {
      findings.push({ category, quote: String(match).slice(0, 160), reason });
      return typeof replacement === "function" ? replacement(String(match)) : replacement;
    });
  };
  add("pii", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[EMAIL_MASKED]", "Email address detected.");
  add("pii", /\b\d{3}-\d{2}-\d{4}\b/g, "[SSN_MASKED]", "US SSN-like value detected.");
  add("pii", /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g, "[PHONE_MASKED]", "Phone number detected.");
  add("tokens", /\b(?:sk|pk|ol|ghp|github_pat)_[A-Za-z0-9_=-]{12,}\b/g, "[TOKEN_MASKED]", "Token-like value detected.");
  add("tokens", /\b(?:sk|pk)-(?:proj-)?[A-Za-z0-9_-]{12,}\b/g, "[TOKEN_MASKED]", "Provider token-like value detected.");
  add("tokens", /\b[A-Za-z0-9_]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/g, "[JWT_MASKED]", "JWT-like token detected.");
  add("keys", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g, "[PRIVATE_KEY_MASKED]", "Private key block detected.");
  add("credentials", /\b(password|passwd|secret|api[_-]?key|access[_-]?key|client[_-]?secret)\s*[:=]\s*['"]?[^'"\s]{8,}/gi, (match) => `${match.split(/[:=]/)[0].trim()}=[CREDENTIAL_MASKED]`, "Credential assignment detected.");
  add("credentials", /\b(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|GOOGLE_APPLICATION_CREDENTIALS|DATABASE_URL|REDIS_URL|SECRET_KEY|TOKEN)\s*=\s*[^ \n]{8,}/g, (match) => `${match.split("=")[0]}=[CREDENTIAL_MASKED]`, "Environment credential detected.");
  add("phi", /\b(patient|diagnosis|medical record|mrn|prescription|blood pressure|lab result)\b[^\n]{0,120}/gi, "[PHI_MASKED]", "Health-data context detected.");
  const categories = [...new Set(findings.map((item) => item.category))];
  const matched = findings.length > 0;
  return {
    prompt: config.action === "mask" ? text : prompt,
    blocked: config.action === "block" && matched,
    requiresApproval: config.action === "ask" && matched,
    matched,
    masked: config.action === "mask" && text !== prompt,
    model: "dlp-heuristic",
    categories,
    findings
  };
}

function sanitizeFindings(value: unknown, config: PluginDlpConfig): DlpFinding[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const category = record.category;
    if (!isDlpCategory(category) || !config.categories.includes(category)) return [];
    const quote = typeof record.quote === "string" ? record.quote.trim().slice(0, 160) : "";
    const reason = typeof record.reason === "string" ? record.reason.trim() : "Sensitive value detected.";
    if (!quote) return [];
    return [{ category, quote, reason }];
  });
}

function dedupeFindings(findings: DlpFinding[]) {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.category}:${finding.quote.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

function usefulMaskedText(original: string, masked: string) {
  if (!masked || masked === original) return false;
  if (masked.length < original.length * 0.2) return false;
  return true;
}

function maskWithFindings(prompt: string, findings: DlpFinding[]) {
  let text = prompt;
  for (const finding of findings) {
    const replacement = `[${finding.category.toUpperCase()}_MASKED]`;
    if (finding.quote) text = text.split(finding.quote).join(replacement);
  }
  return text;
}

function isDlpCategory(value: unknown): value is PluginDlpCategory {
  return value === "pii" || value === "phi" || value === "tokens" || value === "keys" || value === "credentials";
}

function dlpSummary(dlp: NonNullable<PromptPipelineResult["dlp"]>, blocked: boolean) {
  if (!dlp.matched) return "DLP checked with no sensitive data detected.";
  const categories = dlp.categories.join(", ") || "sensitive data";
  if (blocked) return `DLP blocked prompt submission: ${categories}.`;
  if (dlp.action === "ask") return `DLP paused the prompt for your approval: ${categories}.`;
  if (dlp.masked) return `DLP masked ${categories}.`;
  return `DLP detected ${categories}.`;
}
