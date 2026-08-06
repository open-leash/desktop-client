#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const commands = [
  ["npm", ["run", "build", "-w", "@openleash/shared"]],
  ["npm", ["test", "-w", "@openleash/client-api"]],
  ["npm", ["test", "-w", "@openleash/desktop-client"]],
];
for (const [command, args] of commands) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log("Leash personal product smoke passed");
