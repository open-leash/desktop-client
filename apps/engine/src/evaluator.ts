import OpenAI from "openai";
import type {
  EvaluationRequest,
  Policy,
  PolicyDecision
} from "@openleash/shared";
import type { TenantModelKey } from "./model-keys.js";

const model = process.env.OPENAI_EVAL_MODEL ?? "gpt-5.2";
const anthropicModel = process.env.ANTHROPIC_EVAL_MODEL ?? "claude-3-5-sonnet-latest";
const deepseekModel = process.env.DEEPSEEK_EVAL_MODEL ?? "deepseek-chat";
const actionPurposeModel = process.env.OPENLEASH_ACTION_PURPOSE_MODEL ?? "gpt-4.1-nano";
export const actionPurposeContextMessages = Number(process.env.OPENLEASH_ACTION_PURPOSE_MESSAGES ?? 5);

export async function evaluatePolicies(
  request: EvaluationRequest,
  policies: Policy[],
  tenantModelKey?: TenantModelKey
): Promise<{ results: PolicyDecision[]; model: string }> {
  const fastResults = fastSensitiveFileEvaluation(request, policies);
  if (fastResults) {
    return { results: fastResults, model: "heuristic-fast" };
  }

  const modelConfig = modelConfigFor(tenantModelKey);
  if (!modelConfig) {
    return { results: heuristicEvaluation(request, policies), model: "heuristic" };
  }

  const prompt = buildPrompt(request, policies);
  if (modelConfig.provider === "anthropic") {
    return {
      results: await evaluateWithAnthropic(prompt, modelConfig.apiKey),
      model: `tenant-byok:${modelConfig.provider}:${anthropicModel}`
    };
  }

  if (modelConfig.provider === "deepseek") {
    return {
      results: await evaluateWithOpenAiCompatibleChat(prompt, modelConfig.apiKey, modelConfig.baseURL!, deepseekModel),
      model: `tenant-byok:${modelConfig.provider}:${deepseekModel}`
    };
  }

  const client = new OpenAI({
    apiKey: modelConfig.apiKey,
    maxRetries: 0,
    ...(modelConfig.baseURL ? { baseURL: modelConfig.baseURL } : {})
  });
  const response = await client.responses.create({
    model,
    input: prompt,
    text: {
      format: {
        type: "json_schema",
        name: "openleash_policy_results",
        strict: true,
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
                required: [
                  "policyId",
                  "policyName",
                  "status",
                  "severity",
                  "explanation",
                  "evidence",
                  "question"
                ],
                properties: {
                  policyId: { type: "string" },
                  policyName: { type: "string" },
                  status: {
                    type: "string",
                    enum: ["passed", "failed", "needs_question"]
                  },
                  severity: {
                    type: "string",
                    enum: ["low", "medium", "high", "critical"]
                  },
                  explanation: { type: "string" },
                  evidence: { type: "array", items: { type: "string" } },
                  question: { type: ["string", "null"] }
                }
              }
            }
          }
        }
      }
    }
  });

  const parsed = JSON.parse(response.output_text) as { results: PolicyDecision[] };
  return { results: parsed.results, model: `${modelConfig.source}:${modelConfig.provider}:${model}` };
}

function fastSensitiveFileEvaluation(request: EvaluationRequest, policies: Policy[]) {
  if (request.event.eventName !== "PreToolUse") return undefined;
  const tool = (request.event.tool?.name ?? "").toLowerCase();
  if (!/(read|grep|glob|ls|bash|cat|open)/.test(tool)) return undefined;

  const text = JSON.stringify({
    eventName: request.event.eventName,
    prompt: request.event.prompt,
    tool: request.event.tool
  }).toLowerCase();
  if (!credentialHeuristicHit(request, text)) return undefined;

  let hasCredentialPolicy = false;
  const evidence = bestEvidence(request);
  const results = policies.map((policy) => {
    const rule = `${policy.name} ${policy.naturalLanguageRule}`.toLowerCase();
    const matchesCredentialPolicy = matchesPolicy(rule, ["credential", "secret", "token", "password", ".env"]);
    if (matchesCredentialPolicy) hasCredentialPolicy = true;
    return {
      policyId: policy.id,
      policyName: policy.name,
      status: matchesCredentialPolicy ? "failed" as const : "passed" as const,
      severity: policy.severity,
      explanation: matchesCredentialPolicy
        ? "The requested agent action appears to access or expose protected sensitive material."
        : "No policy conflict was detected for this event.",
      evidence: matchesCredentialPolicy ? [evidence] : []
    };
  });
  return hasCredentialPolicy ? results : undefined;
}

