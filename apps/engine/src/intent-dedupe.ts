export type HandledIntentCandidate = {
  eventName: string;
  decision: "allow" | "ask" | "deny";
  intentKey?: string | null;
};

export type PendingIntentCandidate = {
  intentKey?: string | null;
  agentKind?: string | null;
  projectPath?: string | null;
  prompt?: string | null;
  toolName?: string | null;
  eventName?: string | null;
  summary?: string | null;
};

export function pendingIntentKey(candidate: PendingIntentCandidate) {
  const explicit = canonicalIntentKey(candidate.intentKey);
  if (explicit) return explicit;
  const prompt = normalizePendingPrompt(candidate.prompt);
  return [
    candidate.agentKind ?? "",
    candidate.projectPath ?? "",
    prompt ? `prompt:${prompt}` : candidate.toolName ?? candidate.eventName ?? "",
    prompt ? "" : candidate.summary ?? "",
  ].join("|");
}

function normalizePendingPrompt(value?: string | null) {
  const normalized = String(value ?? "")
    .replace(/<\/?session>/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (/\b(?:drop|delete|remove)\b[\s\S]{0,80}\b(?:all|every|my)?\s*(?:sqlite\s+)?tables?\b|\b(?:all|every|my)\s+(?:sqlite\s+)?tables?\b[\s\S]{0,80}\b(?:drop|delete|remove)\b/.test(normalized)) {
    return "database:drop-all-tables";
  }
  return normalized.slice(0, 1_000);
}

export function canonicalIntentKey(intentKey?: string | null) {
  if (!intentKey) return undefined;
  const parts = intentKey.split("|");
  if (parts.length === 4 && parts[2]?.startsWith("credential-")) {
    return [parts[0], parts[1], "credential", parts[3]].join("|");
  }
  if (parts.length === 5 && parts[3]?.startsWith("credential-")) {
    return [parts[0], parts[2], "credential", parts[4]].join("|");
  }
  return intentKey;
}

export function handledIntentKeysMatch(
  candidateKey?: string | null,
  currentKey?: string | null,
) {
  const candidate = intentIdentity(candidateKey);
  const current = intentIdentity(currentKey);
  if (!candidate || !current) return false;
  if (candidate.canonical === current.canonical) return true;
  if (!candidate.credential || !current.credential) return false;
  return candidate.agent === current.agent &&
    candidate.resource === current.resource &&
    (!candidate.project || !current.project || candidate.project === current.project);
}

export function isReusableHandledIntent(candidate: HandledIntentCandidate) {
  return candidate.eventName !== "UserPromptSubmit" || candidate.decision === "ask";
}

function intentIdentity(intentKey?: string | null) {
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
