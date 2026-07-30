import { spawnSync } from "node:child_process";
import path from "node:path";

export type CodexHookMetadata = {
  eventName: string;
  trustStatus: string;
  key?: string;
  sourcePath?: string;
  currentHash?: string;
};

export function enableCodexHooksFeature(config: string) {
  const features = /^(\s*\[features\]\s*\n)([\s\S]*?)(?=^\s*\[|\s*$)/m;
  const match = config.match(features);
  if (!match) {
    const separator = config.length === 0 || config.endsWith("\n") ? "" : "\n";
    return `${config}${separator}\n[features]\nhooks = true\n`.replace(
      /^\n/,
      "",
    );
  }

  const header = match[1];
  let body = match[2];
  if (/^\s*hooks\s*=\s*(?:true|false)\s*$/m.test(body)) {
    body = body.replace(
      /^\s*hooks\s*=\s*(?:true|false)\s*$/m,
      "hooks = true",
    );
  } else if (/^\s*codex_hooks\s*=\s*(?:true|false)\s*$/m.test(body)) {
    body = body.replace(
      /^\s*codex_hooks\s*=\s*(?:true|false)\s*$/m,
      "hooks = true",
    );
  } else {
    body = `hooks = true\n${body}`;
  }

  return config.replace(features, `${header}${body}`);
}

export function probeCodexHooks(
  appVersion: string,
  cwds: string[] = [process.cwd()],
): CodexHookMetadata[] {
  const helper = path.join(__dirname, "codex-hook-probe.js");
  const result = spawnSync(process.execPath, [helper, appVersion, ...cwds], {
    encoding: "utf8",
    timeout: 7000,
    maxBuffer: 4 * 1024 * 1024,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
    },
  });
  if (result.error || result.status !== 0) return [];
  try {
    const entries = JSON.parse(result.stdout) as Array<{ hooks?: unknown[] }>;
    return entries.flatMap((entry) => entry.hooks ?? []).filter(isHookMetadata);
  } catch {
    return [];
  }
}

function isHookMetadata(value: unknown): value is CodexHookMetadata {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CodexHookMetadata).eventName === "string" &&
    typeof (value as CodexHookMetadata).trustStatus === "string"
  );
}
