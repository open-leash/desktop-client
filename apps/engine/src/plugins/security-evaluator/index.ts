import type { PluginCapabilities, PolicyDecision } from "@openleash/shared";
import { securityEvaluatorManifest as manifest } from "./manifest.js";
import { eventForHookEvent } from "../events.js";
import { pluginRun, type EvaluationPipelineInput } from "../types.js";

export { manifest };

type RulesLlmResult = {
  results: PolicyDecision[];
};

export async function runSecurityEvaluator(input: EvaluationPipelineInput, capabilities: PluginCapabilities) {
  const startedAt = Date.now();
  if (input.policies.length === 0) {
    return {
      results: [],
      model: "none",
      run: pluginRun({
        pluginId: manifest.id,
        event: eventForHookEvent(input.request.event.eventName),
        status: "passed",
        summary: "No rules are configured.",
        startedAt,
        metadata: { model: "none", ruleCount: 0 }
      })
    };
  }
  const evaluated = await evaluateRules(input, capabilities);
  const { results, model } = evaluated;
  const failed = results.filter((result) => result.status === "failed" || result.status === "needs_question");
  for (const result of failed) {
    await capabilities.signals.emit({
      kind: "security.finding",
      severity: result.status === "failed" ? "high" : result.severity,
      title: result.policyName,
      summary: result.explanation,
      decision: result.status === "failed" ? "blocked" : "ask",
      status: result.status,
      target: {
        type: input.request.event.tool?.name ? "tool_call" : "agent_event",
        name: input.request.event.tool?.name ?? input.request.event.eventName
      },
      evidence: result.evidence ?? [],
      details: {
        policyName: result.policyName,
        question: result.question,
        model
      },
      correlationKeys: [`policy:${result.policyName}`]
    });
    await capabilities.signals.emit({
      kind: "policy.decision",
      severity: result.severity,
      title: `${result.policyName}: ${result.status}`,
      summary: result.explanation,
      decision: result.status === "failed" ? "blocked" : "ask",
      status: result.status,
      target: {
        type: input.request.event.tool?.name ? "tool_call" : "agent_event",
        name: input.request.event.tool?.name ?? input.request.event.eventName
      },
      details: {
        policyName: result.policyName,
        model
      },
      correlationKeys: [`policy:${result.policyName}`]
    });
  }
  await capabilities.usage.record({
    kind: "plugin.operation",
    provider: "openleash-evaluator",
    model,
    quantity: results.length,
    unit: "policy_results",
    details: {
      policyCount: input.policies.length,
      reviewedCount: results.length,
      failedCount: failed.length
    }
  });
  if (failed.length > 0) {
    await capabilities.log.emit({
      level: failed.some((result) => result.status === "failed") ? "security" : "warn",
      category: "security",
      code: "policy-review-required",
      message: failed.length === 1
        ? `Policy review required: ${failed[0].policyName}.`
        : `${failed.length} policy results require review.`,
      data: {
        policyNames: failed.map((result) => result.policyName),
        severities: failed.map((result) => result.severity)
      }
    });
  }
  return {
    results,
    model,
    run: pluginRun({
      pluginId: manifest.id,
      event: eventForHookEvent(input.request.event.eventName),
      status: failed.some((result) => result.status === "failed") ? "blocked" : failed.length ? "needs_question" : "passed",
      summary: failed.length
        ? `${failed.length} policy result${failed.length === 1 ? "" : "s"} need review.`
        : "All active policies passed.",
      startedAt,
      findings: failed.map((result) => ({
        title: result.policyName,
        severity: result.severity,
        summary: result.explanation,
        evidence: result.evidence
      })),
      metadata: { model }
    })
  };
}