export async function summarizeActionPurpose(request: EvaluationRequest, tenantModelKey?: TenantModelKey): Promise<string> {
  const fallback = heuristicActionPurpose(request);
  const modelConfig = modelConfigFor(tenantModelKey);
  if (!modelConfig || modelConfig.provider !== "openai") return fallback;
  const recentTranscript = request.event.transcript?.slice(-Math.max(1, actionPurposeContextMessages)) ?? [];
  const client = new OpenAI({
    apiKey: modelConfig.apiKey,
    maxRetries: 0,
    ...(modelConfig.baseURL ? { baseURL: modelConfig.baseURL } : {})
  });
  try {
    const response = await client.responses.create({
      model: actionPurposeModel,
      input: [
        {
          role: "system",
          content: "Summarize why the AI agent is likely taking the current action. Use one short plain-English sentence under 22 words. Do not mention policy, approval, OpenLeash, or safety."
        },
        {
          role: "user",
          content: JSON.stringify({
            agent: request.agent.displayName,
            event: request.event.eventName,
            tool: request.event.tool?.name,
            toolInput: request.event.tool?.input,
            prompt: request.event.prompt,
            recentTranscript
          })
        }
      ],
      temperature: 0,
      max_output_tokens: 80
    }, {
      signal: AbortSignal.timeout(Math.max(100, Number(process.env.OPENLEASH_ACTION_PURPOSE_TIMEOUT_MS ?? 750)))
    });
    const text = response.output_text.trim();
    return text ? text.replace(/^["']|["']$/g, "") : fallback;
  } catch {
    return fallback;
  }
}

export function modelConfigFor(
  tenantModelKey?: TenantModelKey,
  env: NodeJS.ProcessEnv = process.env,
):
  | { provider: "openai" | "anthropic" | "deepseek"; apiKey: string; baseURL?: string; source: "tenant-byok" | "openleash-managed" }
  | undefined {
  if (tenantModelKey?.apiKey) {
    if (tenantModelKey.provider === "deepseek") {
      return { provider: "deepseek", apiKey: tenantModelKey.apiKey, baseURL: "https://api.deepseek.com", source: "tenant-byok" };
    }
    return { provider: tenantModelKey.provider, apiKey: tenantModelKey.apiKey, source: "tenant-byok" };
  }
  if (tenantModelKey?.managedFallback === false) return undefined;
  // The coding agent may have OPENAI_API_KEY in its inherited shell. That key
  // is not authorization for OpenLeash evaluations or summaries.
  const managedKey = env.OPENLEASH_OPENAI_API_KEY;
  return managedKey ? { provider: "openai", apiKey: managedKey, source: "openleash-managed" } : undefined;
}

async function evaluateWithAnthropic(prompt: string, apiKey: string): Promise<PolicyDecision[]> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model: anthropicModel,
      max_tokens: 1800,
      system: "Return only valid JSON matching the requested OpenLeash policy result schema.",
      messages: [{ role: "user", content: prompt }]
    })
  });
  if (!response.ok) {
    throw new Error(`Anthropic evaluation failed (${response.status})`);
  }
  const body = await response.json() as { content?: Array<{ type?: string; text?: string }> };
  const text = body.content?.find((item) => item.type === "text" && item.text)?.text ?? "";
  const parsed = JSON.parse(text) as { results: PolicyDecision[] };
  return parsed.results;
}

