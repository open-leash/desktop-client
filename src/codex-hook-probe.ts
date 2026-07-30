import { spawn } from "node:child_process";
import fs from "node:fs";

const appVersion = process.argv[2] || "0.0.0";
const cwds = process.argv.slice(3);
const child = spawn("codex", ["app-server", "--listen", "stdio://"], {
  stdio: ["pipe", "pipe", "ignore"],
});
let stdout = "";
let finished = false;

const timeout = setTimeout(() => finish(1), 5000);

child.on("error", () => finish(1));
child.on("exit", () => finish(1));
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk: string) => {
  stdout += chunk;
  const lines = stdout.split("\n");
  stdout = lines.pop() ?? "";
  for (const line of lines) {
    try {
      const message = JSON.parse(line) as {
        id?: number;
        result?: { data?: unknown[] };
      };
      if (message.id !== 2) continue;
      fs.writeSync(1, JSON.stringify(message.result?.data ?? []));
      finish(0);
      return;
    } catch {
      // App-server logs and unrelated notifications are not probe results.
    }
  }
});

const messages = [
  {
    id: 1,
    method: "initialize",
    params: {
      clientInfo: {
        name: "openleash-tray",
        title: "OpenLeash Tray",
        version: appVersion,
      },
      capabilities: { experimentalApi: true },
    },
  },
  { method: "initialized" },
  { id: 2, method: "hooks/list", params: { cwds } },
];
child.stdin.write(`${messages.map((message) => JSON.stringify(message)).join("\n")}\n`);

function finish(code: number) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  if (!child.killed) child.kill();
  process.exit(code);
}
