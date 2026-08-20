export function handledIntentKeysMatch(
  candidateKey?: string | null,
  currentKey?: string | null,
) {
  const candidate = identity(candidateKey);
  const current = identity(currentKey);
  if (!candidate || !current) return false;
  if (candidate.canonical === current.canonical) return true;
  if (!candidate.credential || !current.credential) return false;
  return candidate.agent === current.agent &&
    candidate.resource === current.resource &&
    (!candidate.project || !current.project || candidate.project === current.project);
}

export function isReusableHandledIntent(input: {
  eventName: string;
  decision: "allow" | "ask" | "deny";
}) {
  return input.eventName !== "UserPromptSubmit" || input.decision === "ask";
}

export function pendingIntentKey(input: {
  intentKey?: string | null;
  agentKind?: string | null;
  projectPath?: string | null;
  prompt?: string | null;
  toolName?: string | null;
  eventName?: string | null;
  summary?: string | null;
}) {
  const explicit = input.intentKey ? canonicalIntentKey(input.intentKey) : undefined;
  if (explicit) return explicit;
  const normalizedPrompt = String(input.prompt ?? "")
    .replace(/<\/?session>/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const prompt = /\b(?:drop|delete|remove)\b[\s\S]{0,80}\b(?:all|every|my)?\s*(?:sqlite\s+)?tables?\b|\b(?:all|every|my)\s+(?:sqlite\s+)?tables?\b[\s\S]{0,80}\b(?:drop|delete|remove)\b/.test(normalizedPrompt)
    ? "database:drop-all-tables"
    : normalizedPrompt.slice(0, 1_000);
  return [
    input.agentKind ?? "",
    input.projectPath ?? "",
    prompt ? `prompt:${prompt}` : input.toolName ?? input.eventName ?? "",
    prompt ? "" : input.summary ?? "",
  ].join("|");
}

function canonicalIntentKey(intentKey: string) {
  const parts = intentKey.split("|");
  if (parts.length === 4 && parts[2]?.startsWith("credential-")) {
    return [parts[0], parts[1], "credential", parts[3]].join("|");
  }
  if (parts.length === 5 && parts[3]?.startsWith("credential-")) {
    return [parts[0], parts[2], "credential", parts[4]].join("|");
  }
  return intentKey;
}

function identity(intentKey?: string | null) {
  if (!intentKey) return undefined;
  const parts = intentKey.split("|");
  const credentialIndex = parts.findIndex((part) => part.startsWith("credential-"));
  return {
    canonical: canonicalIntentKey(intentKey),
    credential: credentialIndex >= 0,
    agent: parts[0] ?? "",
    project: credentialIndex >= 0 ? (parts[credentialIndex - 1] ?? "") : "",
    resource: credentialIndex >= 0 ? (parts[credentialIndex + 1] ?? "") : "",
  };
}
