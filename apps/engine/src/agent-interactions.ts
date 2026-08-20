import type { EvaluationRequest } from "@openleash/shared";

export type AgentInteraction = {
  kind: "question" | "plan";
  summary: string;
  question: string;
  purpose: string;
};

export function agentInteractionForRequest(
  request: EvaluationRequest,
): AgentInteraction | undefined {
  if (request.event.eventName !== "PreToolUse") return undefined;
  const toolName = String(request.event.tool?.name ?? "").toLowerCase();
  const input = request.event.tool?.input;
  if (toolName === "askuserquestion") {
    const questions = agentQuestionItems(input);
    return {
      kind: "question",
      summary:
        questions[0]?.question ??
        `${request.agent.displayName} has a question for you.`,
      question: "Answer in OpenLeash to continue the agent.",
      purpose: `${request.agent.displayName} is waiting for your input.`,
    };
  }
  if (toolName === "exitplanmode") {
    return {
      kind: "plan",
      summary: `${request.agent.displayName} finished a plan and is waiting for review.`,
      question: "Approve the plan, or deny it with feedback.",
      purpose: "Review the proposed plan before the agent starts making changes.",
    };
  }
  return undefined;
}

function agentQuestionItems(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  const questions = (input as { questions?: unknown }).questions;
  if (!Array.isArray(questions)) return [];
  return questions
    .filter(
      (item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object" && !Array.isArray(item)),
    )
    .map((item) => ({
      question:
        typeof item.question === "string" ? item.question.trim() : "",
    }))
    .filter((item) => item.question);
}