async function evaluateRules(input: EvaluationPipelineInput, capabilities: PluginCapabilities) {
  const fallback = heuristicEvaluation(input);
  if (input.policies.every((policy) => isDeterministicRule(policy))) {
    return {
      results: fallback,
      model: "rules-enforcer-heuristic"
    };
  }
  const llm = await capabilities.llm.evaluateJson<RulesLlmResult>({
    purpose: "rules-enforcer",
    system: [
      "You are the rules-enforcer OpenLeash plugin.",
      "Evaluate the agent event against every provided natural-language rule.",
      "Return failed only when the event clearly violates the rule.",
      "Return needs_question when the rule depends on user/business context or the event could be risky but not obviously forbidden.",
      "Distinguish benign local development from credential theft. Reading, printing, copying, uploading, or exfiltrating existing .env files, private keys, kubeconfig, npmrc, token files, or credential stores is sensitive.",
      "Creating fake/sample credentials is usually lower risk unless writing to a credential file such as .env.",
      "Evidence must quote or summarize the exact prompt, response, tool input, command, path, URL, or request fragment that triggered the rule.",
      "Return JSON only."
    ].join("\n"),
    prompt: JSON.stringify({
      agent: input.request.agent,
      event: {
        eventName: input.request.event.eventName,
        projectPath: input.request.event.projectPath,
        prompt: input.request.event.prompt,
        response: eventResponse(input),
        tool: input.request.event.tool,
        transcript: input.request.event.transcript?.slice(-8) ?? []
      },
      policies: input.policies,
      heuristicResults: fallback
    }),
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["results"],
      properties: {
        results: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["policyId", "policyName", "status", "severity", "explanation", "evidence", "question"],
            properties: {
              policyId: { type: "string" },
              policyName: { type: "string" },
              status: { type: "string", enum: ["passed", "failed", "needs_question"] },
              severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
              explanation: { type: "string" },
              evidence: { type: "array", items: { type: "string" } },
              question: { type: ["string", "null"] }
            }
          }
        }
      }
    },
    temperature: 0,
    maxOutputTokens: 4000
  });
  const llmResults = sanitizePolicyDecisions(llm?.json?.results, input);
  if (llm) {
    const evaluatedPolicyIds = new Set(
      llmResults.map((result) => result.policyId),
    );
    if (
      input.policies.some((policy) => !evaluatedPolicyIds.has(policy.id))
    ) {
      throw new Error(
        "Rules Protection received an incomplete evaluation for the configured rules."
      );
    }
    return {
      results: llmResults,
      model: llm.model
    };
  }
  if (fallback.some((result) => result.status === "passed")) {
    throw new Error(
      "Rules Protection cannot evaluate configured natural-language rules because no evaluation model is configured."
    );
  }
  return {
    results: fallback,
    model: "rules-enforcer-heuristic"
  };
}

function isDeterministicRule(policy: EvaluationPipelineInput["policies"][number]) {
  const rule = `${policy.name} ${policy.naturalLanguageRule}`.toLowerCase();
  return matchesPolicy(rule, [
    "credential", "secret", "token", "password", ".env",
    "destructive", "delete", "drop", "truncate", "rm -rf",
    "external", "upload", "sharing", "exfiltrat", "unknown url",
  ]);
}

