#!/usr/bin/env node
import fs from "node:fs";

const required = [
  ["public product contract", "README.md", /Personal Open Source[\s\S]*BYOK/i],
  ["desktop personal choice", "apps/desktop/src/window.html", /Personal Open Source/],
  ["desktop Feature setup", "apps/desktop/src/window.html", /built-in Features/],
  ["mobile personal sign-in", "apps/mobile/lib/main.dart", /personal Leash Cloud account/],
];
const forbidden = [
  ["dashboard workspace", "package.json", /apps\/dashboard-(?:api|web)/],
  ["desktop dashboard launch", "apps/desktop/src/main.ts", /open-debug-dashboard/],
  ["mobile company sign-in", "apps/mobile/lib/main.dart", /company account|Sign in with company/],
];
const failures = [];
for (const [label, file, pattern] of required) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (!pattern.test(text)) failures.push(`${label}: missing ${pattern} in ${file}`);
}
for (const [label, file, pattern] of forbidden) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (pattern.test(text)) failures.push(`${label}: found ${pattern} in ${file}`);
}
if (failures.length) {
  console.error("Leash user-flow checks failed:\n" + failures.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}
console.log("Leash public user flows ok");
