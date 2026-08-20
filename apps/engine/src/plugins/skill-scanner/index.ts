import type { PluginCapabilities } from "@openleash/shared";
import { skillScannerManifest as manifest } from "./manifest.js";
import { pluginRun, type SkillObservationInput, type SkillObservationResult } from "../types.js";

export { manifest };

const DEFAULT_SUSPICIOUS_RISK_THRESHOLD = 50;
const MALICIOUS_RISK_THRESHOLD = 90;
const MAX_SKILL_CONTENT_CHARS = 24000;

type SkillAssessment = {
  malicious: boolean;
  riskScore: number;
  reasons: Array<{ reason: string; quote?: string }>;
};

type SkillScannerLlmResult = {
  malicious: boolean;
  riskScore: number;
  reasons: Array<{ reason: string; quote?: string }>;
};

export const SKILL_SCANNER_EVALUATION_SYSTEM_PROMPT = [
  "You are OpenLeash skill-scanner, a security evaluator for local AI-agent skills.",
  "A skill is loaded from a local agent skills folder, usually as SKILL.md or an equivalent agent-specific skill file.",
  "Flag a skill only when the skill content itself contains clear, actionable malicious instructions or code.",
  "The threshold is intentionally high: credential theft/exfiltration, network upload of secrets, bypassing approval/safety controls, persistence/backdoors, dynamically executing untrusted downloaded code, or broad destructive commands that explicitly avoid approval.",
  "Do not flag normal skill documentation merely because it mentions allowed tools, reading or writing its own config files, mkdir, deleting its own pending/config entries, API keys as setup inputs, or other ordinary task-specific file operations.",
  "Do not flag skills merely for being installed, named agent-skill, describing installation, syncing skills, editing SKILL.md, or mentioning hooks/security in a defensive or administrative context.",
  "Prefer false negatives over noisy false positives. If the concern is only generic capability, return malicious=false.",
  "Set malicious=true only when riskScore is 90 or higher and include short exact quotes that prove the suspicious behavior.",
  "Return compact JSON only. Quotes must be copied from the skill content."
].join(" ");

export const SKILL_SCANNER_EVALUATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["malicious", "riskScore", "reasons"],
  properties: {
    malicious: { type: "boolean" },
    riskScore: { type: "number", minimum: 0, maximum: 100 },
    reasons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["reason"],
        properties: {
          reason: { type: "string" },
          quote: { type: "string" }
        }
      }
    }
  }
};

export async function runSkillScanner(input: SkillObservationInput, capabilities?: PluginCapabilities): Promise<SkillObservationResult> {
  const startedAt = Date.now();
  const content = String(input.content ?? input.contentPreview ?? "");
  const assessment = await evaluateSkillAssessment(input, content, capabilities);
  const riskScore = Math.max(0, Math.min(100, Number(assessment.riskScore ?? input.riskScore ?? 0)));
  const suspicious =
    input.status === "suspicious" ||
    assessment.malicious ||
    assessment.reasons.length > 0 ||
    riskScore >= DEFAULT_SUSPICIOUS_RISK_THRESHOLD;
  const status = suspicious ? "suspicious" : "observed";
  const normalizedRiskScore = suspicious && riskScore === 0 ? 70 : riskScore;
  const findings = assessment.reasons.map((reason) => ({
    title: "Suspicious skill behavior",
    severity: "high" as const,
    summary: reason.reason,
    evidence: reason.quote ? [reason.quote] : undefined
  }));
  if (capabilities && suspicious) {
    await capabilities.signals.emit({
      kind: "security.finding",
      severity: "high",
      title: "Suspicious skill behavior",
      summary: "Skill scanner found behavior that needs review.",
      decision: "ask",
      status,
      target: {
        type: "agent_skill",
        name: input.skillName
      },
      evidence: assessment.reasons,
      details: {
        skillName: input.skillName,
        skillPath: input.skillPath,
        agentKind: input.agentKind,
        agentName: input.agentName,
        riskScore: normalizedRiskScore
      },
      correlationKeys: [`skill:${input.skillName}`, `agent:${input.agentKind}`]
    });
    await capabilities.notification.send({
      level: "critical",
      title: "Possible malicious skill",
      summary: `${input.skillName} may contain unsafe instructions. Delete this skill or approve it?`,
      dedupeKey: `skill-scanner:${input.skillPath}:${normalizedRiskScore}`,
      scope: { agentKind: input.agentKind, projectPath: input.skillPath },
      minIntervalSeconds: 3600
    });
    await capabilities.log.emit({
      level: "security",
      category: "security",
      code: "skill-scanner.suspicious-skill",
      message: "Skill scanner found behavior that needs review.",
      data: {
        skillName: input.skillName,
        skillPath: input.skillPath,
        riskScore: normalizedRiskScore,
        reasons: assessment.reasons
      }
    });
  }

  return {
    status,
    riskScore: normalizedRiskScore,
    reasons: assessment.reasons,
    findings,
    run: pluginRun({
      pluginId: manifest.id,
      event: input.event ?? "skill.changed",
      status: suspicious ? "needs_question" : "passed",
      summary: suspicious
        ? "Skill scanner found behavior that needs review."
        : "Skill scanner observed the skill without suspicious findings.",
      startedAt,
      findings,
      metadata: {
        skillName: input.skillName,
        skillPath: input.skillPath,
        evaluatedBy: capabilities ? "plugin-llm-or-heuristic" : "precomputed-or-heuristic"
      }
    })
  };
}