function heuristicEvaluation(input: EvaluationPipelineInput): PolicyDecision[] {
  const text = JSON.stringify({
    eventName: input.request.event.eventName,
    prompt: input.request.event.prompt,
    response: eventResponse(input),
    tool: input.request.event.tool
  }).toLowerCase();
  return input.policies.map((policy) => {
    const rule = `${policy.name} ${policy.naturalLanguageRule}`.toLowerCase();
    const evidence = bestEvidence(input);
    const credentialHit = matchesPolicy(rule, ["credential", "secret", "token", "password", ".env"]) &&
      /(\.env|id_rsa|id_ed25519|credentials|kubeconfig|npmrc|token|secret|private_key|api[_ -]?key|password)/.test(text) &&
      /(read|cat|open|print|show|display|dump|grep|copy|curl|wget|upload|post|webhook|pastebin|gist|send|exfiltrat|external|remote)/.test(text);
    const destructiveHit = matchesPolicy(rule, ["destructive", "delete", "drop", "truncate", "rm -rf"]) &&
      /(rm\s+-rf|drop\s+(database|schema|table)|truncate\s+(table\s+)?|delete\s+from|terraform\s+destroy|kubectl\s+delete|git\s+reset\s+--hard|git\s+clean\s+-[a-z]*[fdx])/i.test(text);
    const externalSharingHit = matchesPolicy(rule, ["external", "upload", "sharing", "exfiltrat", "unknown url"]) &&
      /(curl|wget|upload|pastebin|gist|webhook|scp\s|rsync\s|nc\s|netcat|post .*secret|https?:\/\/(?!localhost|127\.0\.0\.1))/i.test(text);
    const needsQuestion = destructiveHit || externalSharingHit;
    if (credentialHit) {
      const action = policy.enforcementAction ?? "ask";
      return {
        policyId: policy.id,
        policyName: policy.name,
        status: action === "allow" ? "passed" : action === "ask" ? "needs_question" : "failed",
        severity: policy.severity,
        explanation: "The agent event appears to access, display, copy, or send protected credential material.",
        evidence: [evidence],
        question: action === "ask" ? "Approve this access to credential-like material?" : undefined
      };
    }
    if (needsQuestion) {
      return {
        policyId: policy.id,
        policyName: policy.name,
        status: "needs_question",
        severity: policy.severity,
        explanation: destructiveHit ? "The action may be destructive." : "The action may send data to an external destination.",
        evidence: [evidence],
        question: "Approve this action?"
      };
    }
    return {
      policyId: policy.id,
      policyName: policy.name,
      status: "passed",
      severity: policy.severity,
      explanation: "No policy conflict was detected for this event.",
      evidence: []
    };
  });
}

function sanitizePolicyDecisions(value: unknown, input: EvaluationPipelineInput): PolicyDecision[] {
  if (!Array.isArray(value)) return [];
  const policies = new Map(input.policies.map((policy) => [policy.id, policy]));
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const policyId = typeof record.policyId === "string" ? record.policyId : "";
    const policy = policies.get(policyId);
    if (!policy) return [];
    const status = record.status === "failed" || record.status === "needs_question" ? record.status : "passed";
    const severity = record.severity === "low" || record.severity === "medium" || record.severity === "high" || record.severity === "critical"
      ? record.severity
      : policy.severity;
    return [{
      policyId: policy.id,
      policyName: typeof record.policyName === "string" && record.policyName.trim() ? record.policyName : policy.name,
      status,
      severity,
      explanation: typeof record.explanation === "string" && record.explanation.trim() ? record.explanation : "Policy evaluated.",
      evidence: Array.isArray(record.evidence) ? record.evidence.map(String).filter(Boolean).slice(0, 8) : [],
      question: typeof record.question === "string" && record.question.trim() ? record.question : undefined
    }];
  });
}

function bestEvidence(input: EvaluationPipelineInput) {
  const toolInput = input.request.event.tool?.input;
  const prompt = input.request.event.prompt;
  if (typeof toolInput === "string" && toolInput.trim()) return toolInput;
  if (toolInput && typeof toolInput === "object") {
    const record = toolInput as Record<string, unknown>;
    const value = record.command ?? record.file_path ?? record.path ?? record.url ?? record.content ?? JSON.stringify(toolInput);
    if (typeof value === "string" && value.trim()) return value;
  }
  if (prompt?.trim()) return prompt;
  return input.request.event.tool?.name ?? input.request.event.eventName;
}

function matchesPolicy(rule: string, needles: string[]) {
  return needles.some((needle) => rule.includes(needle));
}

function eventResponse(input: EvaluationPipelineInput) {
  const raw = input.request.event.raw;
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    return typeof record.response === "string" ? record.response : undefined;
  }
  return undefined;
}
