import assert from "node:assert/strict";
import test from "node:test";
import {
  attentionEventForPending,
  attentionKindForTool,
  buildAttentionEvents,
} from "./attention-events.js";

test("classifies every actionable island interaction", () => {
  assert.equal(attentionKindForTool("Bash"), "approval");
  assert.equal(attentionKindForTool("AskUserQuestion"), "question");
  assert.equal(attentionKindForTool("ExitPlanMode"), "plan_review");
});

test("preserves structured questions and plans in canonical attention events", () => {
  const question = attentionEventForPending({
    id: "decision-question",
    tool_name: "AskUserQuestion",
    agent_name: "Claude Code",
    agent_kind: "claude-code",
    created_at: "2026-07-27T10:00:00.000Z",
    payload: {
      sessionId: "session-1",
      tool: {
        input: {
          questions: [
            {
              question: "Deploy where?",
              multiSelect: false,
              options: [{ label: "Staging" }, { label: "Production" }],
            },
          ],
        },
      },
    },
  });
  assert.equal(question.kind, "question");
  assert.equal(question.interaction?.type, "questions");
  assert.deepEqual(
    question.interaction?.type === "questions"
      ? question.interaction.originalInput
      : undefined,
    {
      questions: [
        {
          question: "Deploy where?",
          multiSelect: false,
          options: [{ label: "Staging" }, { label: "Production" }],
        },
      ],
    },
  );

  const plan = attentionEventForPending({
    id: "decision-plan",
    tool_name: "ExitPlanMode",
    created_at: "2026-07-27T10:00:00.000Z",
    payload: {
      sessionId: "session-2",
      tool: { input: { plan: "# Ship safely" } },
    },
  });
  assert.equal(plan.kind, "plan_review");
  assert.equal(plan.interaction?.type, "plan");
  assert.equal(
    plan.interaction?.type === "plan" ? plan.interaction.markdown : undefined,
    "# Ship safely",
  );
});

test("builds blocked, completed, and subagent-completed notifications", () => {
  const events = buildAttentionEvents({
    pending: [],
    blocked: [
      {
        id: "blocked-1",
        created_at: "2026-07-27T10:00:00.000Z",
        agent_name: "Codex",
      },
    ],
    activity: [
      {
        id: "done-1",
        event_name: "Stop",
        created_at: "2026-07-27T10:00:01.000Z",
      },
      {
        id: "subagent-1",
        event_name: "SubagentStop",
        created_at: "2026-07-27T10:00:02.000Z",
      },
    ],
  });
  assert.deepEqual(
    events.map((event) => event.kind),
    ["blocked", "completed", "subagent_completed"],
  );
});