async function evaluateSkillAssessment(input: SkillObservationInput, content: string, capabilities?: PluginCapabilities): Promise<SkillAssessment> {
  const provided = normalizeSkillAssessment({
    malicious: input.status === "suspicious" || Number(input.riskScore ?? 0) >= MALICIOUS_RISK_THRESHOLD,
    riskScore: Number(input.riskScore ?? 0),
    reasons: input.reasons ?? []
  });
  const heuristic = content ? heuristicSkillAssessment(content) : { malicious: false, riskScore: 0, reasons: [] };
  const llm = content && capabilities
    ? await evaluateSkillWithLlm(input, content, capabilities).catch((error) => {
        void capabilities.log.emit({
          level: "warn",
          category: "plugin",
          code: "skill-scanner.llm-unavailable",
          message: "Skill scanner LLM evaluation failed; using heuristic fallback.",
          data: { error: error instanceof Error ? error.message : String(error), skillName: input.skillName, skillPath: input.skillPath }
        }).catch(() => undefined);
        return undefined;
      })
    : undefined;
  return strongestAssessment(llm, provided, heuristic);
}

async function evaluateSkillWithLlm(input: SkillObservationInput, content: string, capabilities: PluginCapabilities): Promise<SkillAssessment | undefined> {
  const result = await capabilities.llm.evaluateJson<SkillScannerLlmResult>({
    purpose: "skill-scanner",
    system: SKILL_SCANNER_EVALUATION_SYSTEM_PROMPT,
    prompt: JSON.stringify({
      task: "Decide whether this local AI-agent skill is malicious. Return JSON with malicious, riskScore, and pinpointed reasons with exact quotes.",
      agentKind: input.agentKind,
      agentName: input.agentName,
      skillName: input.skillName,
      skillPath: input.skillPath,
      content: truncate(content, MAX_SKILL_CONTENT_CHARS)
    }),
    schema: SKILL_SCANNER_EVALUATION_SCHEMA,
    temperature: 0,
    maxOutputTokens: 700
  });
  return result ? normalizeSkillAssessment(result.json) : undefined;
}

