import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

export type AgentSessionFocusTarget = {
  agentKind?: string;
  agentName?: string;
  sessionId?: string;
  sourceSessionIds?: string[];
  projectPath?: string;
  project?: string;
  title?: string;
};

export type AgentProcess = {
  pid: number;
  tty: string;
  command: string;
  cwd?: string;
  openFiles?: string;
};

type FocusResult = {
  ok: boolean;
  exact?: boolean;
  application?: string;
  error?: string;
};

const TERMINAL_APPLICATIONS = ["Ghostty", "iTerm2", "Terminal", "Warp", "kitty", "Alacritty"];

export function parseProcessTable(value: string): AgentProcess[] {
  return value.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*(\d+)\s+(\S+)\s+(.+?)\s*$/);
    if (!match || ["??", "-"].includes(match[2])) return [];
    return [{ pid: Number(match[1]), tty: normalizeTty(match[2]), command: match[3] }];
  });
}

export function rankAgentProcesses(processes: AgentProcess[], target: AgentSessionFocusTarget) {
  const projectPath = normalizedProjectPath(target.projectPath);
  const sessionIds = new Set([target.sessionId, ...(target.sourceSessionIds ?? [])].filter(Boolean));
  return processes
    .filter((process) => processMatchesAgent(process.command, target.agentKind))
    .map((process) => {
      const cwd = normalizedProjectPath(process.cwd);
      let score = 20;
      if (projectPath && cwd === projectPath) score += 80;
      else if (projectPath && cwd && (cwd.startsWith(`${projectPath}${path.sep}`) || projectPath.startsWith(`${cwd}${path.sep}`))) score += 55;
      else if (target.project && cwd && path.basename(cwd).toLowerCase() === target.project.toLowerCase()) score += 30;
      if (process.openFiles && [...sessionIds].some((id) => process.openFiles?.includes(String(id)))) score += 120;
      return { ...process, score };
    })
    .sort((left, right) => right.score - left.score || right.pid - left.pid);
}

export function shouldAutoExpandAttention(frontmost: boolean) {
  return !frontmost;
}

export function isAgentSessionFrontmost(target: AgentSessionFocusTarget) {
  if (process.platform === "win32") {
    return matchesWindowsFrontmost(windowsFrontmostTarget(), target);
  }
  if (process.platform === "darwin") {
    const frontmost = macFrontmostTarget();
    if (!frontmost.application) return false;
    if (isIdeAgent(target.agentKind)) {
      const expected = ideApplication(target.agentKind);
      if (frontmost.application !== expected) return false;
      const project = projectLeaf(target.projectPath ?? target.project ?? "").toLowerCase();
      return !project || frontmost.windowTitle.toLowerCase().includes(project);
    }
    const resolved = resolveMacAgentProcess(target);
    return Boolean(resolved?.tty && frontmost.tty && resolved.tty === frontmost.tty);
  }
  return false;
}

export function focusAgentSession(target: AgentSessionFocusTarget): FocusResult {
  if (process.platform === "darwin") return focusMacAgentSession(target);
  if (process.platform === "win32") return focusWindowsAgentSession(target);
  return { ok: false, error: "Agent activation is supported on macOS and Windows." };
}

function focusMacAgentSession(target: AgentSessionFocusTarget): FocusResult {
  try {
    if (isIdeAgent(target.agentKind)) {
      const application = ideApplication(target.agentKind);
      const args = ["-a", application];
      if (target.projectPath) args.push(target.projectPath);
      detached("/usr/bin/open", args);
      return { ok: true, exact: Boolean(target.projectPath), application };
    }

    const resolved = resolveMacAgentProcess(target);
    if (resolved?.tty) {
      const application = focusMacTty(resolved.tty);
      if (application) return { ok: true, exact: true, application };
    }

    const application = firstRunningMacApplication(TERMINAL_APPLICATIONS) || "Terminal";
    detached("/usr/bin/open", ["-a", application]);
    return { ok: true, exact: false, application };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not focus the agent session." };
  }
}

function focusWindowsAgentSession(target: AgentSessionFocusTarget): FocusResult {
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", windowsFocusScript(target)],
    { encoding: "utf8", timeout: 3500, windowsHide: true },
  );
  const outcome = String(result.stdout ?? "").trim().split(/\r?\n/).at(-1);
  return result.status === 0 && ["exact", "fallback", "launched"].includes(outcome ?? "")
    ? { ok: true, exact: outcome === "exact", application: outcome }
    : { ok: false, error: "Could not find the agent terminal or IDE window." };
}

