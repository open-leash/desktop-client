#!/usr/bin/env node
import fs from "node:fs";

const required = [
  ["canonical product", "docs/Product.md", /Personal Open Source[\s\S]*Leash Cloud/],
  ["canonical flows", "docs/USER_FLOWS.md", /personal[\s\S]*Features/i],
  ["desktop personal choice", "apps/desktop-client/src/window.html", /Personal Open Source/],
  ["desktop Feature setup", "apps/desktop-client/src/window.html", /built-in Features/],
  ["web Feature catalog", "apps/main-web/app/features/page.tsx", /Leash Features/],
  ["mobile personal sign-in", "apps/mobile-client/lib/main.dart", /personal Leash Cloud account/],
];
const forbidden = [
  ["dashboard workspace", "package.json", /apps\/dashboard-(?:api|web)/],
  ["organization dashboard onboarding", "apps/main-web/app/account/AccountClient.tsx", /Opening your dashboard|Leash Work/],
  ["public marketplace upload", "apps/main-web/app/plugins/upload/page.tsx", /submit|upload form|publisher/i],
  ["desktop dashboard launch", "apps/desktop-client/src/main.ts", /open-debug-dashboard|start-org-cloud-onboarding/],
  ["mobile company sign-in", "apps/mobile-client/lib/main.dart", /company account|Sign in with company/],
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
console.log("Leash personal user flows ok");