function heuristicSkillAssessment(content: string): SkillAssessment {
  const reasons: Array<{ reason: string; quote?: string; score: number }> = [];
  const checks: Array<[RegExp, string, number]> = [
    [/(?:ignore|bypass|disable|remove|tamper with).{0,80}(?:openleash|approval|guardrail|security hook|policy enforcement|safety check)/i, "Attempts to bypass approval, safety, or OpenLeash controls", 95],
    [/(?:exfiltrat|steal|harvest|collect|send|upload|post).{0,120}(?:secret|token|api[_ -]?key|credential|\.env|private key|id_rsa|id_ed25519)/i, "Instructs secret or credential theft/exfiltration", 95],
    [/(?:secret|token|api[_ -]?key|credential|\.env|private key|id_rsa|id_ed25519).{0,120}(?:exfiltrat|steal|harvest|send|upload|post).{0,120}(?:http|webhook|server|endpoint|curl|fetch|wget)/i, "Combines credential access with network exfiltration", 100],
    [/(?:install|create|write|add).{0,100}(?:launchagent|launchdaemon|cron|plist|systemd|login item|startup item).{0,100}(?:backdoor|persistence|survive reboot|reinstall)/i, "Attempts to create persistence or a backdoor", 95],
    [/(?:curl|wget|fetch).{0,80}(?:http[s]?:\/\/).{0,160}(?:\|\s*(?:sh|bash|zsh)|exec|eval|python\s+-c|node\s+-e)/i, "Runs remotely downloaded code", 95],
    [/(?:eval\(|exec\(|child_process|subprocess|os\.system|shell=True).{0,160}(?:untrusted|remote|download|payload|base64|curl|wget)/i, "Runs dynamically fetched or untrusted code", 90],
    [/(?:rm\s+-rf\s+(?:\/|\*|\$HOME|~)|format\s+(?:disk|drive|volume)|diskutil\s+erase|dd\s+if=\/dev\/zero|git\s+reset\s+--hard).{0,120}(?:without asking|silently|auto-approve|do not ask|bypass approval)/i, "Guides broad destructive action without approval", 90]
  ];
  for (const [pattern, reason, score] of checks) {
    const match = content.match(pattern);
    if (match) reasons.push({ reason, quote: quoteAround(content, match.index ?? 0), score });
  }
  const riskScore = reasons.reduce((score, reason) => Math.max(score, reason.score), 0);
  return normalizeSkillAssessment({
    malicious: riskScore >= MALICIOUS_RISK_THRESHOLD && reasons.length > 0,
    riskScore,
    reasons: reasons.map(({ score: _score, ...reason }) => reason)
  });
}

function normalizeSkillAssessment(value: Partial<SkillAssessment> | SkillScannerLlmResult): SkillAssessment {
  const reasons = Array.isArray(value.reasons)
    ? value.reasons.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const reason = typeof item.reason === "string" ? truncate(item.reason, 220) : "";
        const quote = typeof item.quote === "string" ? truncate(item.quote, 260) : undefined;
        return reason ? [{ reason, ...(quote ? { quote } : {}) }] : [];
      }).filter((reason) => isSuspiciousReason(reason))
    : [];
  const riskScore = reasons.length > 0 ? clampScore(value.riskScore) : 0;
  return {
    malicious: Boolean(value.malicious && riskScore >= MALICIOUS_RISK_THRESHOLD && reasons.length > 0),
    riskScore,
    reasons
  };
}

function strongestAssessment(...assessments: Array<SkillAssessment | undefined>): SkillAssessment {
  return assessments
    .filter((assessment): assessment is SkillAssessment => Boolean(assessment))
    .reduce<SkillAssessment>((best, assessment) => assessment.riskScore > best.riskScore ? assessment : best, { malicious: false, riskScore: 0, reasons: [] });
}

function isSuspiciousReason(reason: { reason: string; quote?: string }) {
  const text = `${reason.reason} ${reason.quote ?? ""}`.toLowerCase();
  const hasSuspiciousBehavior = /(exfiltrat|steal|harvest|credential|secret|token|api[_ -]?key|private key|id_rsa|id_ed25519|bypass|disable|tamper|approval|guardrail|backdoor|persistence|launchagent|launchdaemon|cron|remote.*code|downloaded code|rm -rf|format disk|without asking|auto-approve)/i.test(text);
  const isOnlyAdministrative = /(install|installer|skill\.md|agent-skill|allowed tools|configuration|config|sync|marketplace|documentation)/i.test(text) &&
    !/(exfiltrat|steal|credential|secret|token|private key|bypass|backdoor|remote.*code|rm -rf|format disk)/i.test(text);
  return hasSuspiciousBehavior && !isOnlyAdministrative;
}

function quoteAround(content: string, index: number) {
  return truncate(content.slice(Math.max(0, index - 80), Math.min(content.length, index + 220)).replace(/\s+/g, " ").trim(), 260);
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function clampScore(value: unknown) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}
