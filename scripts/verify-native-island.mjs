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

const displayMode = process.argv.includes("--notch") ? "notch" : process.argv.includes("--plain") ? "plain" : undefined;
const child = spawn(executable, [html], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, ...(displayMode ? { OPENLEASH_ISLAND_TEST_DISPLAY: displayMode } : {}) },
});
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
  assert.equal(compact.layout.backgroundColor, "rgb(0, 0, 0)");
  assert.equal(compact.frame.topInset, 0);
  if (compact.display.hasNotch) assert.ok(compact.frame.width >= 620 && compact.frame.width <= 625, `unexpected notched compact width ${compact.frame.width}`);
  else assert.ok(compact.frame.width >= 455 && compact.frame.width <= 465, `unexpected compact width ${compact.frame.width}`);
  assert.ok(compact.frame.height < (compact.display.hasNotch ? 210 : 175), `unexpected compact height ${compact.frame.height}`);
  assert.equal(compact.layout.contentClearsNotch, true);
  if (compact.display.hasNotch) {
    assert.ok(compact.display.safeTop > 0, "notched display did not report a safe top inset");
    assert.ok(compact.layout.contentTop >= compact.display.safeTop, `compact content overlaps notch: ${compact.layout.contentTop} < ${compact.display.safeTop}`);
  }

  send({ type: "show", payload: {
    kind: "install_success",
    agentName: "OpenLeash",
    title: "Installation complete",
    project: "ready",
  } });
  const installed = await inspectAfter(900);
  assert.equal(installed.visible, true);
  assert.equal(installed.layout.fireworksRendered, true, "installation popup did not render the fireworks SVG");

  send({ type: "show", payload: {
    kind: "activity",
    agentName: "OpenLeash",
    title: "3 agents working",
    project: "3 active sessions",
    sessions: [
      { id: "claude", agentKind: "claude-code", agentName: "Claude Code", project: "client-api", title: "Test Claude", latestAction: "Running tests", eventCount: 3 },
      { id: "codex", sessionId: "codex-session", agentKind: "codex", agentName: "OpenAI Codex", project: "desktop", title: "Test Codex", latestAction: "Editing files", eventCount: 5, contributions: [{ pluginId: "openleash.blast-radius", pluginName: "blast-radius", pluginIcon: "💥", kind: "annotation", label: "Destructive operation", tone: "danger" }, { pluginId: "openleash.prompt-compression", pluginName: "token-saver", pluginIcon: "✂️", kind: "annotation", label: "token-saver", value: "42% saved", tone: "success" }] },
      { id: "gemini", agentKind: "gemini", agentName: "Gemini CLI", project: "docs", title: "Test Gemini", latestAction: "Reading docs", eventCount: 2 },
    ],
    tokenSaver: { pluginId: "openleash.prompt-compression", pluginName: "token-saver", value: "42% saved", tone: "success" },
    contributions: [{ pluginId: "community.tests", pluginName: "test-progress", kind: "status", title: "Tests running", tone: "info", progress: { current: 3, total: 5 } }],
  } });
  const activity = await inspectAfter(650);
  assert.equal(activity.visible, true);
  assert.equal(activity.layout.sessionCount, 3, "activity island did not render every active session");
  assert.equal(activity.layout.activityDetailVisible, false, "multi-session activity opened a detail without selection");
  assert.equal(activity.layout.historyButtonVisible, true, "activity island did not offer optional history");
  assert.ok(activity.layout.contributionCount >= 2, "activity island did not render plugin contributions");
  assert.equal(activity.layout.notchAgentCount, 3, "notch rail did not render active agent icons");
  assert.equal(activity.layout.capAgentCount, 3, "plain-display compact pill did not render active agent icons");
  assert.match(activity.layout.notchTokenSaving, /42% saved/, "notch rail did not render token savings");
  assert.match(activity.layout.capTokenSaving, /42% saved/, "compact header did not retain token savings for displays without a notch");
  assert.equal(activity.layout.islandWidth, activity.layout.activityCompactWidth, "collapsed activity island did not use its measured content width");
  if (activity.display.hasNotch) {
    assert.equal(activity.layout.islandHeight, activity.display.safeTop, "notched compact activity grew below the hardware notch");
    assert.ok(activity.layout.islandWidth < 430, `notched compact activity retained the oversized fixed width: ${activity.layout.islandWidth}`);
    assert.ok(activity.layout.islandWidth >= activity.display.notchWidth, "notched compact activity is narrower than the hardware notch");
    assert.equal(activity.layout.islandBorderRadius, "0px 0px 18px 18px", "notched compact activity does not have rounded lower corners");
  } else {
    assert.ok(activity.layout.islandHeight >= 42 && activity.layout.islandHeight <= 55, `plain compact activity height is not one line: ${activity.layout.islandHeight}`);
    assert.ok(activity.layout.islandWidth >= 112 && activity.layout.islandWidth <= 360, `plain compact activity escaped its content-fit bounds: ${activity.layout.islandWidth}`);
    assert.notEqual(activity.layout.islandBorderRadius, "0px", "plain compact activity has square corners");
  }
  send({ type: "expandActivity" });
  const expandedActivity = await inspectAfter(450);
  assert.equal(expandedActivity.layout.expanded, true, "compact activity rail did not expand");
  assert.ok(expandedActivity.layout.islandHeight > activity.layout.islandHeight, "expanded activity did not reveal its details");
  assert.ok(expandedActivity.layout.islandWidth > activity.layout.islandWidth, "expanded activity did not grow wider than its compact content");
  send({ type: "openMenu" });
  const activityMenu = await inspectAfter(350);
  assert.equal(activityMenu.layout.menuOpen, true, "island controls menu did not open");
  assert.equal(activityMenu.layout.menuItemCount, 8, "island controls menu is missing tray actions");
  assert.equal(activityMenu.layout.menuFitsIsland, true, "island controls menu was clipped by the panel");
  send({ type: "openMenu" });
  send({ type: "expandActivity" });
  const collapsedActivity = await inspectAfter(450);
  assert.equal(collapsedActivity.layout.expanded, false, "expanded activity did not collapse again");
  assert.equal(collapsedActivity.layout.islandWidth, activity.layout.islandWidth, "collapsed activity did not return to its measured content width");

  send({ type: "show", payload: {
    kind: "activity",
    agentName: "OpenLeash",
    title: "Agent working",
    project: "1 active session",
    sessions: [
      { id: "claude-only", agentKind: "claude-code", agentName: "Claude Code", project: "client-api", title: "Test Claude", latestAction: "Running tests", eventCount: 3 },
    ],
  } });
  const singleAgentActivity = await inspectAfter(650);
  assert.equal(singleAgentActivity.layout.sessionCount, 1, "single-agent compact fixture did not render");
  assert.ok(singleAgentActivity.layout.islandWidth < activity.layout.islandWidth, `compact island did not shrink with less content: ${singleAgentActivity.layout.islandWidth} >= ${activity.layout.islandWidth}`);

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
  assert.equal(expanded.layout.backgroundColor, "rgb(0, 0, 0)");
  assert.equal(expanded.frame.topInset, 0);
  assert.ok(expanded.frame.width >= 730 && expanded.frame.width <= 740, `unexpected expanded width ${expanded.frame.width}`);
  assert.ok(expanded.frame.height > 300, `unexpected expanded height ${expanded.frame.height}`);
  assert.equal(expanded.layout.contentClearsNotch, true);
  if (expanded.display.hasNotch) {
    assert.ok(expanded.layout.contentTop >= expanded.display.safeTop, `expanded content overlaps notch: ${expanded.layout.contentTop} < ${expanded.display.safeTop}`);
  }

  send({ type: "dismiss" });
  const dismissed = await inspectAfter(300);
  assert.equal(dismissed.visible, false);
  console.log(`native macOS island top-anchor, notch-safe content, activity sessions, fireworks, compact, expansion, and dismissal ok (notch=${compact.display.hasNotch}, safeTop=${compact.display.safeTop})`);
} finally {
  send({ type: "quit" });
  child.stdin.end();
  await new Promise((resolve) => child.once("exit", resolve));
}