export function windowsFocusScript(target: AgentSessionFocusTarget) {
  const needles = windowsTargetNeedles(target);
  const applications = isIdeAgent(target.agentKind)
    ? [ideApplication(target.agentKind)]
    : ["Windows Terminal", "Terminal", "PowerShell", "Visual Studio Code", "Cursor", "Windsurf"];
  const projectPath = target.projectPath ?? "";
  const ideCommands = ideCommandCandidates(target.agentKind);
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "$shell = New-Object -ComObject WScript.Shell",
    `$needles = @(${needles.map(powerShellString).join(",")})`,
    "$candidate = Get-Process | Where-Object { $title = $_.MainWindowTitle; $matched = $false; foreach ($needle in $needles) { if ($needle -and $title -like ('*' + $needle + '*')) { $matched = $true; break } }; $matched } | Select-Object -First 1",
    "if ($candidate -and $shell.AppActivate($candidate.Id)) { [Console]::Out.WriteLine('exact'); exit 0 }",
    `$names = @(${applications.map(powerShellString).join(",")})`,
    "foreach ($name in $names) { if ($shell.AppActivate($name)) { [Console]::Out.WriteLine('fallback'); exit 0 } }",
    `$projectPath = ${powerShellString(projectPath)}`,
    ...(isIdeAgent(target.agentKind)
      ? [
          `$commands = @(${ideCommands.map(powerShellString).join(",")})`,
          "foreach ($commandName in $commands) { $command = Get-Command $commandName | Select-Object -First 1; if ($command) { if ($projectPath) { $started = Start-Process -FilePath $command.Source -ArgumentList @('--reuse-window', $projectPath) -PassThru } else { $started = Start-Process -FilePath $command.Source -PassThru }; if ($started) { [Console]::Out.WriteLine('launched'); exit 0 } } }",
        ]
      : [
          "$terminal = Get-Command 'wt.exe' | Select-Object -First 1",
          "if ($terminal) { if ($projectPath) { $started = Start-Process -FilePath $terminal.Source -ArgumentList @('-d', $projectPath) -PassThru } else { $started = Start-Process -FilePath $terminal.Source -PassThru }; if ($started) { [Console]::Out.WriteLine('launched'); exit 0 } }",
          "if ($projectPath -and (Test-Path -LiteralPath $projectPath)) { Start-Process -FilePath 'powershell.exe' -WorkingDirectory $projectPath; [Console]::Out.WriteLine('launched'); exit 0 }",
        ]),
    "exit 1",
  ].join("; ");
}

export function matchesWindowsFrontmost(
  frontmost: { processName?: string; windowTitle?: string },
  target: AgentSessionFocusTarget,
) {
  const title = String(frontmost.windowTitle ?? "").toLowerCase();
  if (!title) return false;
  const titleMatches = windowsTargetNeedles(target).some((needle) => title.includes(needle.toLowerCase()));
  if (!titleMatches) return false;
  if (!isIdeAgent(target.agentKind)) return true;
  const processName = String(frontmost.processName ?? "").toLowerCase();
  return ideProcessNames(target.agentKind).some((name) => processName.includes(name));
}

function windowsFrontmostTarget() {
  const output = commandOutput("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    WINDOWS_FRONTMOST_POWERSHELL,
  ]).trim();
  const separator = output.indexOf("|");
  return separator < 0
    ? { processName: "", windowTitle: output }
    : { processName: output.slice(0, separator), windowTitle: output.slice(separator + 1) };
}

function windowsTargetNeedles(target: AgentSessionFocusTarget) {
  return [...new Set([
    projectLeaf(target.projectPath ?? ""),
    target.project,
    target.title,
    target.agentName,
  ].filter((value): value is string => Boolean(value?.trim())).map((value) => value.trim()))];
}

function ideCommandCandidates(kind?: string) {
  const normalized = String(kind ?? "").toLowerCase();
  if (normalized === "cursor") return ["cursor.exe", "cursor.cmd", "cursor"];
  if (normalized === "windsurf") return ["windsurf.exe", "windsurf.cmd", "windsurf"];
  return ["code.exe", "code.cmd", "code"];
}

function ideProcessNames(kind?: string) {
  const normalized = String(kind ?? "").toLowerCase();
  if (normalized === "cursor") return ["cursor"];
  if (normalized === "windsurf") return ["windsurf"];
  return ["code", "visual studio code"];
}

function resolveMacAgentProcess(target: AgentSessionFocusTarget) {
  const table = commandOutput("/bin/ps", ["-axo", "pid=,tty=,command="]);
  const candidates = parseProcessTable(table)
    .filter((candidate) => processMatchesAgent(candidate.command, target.agentKind))
    .map((candidate) => ({
      ...candidate,
      cwd: cwdForPid(candidate.pid),
      openFiles: target.sessionId || target.sourceSessionIds?.length ? openFilesForPid(candidate.pid) : undefined,
    }));
  return rankAgentProcesses(candidates, target)[0];
}

