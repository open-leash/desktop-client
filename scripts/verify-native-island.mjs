#!/usr/bin/env node
import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline";
import { spawn } from "node:child_process";

if (process.platform !== "darwin") {
  console.log("native macOS island verification skipped on this platform");
  process.exit(0);
}

const valueAfter = (flag) => {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const executable = path.resolve(valueAfter("--executable") ?? "dist/openleash-island");
const html = path.resolve(valueAfter("--html") ?? "dist/notice.html");
await Promise.all([access(executable), access(html)]);

const child = spawn(executable, [html], { stdio: ["pipe", "pipe", "pipe"] });
const lines = readline.createInterface({ input: child.stdout });
const messages = [];
const waiters = [];
lines.on("line", (line) => {
  const message = JSON.parse(line);
  const waiterIndex = waiters.findIndex((waiter) => waiter.type === message.type);
  if (waiterIndex >= 0) waiters.splice(waiterIndex, 1)[0].resolve(message);
  else messages.push(message);
});

function waitFor(type, timeoutMs = 5000) {
  const existingIndex = messages.findIndex((message) => message.type === type);
  if (existingIndex >= 0) return Promise.resolve(messages.splice(existingIndex, 1)[0]);
  return new Promise((resolve, reject) => {
    const waiter = { type, resolve };
    waiters.push(waiter);
    const timer = setTimeout(() => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      reject(new Error(`Timed out waiting for native island ${type}`));
    }, timeoutMs);
    waiter.resolve = (message) => { clearTimeout(timer); resolve(message); };
  });
}

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

async function inspectAfter(delayMs) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  send({ type: "inspect" });
  return waitFor("state");
}

try {
  await waitFor("ready");
  send({ type: "show", payload: {
    kind: "completed",
    agentName: "Claude Code",
    title: "Claude finished",
    summary: "All tests pass.",
    project: "openleash",
    time: "now",
  } });
  const compact = await inspectAfter(450);
  assert.equal(compact.visible, true);
  assert.equal(compact.frame.topInset, 0);
  assert.ok(compact.frame.width >= 285 && compact.frame.width <= 320, `unexpected compact width ${compact.frame.width}`);
  assert.ok(compact.frame.height < 90, `unexpected compact height ${compact.frame.height}`);

  send({ type: "show", payload: {
    kind: "ask",
    id: "verification",
    agentName: "Claude Code",
    title: "Permission request",
    summary: "Claude wants to edit authentication middleware.",
    purpose: "Update token verification.",
    evidence: "Edit src/auth/middleware.ts",
    project: "openleash",
    supportsGuidance: true,
    interaction: { type: "approval" },
  } });
  const expanded = await inspectAfter(700);
  assert.equal(expanded.visible, true);
  assert.equal(expanded.frame.topInset, 0);
  assert.ok(expanded.frame.width >= 560 && expanded.frame.width <= 570, `unexpected expanded width ${expanded.frame.width}`);
  assert.ok(expanded.frame.height > 300, `unexpected expanded height ${expanded.frame.height}`);

  send({ type: "dismiss" });
  const dismissed = await inspectAfter(300);
  assert.equal(dismissed.visible, false);
  console.log("native macOS island top-anchor, compact, expansion, and dismissal ok");
} finally {
  send({ type: "quit" });
  child.stdin.end();
  await new Promise((resolve) => child.once("exit", resolve));
}
