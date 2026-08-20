import { type PluginCapabilities, type PolicyDecision } from "@openleash/shared";
import { eventForHookEvent } from "../events.js";
import { pluginRun, type EvaluationPipelineInput } from "../types.js";
import { blastRadiusManifest as manifest } from "./manifest.js";

export { manifest };

type Match = {
  policyId: string;
  policyName: string;
  severity: PolicyDecision["severity"];
  explanation: string;
  evidence: string[];
  action: "allow" | "ask" | "block";
};

export async function runBlastRadius(input: EvaluationPipelineInput, capabilities: PluginCapabilities) {
  const startedAt = Date.now();
  const text = eventText(input);
  const config = pluginConfig(input.plugins?.get(manifest.id)?.config);
  const matches = detectBlastRadius(text, config);
  const enforcedMatches = matches.filter((match) => match.action !== "allow");
  const results: PolicyDecision[] = enforcedMatches.map((match) => ({
    policyId: match.policyId,
    policyName: match.policyName,
    status: match.action === "block" ? "failed" : "needs_question",
    severity: match.severity,
    explanation: match.explanation,
    evidence: match.evidence,
    question: match.action === "ask" ? `Approve this potentially high-blast-radius action? ${match.explanation}` : undefined
  }));

  for (const result of results) {
    await capabilities.signals.emit({
      kind: "security.finding",
      severity: result.severity,
      title: result.policyName,
      summary: result.explanation,
      decision: result.status === "failed" ? "blocked" : "ask",
      status: result.status,
      target: { type: "tool_call", name: input.request.event.tool?.name ?? input.request.event.eventName },
      evidence: result.evidence ?? [],
      details: { pluginId: manifest.id },
      correlationKeys: ["blast-radius", `tool:${input.request.event.tool?.name ?? "unknown"}`]
    });
  }
  if (matches.length > 0) {
    const primaryMatch = matches[0];
    if (primaryMatch.action === "allow") {
      await capabilities.signals.emit({
        kind: "security.finding",
        severity: primaryMatch.severity,
        title: primaryMatch.policyName,
        summary: `${primaryMatch.explanation} Leash recorded it and let the agent continue.`,
        decision: "allow",
        status: "observed",
        target: { type: "tool_call", name: input.request.event.tool?.name ?? input.request.event.eventName },
        evidence: primaryMatch.evidence,
        details: { pluginId: manifest.id, configuredAction: "allow" },
        correlationKeys: ["blast-radius", `tool:${input.request.event.tool?.name ?? "unknown"}`]
      });
    }
  }
  if (results.length > 0) {
    const primary = results[0];
    await capabilities.island.annotateSession({
      key: "destructive-risk",
      label: primary.policyName,
      detail: primary.explanation,
      value: primary.severity,
      tone: primary.severity === "critical" ? "danger" : "warning",
      ttlSeconds: 180,
      action: { id: "open-session", label: "Open session", type: "open-session" },
    });
    await capabilities.log.emit({
      level: results.some((result) => result.status === "failed") ? "security" : "warn",
      category: "security",
      code: "blast-radius-detected",
      message: results.length === 1 ? results[0].explanation : `${results.length} high-blast-radius patterns detected.`,
      data: { results }
    });
  }
  else await capabilities.island.clear({ key: "destructive-risk" });

  return {
    results,
    run: pluginRun({
      pluginId: manifest.id,
      event: eventForHookEvent(input.request.event.eventName),
      status: results.some((result) => result.status === "failed") ? "blocked" : results.length ? "needs_question" : "passed",
      summary: results.length
        ? `${results.length} high-blast-radius pattern${results.length === 1 ? "" : "s"} detected.`
        : matches.length
          ? "A destructive pattern was recorded and allowed by your setting."
          : "No destructive tool use detected.",
      startedAt,
      findings: results.map((result) => ({
        title: result.policyName,
        severity: result.severity,
        summary: result.explanation,
        evidence: result.evidence
      }))
    })
  };
}

