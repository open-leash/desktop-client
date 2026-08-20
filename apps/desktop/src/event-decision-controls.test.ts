import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const windowSource = fs.readFileSync(path.join(__dirname, "window.html"), "utf8");

test("pending history details expose working deny and approve controls", () => {
  assert.match(windowSource, /const waitingForDecision = \["ask", "waiting", "pending", "review", "needs_review"\]/);
  assert.match(windowSource, /id="denyEvent">Deny<\/button>/);
  assert.match(windowSource, /id="approveEvent">Approve<\/button>/);
  assert.match(windowSource, /skillPath \? \{ skillPath \} : undefined/);
  assert.match(windowSource, /window\.openleash\.resolve\?\.\([\s\S]*item\.id,[\s\S]*resolution/);
  assert.match(windowSource, /item\.resolution = resolution/);
  assert.match(windowSource, /selectedEventId = ""/);
  assert.match(windowSource, /loadHistoryPage\(1, view === "agent-history"/);
  assert.match(windowSource, /typeof payload\.skillPath === "string"/);
});