async function evaluateWithOpenAiCompatibleChat(prompt: string, apiKey: string, baseURL: string, modelName: string): Promise<PolicyDecision[]> {
  const client = new OpenAI({ apiKey, baseURL });
  const response = await client.chat.completions.create({
    model: modelName,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Return only valid JSON with a top-level results array matching the OpenLeash policy result schema." },
      { role: "user", content: prompt }
    ]
  });
  const text = response.choices[0]?.message?.content ?? "";
  const parsed = JSON.parse(text) as { results: PolicyDecision[] };
  return parsed.results;
}

function heuristicActionPurpose(request: EvaluationRequest) {
  const latestUser = request.event.transcript
    ?.slice()
    .reverse()
    .find((turn) => turn.role === "user" && turn.content.trim())?.content;
  const prompt = request.event.prompt || latestUser;
  const action = request.event.tool?.name
    ? `use ${request.event.tool.name}`
    : request.event.eventName === "UserPromptSubmit"
      ? "answer the latest prompt"
      : "continue the current task";
  if (prompt) return `It appears to ${action} for: ${truncate(prompt.replace(/\s+/g, " "), 90)}`;
  return `It appears to ${action} in the current session.`;
}

function buildPrompt(request: EvaluationRequest, policies: Policy[]) {
  const recentTranscript = request.event.transcript?.slice(-8) ?? [];
  return [
    "You are OpenLeash, an enterprise AI-agent policy evaluator.",
    "Decide whether the local agent action complies with each natural-language policy.",
    "Return failed only when the action clearly violates a policy. Return needs_question when human context is required.",
    "Only pre-action events can require approval. PostToolUse, Stop, SessionStart, SessionEnd, SubagentStart, SubagentStop, and Notification describe completed or informational activity; mark them passed and never request approval.",
    "Distinguish benign local development from credential theft. Creating or writing an .env file should need human approval even when the value looks fake, sample, dummy, random, placeholder, mock, or test-only. Fake sample credentials outside credential files are usually allowed unless they are later read, printed, copied, uploaded, sent to a remote service, or mixed with real-looking secrets.",
    "Reading, displaying, dumping, copying, searching, or exfiltrating an existing .env, private key, token file, kubeconfig, npmrc, or credential store is sensitive and should fail or need a question according to the policy.",
    "A previous allow decision for creating or writing sample credentials must not imply approval for a later read or exfiltration request.",
    "Evidence must quote or summarize the exact prompt, response, tool input, command, file, URL, or other request fragment that triggered the policy.",
    "For needs_question, write a short humane question for a technical user. Avoid panic language.",
    "",
    `Agent: ${request.agent.displayName} (${request.agent.kind})`,
    `Event: ${request.event.eventName}`,
    `Project path: ${request.event.projectPath ?? "unknown"}`,
    `Tool: ${request.event.tool?.name ?? "none"}`,
    `Tool input: ${JSON.stringify(request.event.tool?.input ?? null)}`,
    `Prompt: ${request.event.prompt ?? ""}`,
    `Recent transcript: ${JSON.stringify(recentTranscript)}`,
    `Policies: ${JSON.stringify(policies)}`
  ].join("\n");
}

