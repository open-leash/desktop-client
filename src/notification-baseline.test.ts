import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const renderer = fs.readFileSync(path.join(process.cwd(), "src", "window.html"), "utf8");

test("existing history is not presented as a new notification after install", () => {
  assert.match(renderer, /leash-notification-baseline-at/);
  assert.match(renderer, /createdAt > notificationBaselineAt/);
});

test("notification baseline survives renderer restarts", () => {
  assert.match(renderer, /localStorage\.getItem\("leash-notification-baseline-at"\)/);
  assert.match(renderer, /localStorage\.setItem\("leash-notification-baseline-at", String\(notificationBaselineAt\)\)/);
});