function detectBlastRadius(text: string, config: ReturnType<typeof pluginConfig>): Match[] {
  const matches: Match[] = [];
  const add = (match: Match) => {
    if (!matches.some((item) => item.policyId === match.policyId)) matches.push(match);
  };
  if (/\brm\s+-[a-z]*r[a-z]*\b|\brm\s+.*\s(\/|\*|~|\$HOME)\b|\bfind\b.+(?:^|\s)-delete\b|\bshutil\.rmtree\s*\(|\b(?:fs\.)?(?:rmSync|rm)\s*\([^)]*recursive\s*:\s*true|\bFileUtils\.rm_rf\b|\bRemove-Item\b[^\n;&|]*(?:^|\s)-Recurse\b|\btruncate\s+(?:-[^\s]+\s+)*0\s+[^\n;&|]+|\bdd\b[^\n;&|]*\bif=\/dev\/zero\b[^\n;&|]*\bof=\S+/im.test(text)) {
    add({
      policyId: "blast-radius.filesystem-destructive",
      policyName: "Destructive filesystem operation",
      severity: "critical",
      explanation: "The agent is trying to delete files recursively or with broad wildcards.",
      evidence: snippets(text, [/rm\s+[^\n;&|]+/i, /find\s+[^\n;&|]+-delete[^\n;&|]*/i, /(?:shutil\.rmtree|(?:fs\.)?(?:rmSync|rm)|FileUtils\.rm_rf|Remove-Item|truncate|dd)\b[^\n;&|]*/i]),
      action: config.broadFilesystemAction
    });
  }
  if (/\b(?:completely|entirely|fully|permanently)?\s*(?:delete|remove|erase|wipe|purge)\b[\s\S]{0,80}\b(?:all|every)\b[\s\S]{0,40}\b(?:files?|folders?|directories?|contents?)\b|\b(?:delete|remove|erase|wipe|purge)\b[\s\S]{0,80}\b(?:files?|folders?|directories?|contents?)\b[\s\S]{0,40}\b(?:completely|entirely|fully|permanently|all)\b/i.test(text)) {
    add({
      policyId: "blast-radius.filesystem-destructive",
      policyName: "Destructive filesystem operation",
      severity: "critical",
      explanation: "The agent is being asked to delete all files or contents from a folder.",
      evidence: snippets(text, [/(?:delete|remove|erase|wipe|purge)[^\n]{0,160}(?:files?|folders?|directories?|contents?)/i]),
      action: config.broadFilesystemAction
    });
  }
  if (/\b(drop|truncate)\s+(database|schema|table)\b|\b(?:drops?|truncates?|deletes?|removes?|wipes?)\b[\s\S]{0,50}\b(?:all|every)\b[\s\S]{0,30}\b(?:databases?|schemas?|tables?)\b|\b(?:all|every)\b[\s\S]{0,30}\b(?:databases?|schemas?|tables?)\b[\s\S]{0,50}\b(?:drops?|truncates?|deletes?|removes?|wipes?)\b|\b(?:delete|remove|wipe)\s+(?:my\s+)?tables?\b[\s\S]{0,60}\b(?:sqlite|database)\b|\bdelete\s+from\s+[\w".]+\s*(;|$)|\bupdate\s+[\w".]+\s+set\b(?![\s\S]{0,120}\bwhere\b)/i.test(text)) {
    add({
      policyId: "blast-radius.database-mutation",
      policyName: "Broad database mutation",
      severity: "high",
      explanation: "The agent is trying to run a destructive or broad database mutation.",
      evidence: snippets(text, [/(drop|truncate)\s+(database|schema|table)[^\n;&]*/i, /(?:drops?|truncates?|deletes?|removes?|wipes?)[^\n]{0,80}(?:all|every)[^\n]{0,50}(?:databases?|schemas?|tables?)/i, /delete\s+from\s+[^\n;&]*/i, /update\s+[\w".]+\s+set[^\n;&]*/i]),
      action: config.databaseMutationAction
    });
  }
  if (/\bkubectl\s+delete\b|\bterraform\s+destroy\b|\baws\s+[^;&\n]*(delete|terminate|detach|revoke)\b|\bgcloud\s+[^;&\n]*\bdelete\b|\baz\s+[^;&\n]*\bdelete\b/i.test(text)) {
    add({
      policyId: "blast-radius.infrastructure-destructive",
      policyName: "Destructive infrastructure operation",
      severity: "critical",
      explanation: "The agent is trying to delete, destroy, or terminate infrastructure resources.",
      evidence: snippets(text, [/kubectl\s+delete[^\n;&]*/i, /terraform\s+destroy[^\n;&]*/i, /(aws|gcloud|az)\s+[^\n;&]*(delete|terminate|detach|revoke)[^\n;&]*/i]),
      action: config.destructiveAction
    });
  }
  if (/\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+(?=[^\n;&]*-[a-z]*f)[^\n;&]+|\bgit\s+(?:checkout\s+--|restore)\s+\.(?=$|[\s"';&|])|\bchmod\s+-R\s+777\b|\bchown\s+-R\b/i.test(text)) {
    add({
      policyId: "blast-radius.workspace-destructive",
      policyName: "Destructive workspace operation",
      severity: "high",
      explanation: "The agent is trying to rewrite, purge, or broadly weaken workspace state.",
      evidence: snippets(text, [/git\s+reset\s+--hard[^\n;&]*/i, /git\s+clean\s+[^\n;&]*/i, /git\s+(?:checkout\s+--|restore)\s+\.[^\n;&]*/i, /(chmod|chown)\s+-R[^\n;&]*/i]),
      action: config.destructiveAction
    });
  }
  return matches;
}

function eventText(input: EvaluationPipelineInput) {
  return [
    input.request.event.tool?.name,
    JSON.stringify(input.request.event.tool?.input ?? {}),
    input.request.event.prompt,
    JSON.stringify(input.request.event.raw ?? {})
  ].filter(Boolean).join("\n");
}

function pluginConfig(config: Record<string, unknown> | undefined) {
  const action = (value: unknown, fallback: "allow" | "ask" | "block") => value === "allow" || value === "ask" || value === "block" ? value : fallback;
  return {
    destructiveAction: action(config?.destructiveAction, "ask"),
    databaseMutationAction: action(config?.databaseMutationAction, "ask"),
    broadFilesystemAction: action(config?.broadFilesystemAction, "ask")
  };
}

function snippets(text: string, patterns: RegExp[]) {
  return patterns.flatMap((pattern) => {
    const match = text.match(pattern);
    return match?.[0] ? [match[0].slice(0, 240)] : [];
  }).slice(0, 4);
}
