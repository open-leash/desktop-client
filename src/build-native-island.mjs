import { chmod, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

if (process.platform !== "darwin") process.exit(0);

await mkdir("dist", { recursive: true });
const source = path.join("native", "macos", "OpenLeashIsland.swift");
const output = path.join("dist", "openleash-island");
const result = spawnSync("xcrun", [
  "swiftc",
  "-parse-as-library",
  "-O",
  source,
  "-o",
  output,
  "-framework",
  "AppKit",
  "-framework",
  "WebKit",
], { stdio: "inherit" });

if (result.status !== 0) {
  throw new Error(`native macOS island build failed with exit ${result.status}`);
}
await chmod(output, 0o755);