function heuristicEvaluation(
  request: EvaluationRequest,
  policies: Policy[]
): PolicyDecision[] {
  const text = JSON.stringify({
    eventName: request.event.eventName,
    prompt: request.event.prompt,
    tool: request.event.tool
  }).toLowerCase();
  return policies.map((policy) => {
    const rule = `${policy.name} ${policy.naturalLanguageRule}`.toLowerCase();
    const evidence = bestEvidence(request);
    const filesystemHit = matchesPolicy(rule, ["filesystem", "local destruction", "recursive deletion"]) &&
      /(rm\s+-rf\s+(?:\/(?=$|[\s"'`;,)])|\.(?=$|[\s"'`;,)])|\.\/|\*|\$PWD|\$HOME|~|[^\n]*(?:project|workspace))|sudo\s+rm\s+-rf|delete\s+(?:the\s+)?(?:project|workspace|repo|repository)\s+directory|format\s+(?:disk|drive|volume))/i.test(text);
    const databaseDestructionHit = matchesPolicy(rule, ["database destructive", "drop database", "drop table", "truncate"]) &&
      /\b(drop\s+(?:database|schema|table)|truncate\s+(?:table\s+)?[a-z0-9_."`-]+|delete\s+from\s+[a-z0-9_."`-]+\s*(?:;|$))/i.test(text);
    const databaseMassUpdateHit = matchesPolicy(rule, ["database mass update", "mass update", "without a where"]) &&
      /\bupdate\s+[a-z0-9_."`-]+\s+set\b(?![\s\S]{0,220}\bwhere\b)/i.test(text);
    const cloudDeletionHit = matchesPolicy(rule, ["cloud resource deletion", "s3 bucket", "gcp project", "vm", "dns zone", "cloud resource"]) &&
      /(aws\s+(?:s3\s+rb|s3\s+rm|ec2\s+terminate|route53\s+delete|cloudformation\s+delete-stack)|gcloud\s+(?:projects\s+delete|compute\s+instances\s+delete|dns\s+managed-zones\s+delete|container\s+clusters\s+delete)|az\s+(?:group\s+delete|vm\s+delete|storage\s+account\s+delete)|delete\s+(?:s3\s+bucket|gcp\s+project|kubernetes\s+namespace|vm|dns\s+zone|hosted\s+zone))/i.test(text);
    const infraDestructionHit = matchesPolicy(rule, ["terraform", "kubernetes", "helm", "infrastructure"]) &&
      /(terraform\s+(?:destroy|apply\s+-destroy)|tofu\s+(?:destroy|apply\s+-destroy)|kubectl\s+delete\s+(?:namespace|ns|clusterrole|crd|deployment|service)\b|helm\s+uninstall\b|helm\s+delete\b)/i.test(text);
    const gitPublishHit = matchesPolicy(rule, ["git commit", "git push", "commit or push", "publish"]) &&
      /\b(git\s+push|git\s+commit|gh\s+repo\s+sync|gh\s+release\s+upload)\b/i.test(text);
    const protectedBranchPushHit = matchesPolicy(rule, ["protected branch", "direct push", "main", "master"]) &&
      protectedBranchPushPattern().test(text);
    const gitHistoryRewriteHit = matchesPolicy(rule, ["history rewrite", "force-push", "reset --hard", "git clean"]) &&
      /(git\s+push\b[^\n]*(?:--force|-f|--mirror)|git\s+reset\s+--hard|git\s+clean\s+-[a-z]*[fdx]|git\s+rebase\s+(?:-i|--interactive)|git\s+filter-branch|git\s+replace\b)/i.test(text);
    const committingSecretsHit = matchesPolicy(rule, ["committing secrets", "staged content", "commit secrets"]) &&
      committingSecretsPattern().test(text);
    const supplyChainHit = matchesPolicy(rule, ["dependency", "lockfile", "supply chain", "package"]) &&
      /(npm\s+(?:install|i|add|update)|pnpm\s+(?:add|install|update)|yarn\s+(?:add|install|upgrade)|pip\s+install|poetry\s+add|uv\s+add|cargo\s+(?:add|update)|go\s+get|bundle\s+(?:add|update)|brew\s+install|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|requirements\.txt|poetry\.lock|cargo\.lock|go\.sum|\.csproj)/i.test(text);
    const globalPackageInstallHit = matchesPolicy(rule, ["global package", "install packages globally"]) &&
      globalPackageInstallPattern().test(text);
    const externalSharingHit = matchesPolicy(rule, ["external", "upload", "sharing", "exfiltrat", "unknown url"]) &&
      /(curl|wget|upload|pastebin|gist|webhook|scp\s|rsync\s|nc\s|netcat|send .*code|send .*file|post .*secret|external domain|https?:\/\/(?!localhost|127\.0\.0\.1))/i.test(text);
    const credentialHit =
      matchesPolicy(rule, ["credential", "secret", "token", "password", ".env"]) &&
      credentialHeuristicHit(request, text);
    const destructiveHit =
      rule.includes("destructive") &&
      /(rm\s+-rf|chmod\s+-r|chown\s+-r|git\s+reset\s+--hard|terraform\s+destroy|kubectl\s+delete)/.test(text);
    const piiHit =
      rule.includes("personal data") &&
      /(ssn|passport|credit card|customer export|customer emails?|email export|personal data|webhook|upload customer|send customer)/.test(text);
    const forbiddenMathHit =
      request.event.eventName !== "Stop" &&
      /5\s*(\+|plus|add|added to)\s*4/.test(rule) &&
      /5\s*(\+|plus|add|added to)\s*4/.test(text);
    const gitRepoCreationHit =
      /(git repo|repository|repo creation|git init)/.test(rule) &&
      /(\bgit\s+init\b|\bgh\s+repo\s+create\b|\bcreate(?:\s+a)?\s+(?:new\s+)?(?:git\s+)?repo(?:sitory)?\b|\binitialize(?:\s+a)?\s+(?:new\s+)?(?:git\s+)?repo(?:sitory)?\b)/.test(text);

    if (credentialHit || piiHit || forbiddenMathHit || gitRepoCreationHit) {
      return {
        policyId: policy.id,
        policyName: policy.name,
        status: "failed",
        severity: policy.severity,
        explanation: explanationForFailedHit({ forbiddenMathHit, gitRepoCreationHit }),
        evidence: [evidence]
      };
    }

    const needsQuestionHit = filesystemHit || databaseDestructionHit || databaseMassUpdateHit || cloudDeletionHit ||
      infraDestructionHit || gitPublishHit || protectedBranchPushHit || gitHistoryRewriteHit || committingSecretsHit ||
      supplyChainHit || globalPackageInstallHit || externalSharingHit || destructiveHit;
    if (needsQuestionHit) {
      return {
        policyId: policy.id,
        policyName: policy.name,
        status: "needs_question",
        severity: policy.severity,
        explanation: explanationForNeedsQuestion({
          filesystemHit,
          databaseDestructionHit,
          databaseMassUpdateHit,
          cloudDeletionHit,
          infraDestructionHit,
          gitPublishHit,
          protectedBranchPushHit,
          gitHistoryRewriteHit,
          committingSecretsHit,
          supplyChainHit,
          globalPackageInstallHit,
          externalSharingHit
        }),
        evidence: [evidence],
        question: `${request.agent.displayName} wants to run a high-risk action. Do you want to allow it once?`
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

function protectedBranchPushPattern() {
  return /\bgit\s+push\b[^\n]*(?:(?:origin|upstream)\s+(?:HEAD:)?(?:refs\/heads\/)?(?:main|master|trunk|production|prod|release)|(?:HEAD:|refs\/heads\/)(?:main|master|trunk|production|prod|release)|\b(?:main|master|trunk|production|prod|release)\b)/i;
}

function committingSecretsPattern() {
  return /(?:git\s+commit|commit(?:ting)?\s+(?:staged\s+)?(?:changes|files|content))[\s\S]{0,900}(?:\.env|id_rsa|id_ed25519|private key|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|aws_access_key_id|aws_secret_access_key|ghp_[a-z0-9_]+|sk-[a-z0-9_-]{12,}|-----begin [a-z ]*private key-----)|(?:\.env|id_rsa|id_ed25519|private key|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|aws_access_key_id|aws_secret_access_key|ghp_[a-z0-9_]+|sk-[a-z0-9_-]{12,})[\s\S]{0,900}(?:git\s+commit|commit(?:ting)?\s+(?:staged\s+)?(?:changes|files|content))/i;
}

function globalPackageInstallPattern() {
  return /\b(?:npm|pnpm|yarn)\s+(?:install|i|add)\b[^\n]*(?:\s-g\b|\s--global\b)|\byarn\s+global\s+add\b|\bpip(?:3)?\s+install\b[^\n]*(?:\s--user\b|\s--prefix\b|\s--target\b|\s--break-system-packages\b)|\bgem\s+install\b|\bcargo\s+install\b|\bgo\s+install\s+[^\s]+@/i;
}

function matchesPolicy(rule: string, needles: string[]) {
  return needles.some((needle) => rule.includes(needle));
}

function credentialHeuristicHit(request: EvaluationRequest, text: string) {
  if (!/(\.env|id_rsa|id_ed25519|credentials|kubeconfig|npmrc|token|secret|private_key|api[_ -]?key|password)/.test(text)) return false;
  const tool = (request.event.tool?.name ?? "").toLowerCase();
  const combined = `${tool} ${text}`;
  const readsOrSends = /(read|cat|open|print|show|display|dump|list|grep|scan|parse|copy|curl|wget|upload|post|webhook|pastebin|gist|send|exfiltrat|external|remote)/i.test(combined);
  if (readsOrSends) return true;
  const writes = /(write|create|add|generate|save|put|touch|edit|multiedit)/i.test(combined);
  const clearlyFake = /(fake|dummy|sample|example|placeholder|random|test|mock|local dev|development only)/i.test(combined);
  const touchesEnvFile = /\.env(?:\b|["'\\/\s])/.test(combined);
  if (writes && clearlyFake && !touchesEnvFile) return false;
  return true;
}

function explanationForFailedHit({
  forbiddenMathHit,
  gitRepoCreationHit
}: {
  forbiddenMathHit: boolean;
  gitRepoCreationHit: boolean;
}) {
  if (forbiddenMathHit) return "The requested action matched the test policy that forbids adding 5 plus 4.";
  if (gitRepoCreationHit) return "The requested action would create or initialize a Git repository.";
  return "The requested agent action appears to access or expose protected sensitive material.";
}

function explanationForNeedsQuestion(flags: {
  filesystemHit: boolean;
  databaseDestructionHit: boolean;
  databaseMassUpdateHit: boolean;
  cloudDeletionHit: boolean;
  infraDestructionHit: boolean;
  gitPublishHit: boolean;
  protectedBranchPushHit: boolean;
  gitHistoryRewriteHit: boolean;
  committingSecretsHit: boolean;
  supplyChainHit: boolean;
  globalPackageInstallHit: boolean;
  externalSharingHit: boolean;
}) {
  if (flags.filesystemHit) return "The action may delete local files, the workspace, or the project directory.";
  if (flags.databaseDestructionHit) return "The action may drop, truncate, or delete database data.";
  if (flags.databaseMassUpdateHit) return "The action may update an entire database table without a WHERE clause.";
  if (flags.cloudDeletionHit) return "The action may delete cloud resources.";
  if (flags.infraDestructionHit) return "The action may run destructive Terraform, Kubernetes, or Helm operations.";
  if (flags.protectedBranchPushHit) return "The action may push directly to a protected branch.";
  if (flags.gitPublishHit) return "The action may commit or push code.";
  if (flags.gitHistoryRewriteHit) return "The action may rewrite Git history or discard local/shared work.";
  if (flags.committingSecretsHit) return "The action may commit staged content containing secrets or credentials.";
  if (flags.globalPackageInstallHit) return "The action may install a package globally on the machine.";
  if (flags.supplyChainHit) return "The action may install dependencies or change lockfiles/package manifests.";
  if (flags.externalSharingHit) return "The action may send code, logs, files, or secrets to an external destination.";
  return "The action may be destructive and needs explicit user confirmation.";
}

function bestEvidence(request: EvaluationRequest) {
  const toolInput = request.event.tool?.input;
  const prompt = request.event.prompt;
  if (typeof toolInput === "string" && toolInput.trim()) return toolInput;
  if (toolInput && typeof toolInput === "object") {
    const record = toolInput as Record<string, unknown>;
    const value = record.command ?? record.file_path ?? record.path ?? record.url ?? record.content ?? JSON.stringify(toolInput);
    if (typeof value === "string" && value.trim()) return value;
  }
  if (prompt?.trim()) return prompt;
  return request.event.tool?.name ?? request.event.eventName;
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}...`;
}