function processMatchesAgent(command: string, kind?: string) {
  const patterns: Record<string, RegExp> = {
    "claude-code": /(?:^|[\s/])claude(?:[\s.-]|$)/i,
    claude: /(?:^|[\s/])claude(?:[\s.-]|$)/i,
    codex: /(?:^|[\s/])codex(?:[\s.-]|$)/i,
    gemini: /(?:^|[\s/])gemini(?:[\s.-]|$)/i,
    opencode: /(?:^|[\s/])opencode(?:[\s.-]|$)/i,
    cline: /(?:^|[\s/])cline(?:[\s.-]|$)/i,
    openclaw: /(?:^|[\s/])openclaw(?:[\s.-]|$)/i,
    nanoclaw: /(?:^|[\s/])nanoclaw(?:[\s.-]|$)/i,
  };
  return (patterns[String(kind ?? "").toLowerCase()] ?? /(?:^|[\s/])(claude|codex|gemini|opencode)(?:[\s.-]|$)/i).test(command);
}

function cwdForPid(pid: number) {
  const value = commandOutput("/usr/sbin/lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
  return value.split(/\r?\n/).find((line) => line.startsWith("n"))?.slice(1);
}

function openFilesForPid(pid: number) {
  return commandOutput("/usr/sbin/lsof", ["-p", String(pid), "-Fn"]);
}

export function focusMacTty(tty: string) {
  const result = commandOutput("/usr/bin/osascript", ["-e", FOCUS_TTY_APPLESCRIPT, tty]).trim();
  return result || undefined;
}

function macFrontmostTarget() {
  const [application = "", tty = "", windowTitle = ""] = commandOutput(
    "/usr/bin/osascript",
    ["-e", FRONTMOST_APPLESCRIPT],
  ).trim().split("|");
  return { application, tty, windowTitle };
}

function firstRunningMacApplication(applications: string[]) {
  return applications.find((application) => spawnSync("/usr/bin/pgrep", ["-x", application], { stdio: "ignore" }).status === 0);
}

function ideApplication(kind?: string) {
  const normalized = String(kind ?? "").toLowerCase();
  if (normalized === "cursor") return "Cursor";
  if (normalized === "windsurf") return "Windsurf";
  return "Visual Studio Code";
}

function isIdeAgent(kind?: string) {
  return ["cursor", "github-copilot", "copilot", "cline", "continue", "windsurf"].includes(String(kind ?? "").toLowerCase());
}

function commandOutput(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 1800, windowsHide: true });
  return result.status === 0 ? result.stdout : "";
}

function detached(command: string, args: string[]) {
  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.unref();
}

function normalizeTty(value: string) {
  return value.startsWith("/dev/") ? value : `/dev/${value}`;
}

function normalizedProjectPath(value?: string) {
  if (!value || !path.isAbsolute(value)) return undefined;
  return path.resolve(value);
}

function projectLeaf(value: string) {
  return path.win32.basename(value.replace(/[\\/]$/, "")) || path.basename(value.replace(/[\\/]$/, ""));
}

function powerShellString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}

const WINDOWS_FRONTMOST_POWERSHELL = `
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class OpenLeashForegroundWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr handle, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
}
'@
$handle = [OpenLeashForegroundWindow]::GetForegroundWindow()
$title = New-Object System.Text.StringBuilder 1024
[void][OpenLeashForegroundWindow]::GetWindowText($handle, $title, $title.Capacity)
[uint32]$processId = 0
[void][OpenLeashForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$processId)
$foregroundProcess = Get-Process -Id $processId -ErrorAction SilentlyContinue
[Console]::Out.Write(([string]$foregroundProcess.ProcessName) + '|' + $title.ToString())
`;

const FOCUS_TTY_APPLESCRIPT = `
on run argv
  set targetTTY to item 1 of argv
  if application "Terminal" is running then
    tell application "Terminal"
      repeat with terminalWindow in windows
        repeat with terminalTab in tabs of terminalWindow
          if tty of terminalTab is targetTTY then
            set selected tab of terminalWindow to terminalTab
            set index of terminalWindow to 1
            activate
            return "Terminal"
          end if
        end repeat
      end repeat
    end tell
  end if
  if application "iTerm2" is running then
    tell application "iTerm2"
      repeat with terminalWindow in windows
        repeat with terminalTab in tabs of terminalWindow
          repeat with terminalSession in sessions of terminalTab
            if tty of terminalSession is targetTTY then
              select terminalTab
              select terminalSession
              activate
              return "iTerm2"
            end if
          end repeat
        end repeat
      end repeat
    end tell
  end if
  return ""
end run`;

const FRONTMOST_APPLESCRIPT = `
tell application "System Events" to set frontName to name of first application process whose frontmost is true
set activeTTY to ""
set activeTitle to ""
if frontName is "Terminal" and application "Terminal" is running then
  tell application "Terminal"
    if (count of windows) > 0 then
      set activeTTY to tty of selected tab of front window
      set activeTitle to name of front window
    end if
  end tell
else if frontName is "iTerm2" and application "iTerm2" is running then
  tell application "iTerm2"
    if (count of windows) > 0 then
      set activeTTY to tty of current session of current window
      set activeTitle to name of current window
    end if
  end tell
else
  tell application "System Events"
    tell first application process whose frontmost is true
      if (count of windows) > 0 then set activeTitle to name of front window
    end tell
  end tell
end if
return frontName & "|" & activeTTY & "|" & activeTitle`;
