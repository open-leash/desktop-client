import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  nativeImage,
  screen,
  Tray,
  ipcMain,
  shell,
  type Display,
  type MenuItemConstructorOptions,
  type MessageBoxOptions,
  type OpenDialogOptions,
} from "electron";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  agentIconFor,
  detectLocalAgentProtections,
  installAgentProtection,
  protectionWatchTargets,
  uninstallAgentProtection,
  type LocalAgentProtection,
} from "./agent-registry";
import {
  LocalOpenLeashServer,
  normalizePolicies,
  type Policy,
} from "./local-server";
import { apiVersionHeaders } from "./api-contract";
import {
  OPENLEASH_DESKTOP_API_URL,
  OPENLEASH_DESKTOP_AUTH_CALLBACK_URI,
  OPENLEASH_DESKTOP_GITHUB_REDIRECT_URI,
  OPENLEASH_DESKTOP_GOOGLE_REDIRECT_URI,
  OPENLEASH_DESKTOP_MICROSOFT_REDIRECT_URI,
  OPENLEASH_PUBLIC_CLOUD_API_URL,
  OPENLEASH_PUBLIC_CLOUD_DASHBOARD_URL,
} from "./public-config";
import type { PluginCatalogItem } from "./plugin-catalog";
import type {
  OpenLeashClientViewModel,
  OpenLeashOutcomeRecord,
} from "@openleash/shared";
import {
  configureAgentProxy,
  installLocalProxy,
  localProxyStatus,
  uninstallLocalProxy,
  type LocalProxyStatus,
} from "./proxy-manager";
import { reconcilePluginContainers } from "./plugin-container-manager";

const APP_DISPLAY_NAME = app.isPackaged ? "OpenLeash" : "OpenLeash (Dev)";
let proxyStatus: LocalProxyStatus = {
  dockerAvailable: false,
  containerInstalled: false,
  running: false,
  healthy: false,
  url: "http://127.0.0.1:9320",
  image: "",
  configuredAgents: [],
};
let pluginContainerFingerprint = "";

function pluginFingerprint(plugins: PluginCatalogItem[]) {
  return JSON.stringify(plugins.map((plugin) => [
    plugin.id,
    plugin.version,
    plugin.settings?.enabled,
    plugin.settings?.installedVersion,
    plugin.settings?.config,
    plugin.execution?.image,
    plugin.execution?.digest,
  ]));
}

type PendingDecision = {
  id: string;
  question?: string;
  summary: string;
  agent_name: string;
  agent_kind: string;
  hostname: string;
  user_name?: string;
  event_name: string;
  tool_name?: string;
  project_path?: string;
  payload?: unknown;
  triggered_policies?: TriggeredPolicy[];
  purpose_summary?: string | null;
  recent_context?: Array<{ role?: string; content?: string; at?: string }>;
  created_at: string;
  plugin_id?: string;
  plugin_name?: string;
  quote?: string | null;
};

type AgentStatus = {
  id: string;
  decision_id?: string;
  kind: string;
  display_name: string;
  hostname: string;
  user_name?: string;
  last_seen_at?: string;
  event_name?: string;
  tool_name?: string;
  project_path?: string;
  payload?: unknown;
  activity_at?: string;
  decision?: string;
  resolution?: "allow" | "deny" | null;
  resolution_guidance?: string | null;
  decision_summary?: string;
  question?: string;
  triggered_policies?: TriggeredPolicy[];
  recent_activity?: Array<{
    id?: string;
    event_name?: string;
    tool_name?: string;
    project_path?: string;
    prompt?: string;
    payload?: unknown;
    created_at?: string;
    decision?: string;
    resolution?: "allow" | "deny" | null;
    summary?: string;
    question?: string;
    triggered_policies?: TriggeredPolicy[];
  }>;
  sessions?: AgentSession[];
  short_summary: string;
};

type AgentSession = {
  id: string;
  title: string;
  summary?: string;
  project_path?: string;
  started_at?: string;
  last_activity_at?: string;
  duration_seconds?: number;
  event_count?: number;
  approval_count?: number;
  denied_count?: number;
  mcp_servers?: string[];
  events?: AgentStatus["recent_activity"];
};

type SessionMetrics = {
  today?: { session_count?: number; duration_seconds?: number };
  last24h?: { session_count?: number; duration_seconds?: number };
  week?: { session_count?: number; duration_seconds?: number };
  month?: { session_count?: number; duration_seconds?: number };
  by_agent_24h?: Array<{
    agent_kind?: string;
    agent_name?: string;
    session_count?: number;
    duration_seconds?: number;
  }>;
};

type RemoteMobileState = {
  policies?: Array<{
    id: string;
    name: string;
    description?: string;
    severity?: string;
    natural_language_rule?: string;
    enabled: boolean;
    locked?: boolean;
  }>;
  pendingApprovals?: Array<{
    id: string;
    question?: string;
    summary?: string;
    agent_name?: string;
    agent_kind?: string;
    hostname?: string;
    user_name?: string;
    event_name?: string;
    tool_name?: string;
    project_path?: string;
    payload?: unknown;
    triggered_policies?: TriggeredPolicy[];
    purpose_summary?: string | null;
    plugin_id?: string;
    plugin_name?: string;
    quote?: string | null;
    recent_context?: Array<{ role?: string; content?: string; at?: string }>;
    created_at?: string;
  }>;
  recentActivity?: PendingDecision[];
  agents?: Array<{
    id: string;
    kind?: string;
    display_name?: string;
    hostname?: string;
    platform?: string;
    installed?: boolean;
    protected?: boolean;
    desired_monitored?: boolean;
    desiredMonitored?: boolean;
    last_seen_at?: string;
    event_name?: string;
    tool_name?: string;
    project_path?: string;
    activity_at?: string;
    decision?: string;
    resolution?: "allow" | "deny" | null;
    decision_summary?: string;
    short_summary?: string;
    sessions?: AgentSession[];
    question?: string;
    triggered_policies?: TriggeredPolicy[];
    recent_activity?: AgentStatus["recent_activity"];
    payload?: unknown;
  }>;
  sessionMetrics?: Record<string, unknown>;
};

type PluginOutcome = OpenLeashOutcomeRecord;

type PublicPluginListing = Record<string, unknown> & {
  id?: string;
  slug?: string;
  name?: string;
  description?: string;
  publisher?: string;
  repositoryUrl?: string;
  version?: string;
  runtime?: string;
  entrypoint?: string;
  events?: unknown[];
  permissions?: unknown[];
  effects?: unknown[];
  ordering?: Record<string, unknown>;
  configSchema?: Record<string, unknown>;
  defaultConfig?: Record<string, unknown>;
};

type TriggeredPolicy = {
  policy_name: string;
  status: "failed" | "needs_question";
  severity: string;
  explanation: string;
  evidence?: string[] | string;
};

type UpdateManifest = {
  version: string;
  updateAvailable?: boolean;
  latestVersion?: string;
  dmgUrl?: string;
  downloadUrl?: string;
  sha256?: string;
  sizeBytes?: number;
  notesUrl?: string;
  releaseNotes?: string;
  publishedAt?: string;
};

type UpdateState = {
  lastCheckedAt?: string;
  lastPromptedAt?: string;
  lastPromptedVersion?: string;
};

const localDevCloudApiUrl = "http://127.0.0.1:9318";
const apiUrl = OPENLEASH_DESKTOP_API_URL;
const cloudApiUrl =
  process.env.OPENLEASH_CLOUD_API_URL ??
  (app.isPackaged ? OPENLEASH_PUBLIC_CLOUD_API_URL : localDevCloudApiUrl);
const publicPluginCatalogApiUrl =
  process.env.OPENLEASH_PUBLIC_PLUGIN_CATALOG_API_URL ?? cloudApiUrl;
const cloudDashboardUrl =
  process.env.OPENLEASH_CLOUD_DASHBOARD_URL ??
  OPENLEASH_PUBLIC_CLOUD_DASHBOARD_URL;
const cloudDevAuth = process.env.OPENLEASH_MOBILE_DEV_AUTH === "1";
const cloudDevAuthEmail =
  process.env.OPENLEASH_MOBILE_DEV_EMAIL ?? "mobile.user@openleash.com";
const desktopRedirectUri = OPENLEASH_DESKTOP_AUTH_CALLBACK_URI;
const desktopGoogleRedirectUri = OPENLEASH_DESKTOP_GOOGLE_REDIRECT_URI;
const desktopMicrosoftRedirectUri = OPENLEASH_DESKTOP_MICROSOFT_REDIRECT_URI;
const desktopGithubRedirectUri = OPENLEASH_DESKTOP_GITHUB_REDIRECT_URI;
const here = __dirname;
const defaultUpdateFeedUrl = app.isPackaged
  ? `${OPENLEASH_PUBLIC_CLOUD_API_URL}/api/updates/check`
  : "";
const updateCheckIntervalMs = 24 * 60 * 60 * 1000;
const individualOpenSourceApiUrl = "http://127.0.0.1:9318";
const NOTICE_CONTEXT_MESSAGE_COUNT = Number(
  process.env.OPENLEASH_ACTION_PURPOSE_MESSAGES ?? 5,
);
const MAIN_WINDOW_WIDTH = 1160;
const MAIN_WINDOW_HEIGHT = 760;
const MAIN_WINDOW_MIN_WIDTH = 1040;
const MAIN_WINDOW_MIN_HEIGHT = 700;
let localServer: LocalOpenLeashServer;
let tray: Tray | undefined;
let traySingleClickTimer: NodeJS.Timeout | undefined;
let window: BrowserWindow | undefined;
let noticeWindow: BrowserWindow | undefined;
let latestPending: PendingDecision[] = [];
let latestAgents: AgentStatus[] = [];
let latestSessionMetrics: SessionMetrics = {};
let latestPlugins: PluginCatalogItem[] = [];
let latestOutcomes: PluginOutcome[] = [];
let latestViewModel: OpenLeashClientViewModel | undefined;
let localProtections: LocalAgentProtection[] = [];
let localProtectionCheckedAt = 0;

function remoteApiError(
  error: unknown,
  remoteApiUrl: string,
  fallback: string,
) {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const localDevApi =
    remoteApiUrl === localDevCloudApiUrl ||
    /^https?:\/\/(127\.0\.0\.1|localhost):9318\b/i.test(remoteApiUrl);
  if (
    /fetch failed|failed to fetch|econnrefused|enotfound|etimedout|econnreset|networkerror/i.test(
      raw,
    )
  ) {
    if (localDevApi && !app.isPackaged) {
      return `OpenLeash Cloud client API is not running at ${remoteApiUrl}. Start the local OpenLeash Cloud dev stack, then try again.`;
    }
    if (localDevApi) {
      return "OpenLeash Cloud is temporarily unreachable. Check your connection and try again.";
    }
    if (remoteApiUrl === OPENLEASH_PUBLIC_CLOUD_API_URL) {
      return `Could not reach OpenLeash Cloud at ${remoteApiUrl}. Check your connection and try again.`;
    }
    return `Could not reach OpenLeash at ${remoteApiUrl}. Check the API URL and network, then try again.`;
  }
  return raw || fallback;
}

function isPersonalEmailDomain(email?: string) {
  const domain =
    String(email ?? "")
      .split("@")[1]
      ?.toLowerCase() ?? "";
  return new Set([
    "gmail.com",
    "googlemail.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "msn.com",
    "icloud.com",
    "me.com",
    "mac.com",
    "yahoo.com",
    "proton.me",
    "protonmail.com",
    "aol.com",
  ]).has(domain);
}
let activeNoticeKey: string | undefined;
let suppressedNoticeKeys = new Set<string>();
const rememberedApprovalChoices = new Map<
  string,
  { resolution: "allow" | "deny"; expiresAt: number }
>();
let latestRemoteHistory: PendingDecision[] = [];
let resolvingDecisionIds = new Set<string>();
let suppressMainWindowActivationUntil = 0;
let currentTrayStatus: "ok" | "pending" | "down" = "ok";
const enforcedAgentKinds = new Set<string>();
const protectionWatchers = new Map<string, fs.FSWatcher>();
const pendingProtectionRepairs = new Map<string, NodeJS.Timeout>();
let protectionAuditTimer: NodeJS.Timeout | undefined;
let repairingProtections = false;
const skillWatchers = new Map<string, fs.FSWatcher>();
const pendingSkillScans = new Map<string, NodeJS.Timeout>();
const observedSkillHashes = new Map<string, string>();
let skillWatcherSyncTimer: NodeJS.Timeout | undefined;
let quitting = false;
let pendingDesktopAuth:
  | {
      apiUrl: string;
      providerType: string;
      exchangeRedirectUri?: string;
      organizationId?: string;
      organizationSlug?: string;
      audience?: "individual" | "organization";
    }
  | undefined;
let desktopAuthSession:
  | {
      token: string;
      apiUrl: string;
      expiresAt?: string;
      organizationName?: string;
      organizationSlug?: string;
      userName?: string;
      userEmail?: string;
    }
  | undefined;
let selfHostedRuntime = {
  dockerInstalled: false,
  dockerRunning: false,
  apiReachable: false,
  status: "Not checked",
  log: "",
};

function startupLog(message: string) {
  try {
    fs.appendFileSync(
      path.join(os.tmpdir(), "openleash-startup.log"),
      `${new Date().toISOString()} ${message}\n`,
    );
    if (!app.isPackaged) console.log(`[openleash] ${message}`);
  } catch {
    // Best-effort packaged startup diagnostics.
  }
}

async function openTrustedExternalUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (!["https:", "http:"].includes(url.protocol)) {
    throw new Error(
      `Refusing to open unsupported external URL scheme: ${url.protocol}`,
    );
  }
  await shell.openExternal(url.toString());
}

function hardenWindow(target: BrowserWindow) {
  target.webContents.setWindowOpenHandler(({ url }) => {
    void openTrustedExternalUrl(url).catch((error) =>
      startupLog(
        `blocked external window: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    return { action: "deny" };
  });
  target.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
}

process.on("uncaughtException", (error) => {
  startupLog(`uncaughtException: ${error.stack || error.message}`);
});

process.on("unhandledRejection", (reason) => {
  startupLog(
    `unhandledRejection: ${reason instanceof Error ? reason.stack || reason.message : String(reason)}`,
  );
});

function showDockIcon() {
  if (process.platform !== "darwin") return;
  app.setActivationPolicy?.("regular");
  app.dock?.show();
}

function hideDockIcon() {
  if (process.platform !== "darwin") return;
  app.setActivationPolicy?.("accessory");
  app.dock?.hide();
}

function setupNeedsDockIcon() {
  return !localServer?.setupComplete;
}

function keepDockIconForSetup() {
  if (!setupNeedsDockIcon()) return;
  showDockIcon();
  if (window && !window.isDestroyed()) window.setSkipTaskbar(false);
}

function activateOpenLeashApp() {
  if (process.platform !== "darwin") return;
  showDockIcon();
  app.focus({ steal: true });
}

function hideDockIconIfTrayMode() {
  if (setupNeedsDockIcon()) {
    keepDockIconForSetup();
    return;
  }
  hideDockIcon();
}

function shouldPreserveSettingsForLaunch() {
  const args = process.argv.slice(1);
  return (
    args.includes("--keep-settings") ||
    args.includes("--preserve-settings") ||
    args.includes("--update") ||
    args.includes("--check-for-updates")
  );
}

function currentInstallIdentity() {
  if (!app.isPackaged) return undefined;
  const bundlePath = appBundlePath();
  const statTarget =
    process.platform === "darwin" ? bundlePath : process.execPath;
  try {
    const stat = fs.statSync(statTarget);
    return JSON.stringify({
      platform: process.platform,
      path: fs.realpathSync.native(bundlePath),
      version: app.getVersion(),
      birthtimeMs: Math.round(stat.birthtimeMs),
      ctimeMs: Math.round(stat.ctimeMs),
      size: stat.size,
    });
  } catch (error) {
    startupLog(
      `install identity unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

function appBundlePath() {
  if (process.platform !== "darwin") return path.dirname(process.execPath);
  const marker = ".app/Contents/MacOS/";
  const markerIndex = process.execPath.indexOf(marker);
  if (markerIndex < 0) return path.dirname(process.execPath);
  return process.execPath.slice(0, markerIndex + ".app".length);
}

function localStateLooksOlderThanCurrentApp(identity: string) {
  const current = parseInstallIdentity(identity);
  if (!current?.ctimeMs) return false;
  try {
    const dbPath = path.join(app.getPath("userData"), "openleash.sqlite");
    const legacyPath = path.join(app.getPath("userData"), "store.json");
    const candidates = [dbPath, legacyPath]
      .filter((candidate) => fs.existsSync(candidate))
      .map((candidate) => fs.statSync(candidate).mtimeMs);
    if (candidates.length === 0) return false;
    return Math.min(...candidates) + 60_000 < current.ctimeMs;
  } catch {
    return false;
  }
}

function isInstalledApplicationIdentity(identity: string) {
  const current = parseInstallIdentity(identity);
  if (process.platform !== "darwin") return true;
  return Boolean(current?.path?.startsWith("/Applications/"));
}

function parseInstallIdentity(identity?: string) {
  try {
    return identity
      ? (JSON.parse(identity) as { path?: string; ctimeMs?: number })
      : undefined;
  } catch {
    return undefined;
  }
}

function syncInstallIdentity() {
  const identity = currentInstallIdentity();
  if (!identity) return;
  const previous = localServer.installIdentity();
  const preserveSettings = shouldPreserveSettingsForLaunch();
  const explicitFreshStart = process.argv.includes("--fresh-install");
  if (previous === identity && !explicitFreshStart) return;

  const shouldReset =
    explicitFreshStart ||
    (!preserveSettings && Boolean(previous) && previous !== identity) ||
    (!preserveSettings &&
      !previous &&
      localServer.setupComplete &&
      (!isInstalledApplicationIdentity(identity) ||
        localStateLooksOlderThanCurrentApp(identity)));

  if (shouldReset) {
    localServer.resetAllLocalState();
    startupLog(
      previous
        ? "local state reset after app bundle replacement"
        : "local state reset after fresh app launch",
    );
  } else if (previous !== identity) {
    startupLog(
      preserveSettings
        ? "settings preserved for app bundle replacement"
        : "install identity initialized",
    );
  }
  localServer.rememberInstallIdentity(identity);
}

startupLog(`main loaded argv=${process.argv.join(" ")}`);
app.setName("OpenLeash");
app.setAsDefaultProtocolClient("openleash");
app.setAboutPanelOptions({ applicationName: APP_DISPLAY_NAME });

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  startupLog("single instance lock unavailable; exiting");
  app.exit(0);
} else {
  startupLog("single instance lock acquired");
  app.on("second-instance", (_event, argv) => {
    const authUrl = argv.find((value) => value.startsWith("openleash://"));
    if (authUrl) {
      void handleDesktopAuthCallback(authUrl);
      return;
    }
    if (argv.includes("--update") || argv.includes("--check-for-updates")) {
      void checkForUpdates({
        source: "manual",
        force: true,
        autoInstall: argv.includes("--yes") || argv.includes("--install"),
      });
      return;
    }
    restoreMainWindow();
  });
}

app
  .whenReady()
  .then(async () => {
    startupLog("ready");
    const forceVisibleLaunch =
      process.argv.includes("--reset-setup") ||
      process.argv.includes("--fresh-install") ||
      process.argv.includes("--show-window");
    const openedAsHidden =
      !forceVisibleLaunch &&
      (app.getLoginItemSettings().wasOpenedAsHidden ||
        process.argv.includes("--hidden"));
    const dockIcon = nativeImage.createFromPath(
      path.join(here, "openleash-icon.png"),
    );
    if (!dockIcon.isEmpty()) app.dock?.setIcon(dockIcon);
    if (openedAsHidden) {
      hideDockIcon();
      startupLog("dock hidden for tray mode");
    } else {
      showDockIcon();
      startupLog("dock shown for visible window launch");
    }
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true,
      name: APP_DISPLAY_NAME,
    });
    startupLog("login item set");
    localServer = new LocalOpenLeashServer(app.getPath("userData"), {
      onAgentStop: playAgentDoneSound,
      onRemoteHookForward: refreshPendingApprovalsSoon,
    });
    startupLog(`local server constructed at ${app.getPath("userData")}`);
    syncInstallIdentity();
    if (process.argv.includes("--reset-setup")) {
      localServer.resetSetup();
      startupLog("setup reset");
    }
    await localServer.start();
    startupLog("local server started");
    const startupPluginStatuses = await reconcilePluginContainers(localServer.plugins);
    localServer.syncPluginRuntimeStatuses(startupPluginStatuses);
    pluginContainerFingerprint = pluginFingerprint(localServer.plugins);
    const unhealthyStartupPlugins = startupPluginStatuses.filter((status) => !status.healthy);
    if (unhealthyStartupPlugins.length > 0) {
      startupLog(`plugin containers unhealthy at startup: ${unhealthyStartupPlugins.map((status) => `${status.pluginId}: ${status.error}`).join(", ")}`);
    }
    await migrateLocalDevCloudTarget();
    const cliResult = handleCliRuleImport();
    if (cliResult && cliResult.exitAfter) {
      startupLog("exiting after rule import");
      app.exit(cliResult.ok ? 0 : 1);
      return;
    }
    const cliEnrollResult = await handleCliEnrollment();
    if (cliEnrollResult?.exitAfter) {
      startupLog("exiting after client enrollment");
      app.exit(cliEnrollResult.ok ? 0 : 1);
      return;
    }
    const cliConfigResult = await handleCliClientConfig();
    if (cliConfigResult?.exitAfter) {
      startupLog("exiting after client config");
      app.exit(cliConfigResult.ok ? 0 : 1);
      return;
    }
    const cliUpdateResult = await handleCliUpdate();
    if (cliUpdateResult?.exitAfter) {
      startupLog("exiting after update");
      app.exit(cliUpdateResult.ok ? 0 : 1);
      return;
    }
    ensureTray("ok");
    installApplicationMenu();
    startupLog("tray created");
    refreshMenu();
    startupLog("menu refreshed");
    await refreshLocalProtections(true);
    startupLog("protections refreshed");
    rememberCurrentlyProtectedAgents();
    proxyStatus = await localProxyStatus();
    if (
      localServer.setupComplete &&
      !proxyStatus.containerInstalled &&
      localServer.effectiveToken
    ) {
      try {
        proxyStatus = await installProxyForMonitoredAgents([
          ...enforcedAgentKinds,
        ]);
        startupLog("local proxy installed for monitored agents");
      } catch (error) {
        startupLog(
          `local proxy automatic install skipped: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
    }
    startupLog(
      `local proxy ${proxyStatus.healthy ? "healthy" : proxyStatus.running ? "running" : "stopped"}`,
    );
    startProtectionIntegrityGuard();
    startSkillIntegrityGuard();
    setInterval(async () => {
      const desired = [...proxyStatus.configuredAgents];
      const current = await localProxyStatus();
      if (current.running) {
        for (const kind of desired) configureAgentProxy(kind, true);
      }
      proxyStatus = await localProxyStatus();
      refreshMenu();
    }, 15_000);
    void poll();
    setInterval(poll, 3000);
    void maybeOfferUpdate();
    if (!openedAsHidden) {
      showMainWindow(localServer.setupComplete ? "settings" : "setup");
      startupLog("main window shown");
    }
  })
  .catch((error) => {
    const message =
      error instanceof Error ? error.stack || error.message : String(error);
    startupLog(`ready failed: ${message}`);
    if (!app.isPackaged) console.error(`[openleash] ready failed: ${message}`);
  });

app.on("activate", () => {
  if (Date.now() < suppressMainWindowActivationUntil) {
    return;
  }
  if (noticeWindow && !noticeWindow.isDestroyed()) {
    return;
  }
  restoreMainWindow();
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  void handleDesktopAuthCallback(url);
});

app.on("before-quit", () => {
  quitting = true;
});

app.on("window-all-closed", () => {
  // Keep the tray process alive after the approval window is hidden.
});

ipcMain.handle("openleash:list", () => ({
  apiUrl,
  cloudApiUrl,
  cloudDevAuth,
  cloudDevAuthEmail,
  mode: localServer?.setupComplete ? "settings" : "setup",
  setupComplete: localServer?.setupComplete ?? false,
  introSeen: localServer?.introSeen ?? false,
  clientMode: localServer?.clientMode ?? "cloud",
  remoteApiUrl: localServer?.remoteApiUrl,
  remoteOrganization: localServer?.remoteOrganization,
  remoteUser: localServer?.remoteUser,
  apiProvider: localServer?.apiProvider ?? "openai",
  apiKeySet: localServer?.apiKeySet ?? false,
  agentDoneSound: localServer?.agentDoneSound ?? false,
  promptTransforms: localServer?.promptTransforms,
  plugins:
    latestPlugins.length > 0 ? latestPlugins : (localServer?.plugins ?? []),
  outcomes: latestOutcomes,
  viewModel: latestViewModel,
  pending: latestPending,
  agents: latestAgents,
  sessionMetrics: latestSessionMetrics,
  localProtections,
  policies: localServer?.policies ?? [],
  history: localServer?.history ?? [],
  mcpServers: localServer?.mcpServers ?? [],
  skills: localServer?.skills ?? [],
  proxyStatus,
}));
ipcMain.handle("openleash:mark-intro-seen", () => {
  localServer?.markIntroSeen();
  return { ok: true };
});
ipcMain.handle(
  "openleash:bootstrap-remote-api",
  async (_event, payload: { apiUrl?: string; organizationSlug?: string }) => {
    try {
      const remoteApiUrl = normalizeRemoteApiUrl(payload.apiUrl || cloudApiUrl);
      const result = await fetchMobileBootstrap(
        remoteApiUrl,
        payload.organizationSlug,
      );
      if (
        result.ok ||
        app.isPackaged ||
        remoteApiUrl !== OPENLEASH_PUBLIC_CLOUD_API_URL
      )
        return result;
      return fetchMobileBootstrap(
        localDevCloudApiUrl,
        payload.organizationSlug,
      );
    } catch (error) {
      const remoteApiUrl = normalizeRemoteApiUrl(payload.apiUrl || cloudApiUrl);
      return {
        ok: false,
        error: remoteApiError(
          error,
          remoteApiUrl,
          "Could not reach that OpenLeash API.",
        ),
      };
    }
  },
);
ipcMain.handle(
  "openleash:start-remote-auth",
  async (
    _event,
    payload: {
      apiUrl?: string;
      providerType?: string;
      organizationId?: string;
      organizationSlug?: string;
      audience?: "individual" | "organization";
    },
  ) => {
    try {
      const remoteApiUrl = normalizeRemoteApiUrl(payload.apiUrl || cloudApiUrl);
      const providerType = payload.providerType || "google";
      const audience =
        payload.audience === "organization" ? "organization" : "individual";
      const result = await startMobileAuth(remoteApiUrl, providerType, {
        ...payload,
        audience,
        organizationId:
          audience === "organization" ? payload.organizationId : undefined,
        organizationSlug:
          audience === "organization" ? payload.organizationSlug : undefined,
      });
      if (
        result.ok ||
        app.isPackaged ||
        remoteApiUrl !== OPENLEASH_PUBLIC_CLOUD_API_URL
      )
        return result;
      return startMobileAuth(localDevCloudApiUrl, providerType, {
        ...payload,
        audience,
        organizationId:
          audience === "organization" ? payload.organizationId : undefined,
        organizationSlug:
          audience === "organization" ? payload.organizationSlug : undefined,
      });
    } catch (error) {
      const remoteApiUrl = normalizeRemoteApiUrl(payload.apiUrl || cloudApiUrl);
      return {
        ok: false,
        error: remoteApiError(error, remoteApiUrl, "Could not start sign-in."),
      };
    }
  },
);
ipcMain.handle(
  "openleash:start-org-cloud-onboarding",
  async (_event, payload: { provider?: "google" | "microsoft" }) => {
    try {
      keepDockIconForSetup();
      const provider =
        payload.provider === "microsoft" ? "microsoft" : "google";
      const dashboardUrl = new URL(
        cloudDashboardUrl.replace(/\/$/, "") || "http://localhost:9300",
      );
      dashboardUrl.pathname = "/auth/cloud/start";
      dashboardUrl.searchParams.set("provider", provider);
      dashboardUrl.searchParams.set("desktop", "1");
      await openTrustedExternalUrl(dashboardUrl.toString());
      keepDockIconForSetup();
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not open OpenLeash Cloud sign-in.",
      };
    }
  },
);

ipcMain.handle("openleash:open-debug-dashboard", async () => {
  try {
    const dashboardUrl = new URL(
      cloudDashboardUrl.replace(/\/$/, "") || "http://localhost:9300",
    );
    const slug = localServer?.remoteOrganization;
    dashboardUrl.pathname =
      slug && !dashboardUrl.pathname.includes(slug)
        ? `/${encodeURIComponent(slug)}/log`
        : "/log";
    await openTrustedExternalUrl(dashboardUrl.toString());
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not open Log in the dashboard.",
    };
  }
});

async function fetchMobileBootstrap(
  remoteApiUrl: string,
  organizationSlug?: string,
) {
  try {
    const url = new URL("/v1/mobile/bootstrap", remoteApiUrl);
    if (organizationSlug)
      url.searchParams.set("organizationSlug", organizationSlug);
    const response = await fetch(url, {
      headers: apiVersionHeaders("mobileBootstrap"),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      return {
        ok: false,
        error: body.error || `Could not connect to ${remoteApiUrl}.`,
      };
    return { ok: true, apiUrl: remoteApiUrl, ...body };
  } catch (error) {
    return {
      ok: false,
      error: remoteApiError(
        error,
        remoteApiUrl,
        `Could not connect to ${remoteApiUrl}.`,
      ),
    };
  }
}

async function startMobileAuth(
  remoteApiUrl: string,
  providerType: string,
  payload: {
    organizationId?: string;
    organizationSlug?: string;
    audience?: "individual" | "organization";
  },
) {
  try {
    const browserRedirectUri =
      providerType === "azure_ad" || providerType === "microsoft"
        ? desktopMicrosoftRedirectUri
        : providerType === "github"
          ? desktopGithubRedirectUri
          : desktopGoogleRedirectUri;
    const response = await fetch(
      new URL("/v1/mobile/auth/start", remoteApiUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...apiVersionHeaders("mobileAuthStart"),
        },
        body: JSON.stringify({
          redirectUri: browserRedirectUri,
          audience:
            payload.audience === "organization" ? "organization" : "individual",
          providerType,
          organizationId: payload.organizationId,
          organizationSlug: payload.organizationSlug,
        }),
      },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.authorizationUrl) {
      return {
        ok: false,
        error: body.error || "This API could not start sign-in.",
      };
    }
    pendingDesktopAuth = {
      apiUrl: remoteApiUrl,
      providerType: body.providerType || providerType,
      exchangeRedirectUri: body.exchangeRedirectUri,
      organizationId: body.organizationId || payload.organizationId,
      organizationSlug: payload.organizationSlug,
      audience:
        payload.audience === "organization" ? "organization" : "individual",
    };
    keepDockIconForSetup();
    await openTrustedExternalUrl(body.authorizationUrl);
    keepDockIconForSetup();
    return { ok: true, providerType: pendingDesktopAuth.providerType };
  } catch (error) {
    return {
      ok: false,
      error: remoteApiError(
        error,
        remoteApiUrl,
        `Could not start sign-in from ${remoteApiUrl}.`,
      ),
    };
  }
}

async function enrollDesktopEndpoint(
  remoteApiUrl: string,
  dashboardToken: string,
  agents: string[] = [],
): Promise<
  | {
      ok: true;
      token: string;
      user?: { email?: string; display_name?: string };
    }
  | { ok: false; error: string }
> {
  try {
    const response = await fetch(new URL("/v1/desktop/enroll", remoteApiUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${dashboardToken}`,
        ...apiVersionHeaders("desktopEnroll"),
      },
      body: JSON.stringify({
        hostname: os.hostname(),
        platform: os.platform(),
        osRelease: os.release(),
        clientVersion: app.getVersion(),
        agents: enrollmentAgents(agents),
      }),
      signal: AbortSignal.timeout(
        Number(process.env.OPENLEASH_DESKTOP_ENROLL_TIMEOUT_MS ?? 15000),
      ),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.token) {
      return {
        ok: false,
        error:
          body.error ||
          body.message ||
          "Could not enroll this Mac with OpenLeash.",
      };
    }
    return { ok: true, token: body.token, user: body.user };
  } catch (error) {
    return {
      ok: false,
      error: remoteApiError(
        error,
        remoteApiUrl,
        "Could not enroll this Mac with OpenLeash.",
      ),
    };
  }
}

function enrollmentAgents(agentKinds: string[]) {
  const selected = new Set(agentKinds.filter(Boolean));
  for (const agent of localProtections) {
    if (agent.installed) selected.add(agent.kind);
  }
  const detected = new Map(
    localProtections.map((agent) => [agent.kind, agent]),
  );
  return [...selected].map((kind) => {
    const detectedAgent = detected.get(kind);
    return {
      kind,
      displayName: detectedAgent?.displayName ?? agentDisplayName(kind),
      executablePath: detectedAgent?.executablePath ?? "",
    };
  });
}

function desktopInventoryAgents() {
  return localProtections.map((agent) => ({
    kind: agent.kind,
    displayName: agent.displayName,
    executablePath: agent.executablePath ?? "",
    installed: agent.installed,
    protected: agent.protected,
    detail: agent.detail,
  }));
}

function agentDisplayName(kind: string) {
  if (kind === "claude-code") return "Claude Code";
  if (kind === "codex") return "OpenAI Codex";
  if (kind === "cline") return "Cline";
  if (kind === "opencode") return "OpenCode";
  if (kind === "cursor") return "Cursor";
  if (kind === "gemini") return "Google Gemini CLI";
  if (kind === "windsurf") return "Windsurf";
  return kind;
}

ipcMain.handle(
  "openleash:save-remote-model-key",
  async (
    _event,
    payload: {
      apiUrl?: string;
      token?: string;
      apiProvider?: "openai" | "anthropic";
      apiKey?: string;
    },
  ) => {
    const token = payload.token || desktopAuthSession?.token;
    if (!token)
      return { ok: false, error: "Sign in before saving the model key." };
    const apiKey = String(payload.apiKey ?? "").trim();
    if (!apiKey) return { ok: false, error: "API key is required." };
    const remoteApiUrl = normalizeRemoteApiUrl(
      payload.apiUrl || desktopAuthSession?.apiUrl || cloudApiUrl,
    );
    const response = await fetch(
      new URL("/v1/mobile/model-key", remoteApiUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          ...apiVersionHeaders("mobileModelKey"),
        },
        body: JSON.stringify({
          provider:
            payload.apiProvider === "anthropic" ? "anthropic" : "openai",
          apiKey,
        }),
      },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      return {
        ok: false,
        error: body.error || "Could not save the model key to this tenant.",
      };
    return { ok: true, ...body };
  },
);
ipcMain.handle(
  "openleash:remote-state",
  async (_event, payload: { apiUrl?: string; token?: string }) => {
    const token = payload.token || desktopAuthSession?.token;
    if (!token)
      return { ok: false, error: "Sign in before loading managed rules." };
    const remoteApiUrl = normalizeRemoteApiUrl(
      payload.apiUrl || desktopAuthSession?.apiUrl || cloudApiUrl,
    );
    const response = await fetch(new URL("/v1/mobile/state", remoteApiUrl), {
      headers: {
        authorization: `Bearer ${token}`,
        ...apiVersionHeaders("mobileState"),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      return {
        ok: false,
        error: body.error || "Could not load managed OpenLeash state.",
      };
    return { ok: true, ...body };
  },
);
ipcMain.handle(
  "openleash:save-plugin-settings",
  async (
    _event,
    payload: {
      apiUrl?: string;
      token?: string;
      pluginId?: string;
      enabled?: boolean;
      config?: Record<string, unknown>;
      profiles?: Array<{
        id: string;
        name: string;
        agentKinds: string[];
        enabled?: boolean;
        config: Record<string, unknown>;
        priority?: number;
      }>;
      orderingPriority?: number | null;
      marketplace?: PublicPluginListing;
    },
  ) => {
    const token =
      payload.token || localServer.effectiveToken || desktopAuthSession?.token;
    if (!token)
      return { ok: false, error: "Sign in before saving plugin settings." };
    const pluginId = String(payload.pluginId ?? "").trim();
    if (!pluginId) return { ok: false, error: "Plugin id is required." };
    const remoteApiUrl = normalizeRemoteApiUrl(
      payload.apiUrl ||
        localServer.remoteApiUrl ||
        desktopAuthSession?.apiUrl ||
        cloudApiUrl,
    );
    const response = await fetch(
      new URL(
        `/v1/plugins/${encodeURIComponent(pluginId)}/settings`,
        remoteApiUrl,
      ),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          enabled: payload.enabled !== false,
          config: payload.config ?? {},
          profiles: payload.profiles ?? undefined,
          orderingPriority: payload.orderingPriority ?? undefined,
          marketplace: payload.marketplace ?? undefined,
        }),
      },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      return {
        ok: false,
        error: body.error || "Could not save plugin settings.",
      };
    return { ok: true, ...body };
  },
);
ipcMain.handle("openleash:import-local-plugin-folder", async () => {
  const remoteApiUrl = normalizeRemoteApiUrl(
    localServer.remoteApiUrl || cloudApiUrl,
  );
  if (!isLocalApiUrl(remoteApiUrl)) {
    return {
      ok: false,
      error:
        "Local plugin folders can only be added to a local OpenLeash backend.",
    };
  }
  const token = localServer.effectiveToken;
  if (!token) return { ok: false, error: "Local backend auth is not ready." };
  const selected = window
    ? await dialog.showOpenDialog(window, {
        title: "Add local OpenLeash plugin",
        buttonLabel: "Add plugin",
        properties: ["openDirectory"],
      })
    : await dialog.showOpenDialog({
        title: "Add local OpenLeash plugin",
        buttonLabel: "Add plugin",
        properties: ["openDirectory"],
      });
  if (selected.canceled || !selected.filePaths[0])
    return { ok: false, canceled: true };
  try {
    const marketplace = await readLocalPluginFolderListing(
      selected.filePaths[0],
    );
    const response = await fetch(
      new URL(
        `/v1/plugins/${encodeURIComponent(String(marketplace.id))}/settings`,
        remoteApiUrl,
      ),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          enabled: true,
          config: marketplace.defaultConfig ?? {},
          orderingPriority:
            typeof marketplace.ordering?.priority === "number"
              ? marketplace.ordering.priority
              : undefined,
          marketplace,
        }),
      },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      return { ok: false, error: body.error || "Could not add local plugin." };
    latestPlugins = await fetchRemotePluginCatalog(
      remoteApiUrl,
      token,
      latestPlugins,
    );
    window?.webContents.send("openleash:update", { plugins: latestPlugins });
    return {
      ok: true,
      pluginId: marketplace.id,
      plugin: marketplace,
      settings: body.settings,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not add local plugin folder.",
    };
  }
});
ipcMain.handle("openleash:docker-status", async () => {
  selfHostedRuntime = await checkSelfHostedRuntime();
  return selfHostedRuntime;
});
ipcMain.handle("openleash:start-self-hosted", async () => {
  selfHostedRuntime = await startSelfHostedRuntime();
  return selfHostedRuntime;
});
ipcMain.handle("openleash:proxy-status", async () => {
  proxyStatus = await localProxyStatus();
  return proxyStatus;
});
ipcMain.handle(
  "openleash:install-proxy",
  async (_event, payload: { agents?: string[]; corporateProxy?: string }) => {
    try {
      const token = localServer.effectiveToken || desktopAuthSession?.token;
      if (!token)
        return {
          ok: false,
          error: "Complete backend setup before installing the proxy.",
        };
      proxyStatus = await installLocalProxy({
        clientApiUrl: apiUrl,
        token,
        agents: payload?.agents ?? [],
        corporateProxy: payload?.corporateProxy,
      });
      window?.webContents.send("openleash:update", { proxyStatus });
      return { ok: true, ...proxyStatus };
    } catch (error) {
      proxyStatus = await localProxyStatus();
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not install the local proxy.",
        ...proxyStatus,
      };
    }
  },
);
ipcMain.handle("openleash:uninstall-proxy", async () => {
  try {
    proxyStatus = await uninstallLocalProxy();
    window?.webContents.send("openleash:update", { proxyStatus });
    return { ok: true, ...proxyStatus };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not uninstall the local proxy.",
    };
  }
});
ipcMain.handle(
  "openleash:set-agent-proxy",
  async (_event, payload: { kind?: string; enabled?: boolean }) => {
    try {
      configureAgentProxy(
        String(payload?.kind ?? ""),
        payload?.enabled === true,
      );
      proxyStatus = await localProxyStatus();
      window?.webContents.send("openleash:update", { proxyStatus });
      return { ok: true, ...proxyStatus };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not configure this agent.",
      };
    }
  },
);
ipcMain.handle("openleash:open-local-config", async () => {
  const configPath = localRulesConfigPath();
  ensureLocalRulesConfig();
  await shell.openPath(configPath);
  return { ok: true, path: configPath };
});
ipcMain.handle(
  "openleash:setup",
  async (
    _event,
    payload: {
      agents?: string[];
      policies?: Array<{
        id: string;
        name?: string;
        category?: string;
        description?: string;
        enabled: boolean;
        locked?: boolean;
        natural_language_rule?: string;
      }>;
      apiProvider?: "openai" | "anthropic";
      apiKey?: string;
      audience?: "individual" | "organization";
      clientMode?: "personal" | "cloud" | "custom";
      remoteApiUrl?: string;
      remoteToken?: string;
      remoteOrganization?: string;
      remoteUser?: string;
      skipDashboardOpen?: boolean;
    },
  ) => {
    const clientMode = payload.clientMode === "custom" ? "custom" : "cloud";
    const audience =
      payload.audience === "organization" ? "organization" : "individual";
    const apiKey = String(payload.apiKey ?? "").trim();
    let remoteToken = payload.remoteToken || desktopAuthSession?.token;
    const remoteApiUrl = normalizeRemoteApiUrl(
      payload.remoteApiUrl || desktopAuthSession?.apiUrl || cloudApiUrl,
    );
    if (
      !remoteToken &&
      clientMode === "custom" &&
      isLocalApiUrl(remoteApiUrl)
    ) {
      remoteToken = localServer.token;
    }
    if (!remoteToken)
      return { ok: false, error: "Sign in before installing OpenLeash." };
  // Guard invariant: clientMode === "cloud" && audience === "organization"; solo users never open the dashboard.
  if (
    clientMode === "cloud" &&
      audience === "organization" &&
      isPersonalEmailDomain(payload.remoteUser || desktopAuthSession?.userEmail)
    ) {
      return {
        ok: false,
        error:
          "Use your company Google Workspace or Microsoft 365 account, not a personal email address.",
      };
    }
    let enrolledRemoteUser =
      payload.remoteUser ||
      desktopAuthSession?.userName ||
      desktopAuthSession?.userEmail;
    if (desktopAuthSession?.token && remoteToken === desktopAuthSession.token) {
      await refreshLocalProtections(true);
      const enrollment = await enrollDesktopEndpoint(
        remoteApiUrl,
        desktopAuthSession.token,
        payload.agents ?? [],
      );
      if (!enrollment.ok) return { ok: false, error: enrollment.error };
      remoteToken = enrollment.token;
      enrolledRemoteUser =
        enrollment.user?.display_name ||
        enrollment.user?.email ||
        enrolledRemoteUser;
    }
    const basePolicies = Array.isArray(payload.policies)
      ? normalizePolicies(payload.policies, localServer.policies, true)
      : localServer.policies;
    const policies = basePolicies.map((policy) => ({
      ...policy,
      enabled: policy.locked
        ? true
        : (payload.policies?.some(
            (item) => item.id === policy.id && item.enabled,
          ) ?? policy.enabled),
    }));
    localServer.completeSetup(policies, {
      clientMode,
      apiProvider: payload.apiProvider === "anthropic" ? "anthropic" : "openai",
      apiKey,
      remoteApiUrl,
      remoteToken,
      remoteOrganization:
        payload.remoteOrganization ||
        desktopAuthSession?.organizationName ||
        desktopAuthSession?.organizationSlug,
      remoteUser: enrolledRemoteUser,
    });
    await configureLocalAgent();
    await installLeashCli();
    const selectedAgents = payload.agents ?? [];
    for (const agentKind of selectedAgents) {
      await installAgentProtection(agentKind, hookInstallContext());
      enforcedAgentKinds.add(agentKind);
    }
    let proxyInstallError: string | undefined;
    try {
      proxyStatus = await installProxyForMonitoredAgents(selectedAgents);
    } catch (error) {
      proxyInstallError = `Agent hooks are active, but the full-conversation proxy needs attention: ${error instanceof Error ? error.message : "unknown error"}`;
      proxyStatus = await localProxyStatus();
    }
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true,
      name: APP_DISPLAY_NAME,
    });
    let desktopMessage: string | undefined = proxyInstallError;
    if (
      clientMode === "cloud" &&
      audience === "organization" &&
      !payload.skipDashboardOpen
    ) {
      const dashboardUrl = new URL(
        cloudDashboardUrl.replace(/\/$/, "") || "http://localhost:9300",
      );
      dashboardUrl.pathname = "/onboarding";
      await openTrustedExternalUrl(dashboardUrl.toString());
      desktopMessage = [
        "Complete the onboarding of your org in the browser.",
        proxyInstallError,
      ]
        .filter(Boolean)
        .join(" ");
    }
    await refreshLocalProtections(true);
    startProtectionIntegrityGuard();
    if (localServer.remoteApiUrl && localServer.effectiveToken) {
      latestPlugins = await fetchRemotePluginCatalog(
        localServer.remoteApiUrl,
        localServer.effectiveToken,
        latestPlugins,
      );
    }
    refreshMenu();
    const setupState = {
      apiUrl,
      cloudApiUrl,
      mode: "settings",
      setupComplete: true,
      introSeen: localServer.introSeen,
      clientMode,
      remoteApiUrl: localServer.remoteApiUrl,
      remoteOrganization: localServer.remoteOrganization,
      remoteUser: localServer.remoteUser,
      apiProvider: payload.apiProvider === "anthropic" ? "anthropic" : "openai",
      apiKeySet: localServer.apiKeySet,
      agentDoneSound: localServer.agentDoneSound,
      promptTransforms: localServer.promptTransforms,
      plugins: latestPlugins,
      outcomes: latestOutcomes,
      viewModel: latestViewModel,
      pending: latestPending,
      agents: latestAgents,
      sessionMetrics: latestSessionMetrics,
      localProtections,
      proxyStatus,
      policies: localServer.policies,
      history: localServer.history,
      mcpServers: localServer.mcpServers,
      skills: localServer.skills,
      desktopMessage,
    };
    window?.webContents.send("openleash:update", setupState);
    showDecisionNotice({
      kind: "sample",
      agentName: "Claude Code",
      summary:
        "This is what an OpenLeash approval looks like. When an agent tries something sensitive, you can allow it once or deny it.",
      policy: "Credential files access",
      project: "Example project",
    });
    return { ok: true, ...setupState };
  },
);

ipcMain.handle(
  "openleash:uninstall-agent-protection",
  async (_event, kind: string) => {
    await unprotectAgentKind(kind);
    refreshMenu();
    window?.webContents.send("openleash:update", {
      apiUrl,
      pending: latestPending,
      agents: latestAgents,
      sessionMetrics: latestSessionMetrics,
      plugins: latestPlugins,
      outcomes: latestOutcomes,
      viewModel: latestViewModel,
      history: localServer.history,
      mcpServers: localServer.mcpServers,
      skills: localServer.skills,
      localProtections,
      proxyStatus,
    });
    return { ok: true };
  },
);

ipcMain.handle(
  "openleash:set-agent-monitoring",
  async (_event, payload: { kind?: string; monitored?: boolean }) => {
    const kind = String(payload?.kind ?? "")
      .trim()
      .toLowerCase();
    if (!kind) return { ok: false, error: "Agent kind is required." };
    const monitored = Boolean(payload?.monitored);
    const remoteApiUrl = localServer.remoteApiUrl;
    const token = localServer.effectiveToken;
    if (remoteApiUrl && token) {
      const saved = await saveRemoteAgentMonitoring(
        remoteApiUrl,
        token,
        kind,
        monitored,
      );
      if (!saved.ok) return saved;
    }
    if (monitored) {
      await protectAgentKind(kind);
    } else {
      await unprotectAgentKind(kind);
    }
    proxyStatus = await localProxyStatus();
    refreshMenu();
    window?.webContents.send("openleash:update", {
      apiUrl,
      pending: latestPending,
      agents: latestAgents,
      sessionMetrics: latestSessionMetrics,
      plugins: latestPlugins,
      outcomes: latestOutcomes,
      viewModel: latestViewModel,
      history: localServer.history,
      mcpServers: localServer.mcpServers,
      skills: localServer.skills,
      localProtections,
      proxyStatus,
    });
    return { ok: true, localProtections, proxyStatus };
  },
);

ipcMain.handle(
  "openleash:save-settings",
  (
    _event,
    payload: {
      apiProvider?: "openai" | "anthropic";
      apiKey?: string;
      agentDoneSound?: boolean;
    },
  ) => {
    localServer.updateSettings(
      "openai",
      undefined,
      typeof payload.agentDoneSound === "boolean"
        ? payload.agentDoneSound
        : undefined,
    );
    return {
      ok: true,
      apiProvider: "openai",
      apiKeySet: false,
      agentDoneSound: localServer.agentDoneSound,
    };
  },
);
ipcMain.handle(
  "openleash:save-prompt-transforms",
  (_event, payload: { config?: unknown }) => {
    const config = localServer.updatePromptTransforms(
      payload.config ?? payload,
    );
    return { ok: true, config };
  },
);
ipcMain.handle("openleash:delete-data", async () => {
  const options: MessageBoxOptions = {
    type: "warning",
    buttons: ["Delete data and restart", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: "Delete local data?",
    message: "Delete OpenLeash local activity data?",
    detail:
      "This clears local history, approvals, and recorded agent activity on this Mac. Your setup, rules, and API key stay in place.",
  };
  const choice = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options);
  if (choice.response !== 0) return { ok: false, canceled: true };
  localServer.clearData();
  relaunchOpenLeash();
  return { ok: true, restarting: true };
});
ipcMain.handle("openleash:delete-settings", async () => {
  const options: MessageBoxOptions = {
    type: "warning",
    buttons: ["Delete settings and restart", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: "Delete OpenLeash settings?",
    message: "Delete OpenLeash settings?",
    detail:
      "This clears setup, selected agents, rules, provider choice, and saved API key on this Mac. OpenLeash will restart into the setup wizard.",
  };
  const choice = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options);
  if (choice.response !== 0) return { ok: false, canceled: true };
  await removeDesktopMonitoring();
  localServer.clearSettings();
  relaunchOpenLeash();
  return { ok: true, restarting: true };
});
ipcMain.handle("openleash:delete-data-and-settings", async () => {
  const options: MessageBoxOptions = {
    type: "warning",
    buttons: ["Delete data and settings", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    title: "Delete OpenLeash data and settings?",
    message: "Delete OpenLeash data and settings?",
    detail:
      "This clears local history, approvals, recorded agent activity, setup, selected agents, rules, provider choice, and saved API key on this Mac. OpenLeash will restart into the setup wizard.",
  };
  const choice = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options);
  if (choice.response !== 0) return { ok: false, canceled: true };
  await removeDesktopMonitoring();
  localServer.clearData();
  localServer.clearSettings();
  relaunchOpenLeash();
  return { ok: true, restarting: true };
});
ipcMain.handle("openleash:copy-text", (_event, text: string) => {
  clipboard.writeText(String(text ?? ""));
  return { ok: true };
});
ipcMain.handle(
  "openleash:save-policies",
  (_event, policies: Array<{ id: string; enabled: boolean }>) => {
    localServer.updatePolicies(
      localServer.policies.map((policy) => ({
        ...policy,
        enabled: policy.locked
          ? true
          : policies.some((item) => item.id === policy.id && item.enabled),
      })),
    );
    return { ok: true, policies: localServer.policies };
  },
);
ipcMain.handle(
  "openleash:import-rules",
  async (
    _event,
    payload: { replace?: boolean; save?: boolean; currentRules?: Policy[] },
  ) => {
    const options: OpenDialogOptions = {
      title: "Import OpenLeash rules",
      buttonLabel: "Import rules",
      properties: ["openFile"],
      filters: [
        {
          name: "Rules files",
          extensions: ["json", "md", "markdown", "txt", "rules"],
        },
        { name: "All files", extensions: ["*"] },
      ],
    };
    const selected = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (selected.canceled || !selected.filePaths[0])
      return { ok: false, canceled: true };
    try {
      const filePath = selected.filePaths[0];
      const content = fs.readFileSync(filePath, "utf8");
      const imported = parseRulesImport(content, filePath);
      const base = Array.isArray(payload.currentRules)
        ? payload.currentRules
        : localServer.policies;
      const policies = normalizePolicies(
        imported,
        base,
        Boolean(payload.replace),
      );
      if (payload.save) localServer.updatePolicies(policies);
      return { ok: true, policies, count: policies.length, path: filePath };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error ? error.message : "Could not import rules.",
      };
    }
  },
);
ipcMain.handle("openleash:import-rule-list-json", async () => {
  const options: OpenDialogOptions = {
    title: "Import JSON rules",
    buttonLabel: "Import JSON",
    properties: ["openFile"],
    filters: [
      { name: "JSON rules", extensions: ["json"] },
      { name: "All files", extensions: ["*"] },
    ],
  };
  const selected = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  if (selected.canceled || !selected.filePaths[0])
    return { ok: false, canceled: true };
  try {
    const filePath = selected.filePaths[0];
    const content = fs.readFileSync(filePath, "utf8");
    const rules = parsePluginRulesJsonImport(content);
    return { ok: true, rules, count: rules.length, path: filePath };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Could not import JSON rules.",
    };
  }
});
ipcMain.handle("openleash:discover-instruction-rules", async () => {
  try {
    const sources = discoverAgentInstructionFiles();
    const importedRules = [];
    const candidates = [];
    for (const source of sources) {
      try {
        const content = fs.readFileSync(source.path, "utf8");
        const parsed = parseRulesImport(content, source.path);
        const rules = Array.isArray((parsed as { rules?: unknown[] }).rules)
          ? (parsed as { rules: unknown[] }).rules
          : [];
        for (const rule of rules) {
          if (!rule || typeof rule !== "object") continue;
          importedRules.push({
            ...(rule as Record<string, unknown>),
            category: `${source.agent} instructions`,
            source: source.path,
          });
          const record = rule as Record<string, unknown>;
          const text = String(
            record.description ??
              record.natural_language_rule ??
              record.name ??
              "",
          ).trim();
          if (text) {
            candidates.push({
              text,
              action: "ask",
              agent: source.agent,
              label: source.label,
              path: source.path,
              scope: source.scope,
            });
          }
        }
      } catch (error) {
        startupLog(
          `instruction discovery skipped ${source.path}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const policies = normalizePolicies({ rules: importedRules }, [], true);
    return { ok: true, policies, candidates, sources, count: policies.length };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Could not scan agent instruction files.",
    };
  }
});
ipcMain.handle(
  "openleash:resolve",
  async (
    _event,
    id: string,
    resolution: "allow" | "deny",
    resolutionGuidance?: string,
    rememberForMs?: number,
  ) => {
    const pending = latestPending.find((item) => item.id === id);
    if (pending && Number(rememberForMs) > 0) {
      rememberedApprovalChoices.set(rememberedDecisionKey(pending), {
        resolution,
        expiresAt: Date.now() + Math.min(Number(rememberForMs), 5 * 60_000),
      });
    }
    const noticeKey = pending ? decisionNoticeKey(pending) : activeNoticeKey;
    if (noticeKey) suppressedNoticeKeys.add(noticeKey);
    const idsToResolve = pending
      ? latestPending
          .filter(
            (item) => pendingNoticeKey(item) === pendingNoticeKey(pending),
          )
          .map((item) => item.id)
      : [id];
    for (const decisionId of idsToResolve) resolvingDecisionIds.add(decisionId);
    for (const decisionId of idsToResolve) {
      if (!localServer.resolve(decisionId, resolution, resolutionGuidance)) {
        startupLog(`approval resolve missing local decision ${decisionId}`);
      }
    }
    closeNoticeWithoutOpeningMainWindow();
    latestPending = latestPending.filter(
      (item) => !idsToResolve.includes(item.id),
    );
    refreshMenu();
    window?.webContents.send("openleash:update", {
      apiUrl,
      pending: latestPending,
      agents: latestAgents,
      sessionMetrics: latestSessionMetrics,
      plugins: latestPlugins,
      outcomes: latestOutcomes,
      viewModel: latestViewModel,
      history: localServer.history,
      mcpServers: localServer.mcpServers,
      skills: localServer.skills,
    });
    void Promise.all(
      idsToResolve.map((decisionId) =>
        syncRemoteDecision(decisionId, resolution, resolutionGuidance),
      ),
    )
      .catch((error) => {
        startupLog(
          `remote approval resolve failed: ${error instanceof Error ? error.stack || error.message : String(error)}`,
        );
      })
      .finally(() => {
        for (const decisionId of idsToResolve)
          resolvingDecisionIds.delete(decisionId);
      });
    setTimeout(() => {
      if (noticeKey) suppressedNoticeKeys.delete(noticeKey);
    }, 5 * 60_000);
    return { ok: true };
  },
);
ipcMain.handle("openleash:dismiss-notice", () => {
  closeNoticeWithoutOpeningMainWindow();
});

async function poll() {
  try {
    await refreshLocalProtections();
    syncSkillWatchers();
    const body = await fetchTrayState();
    if (!body) return setDisconnected();
    applyRememberedApprovalChoices(body.pending);
    latestPending = body.pending.filter(
      (item) =>
        !resolvingDecisionIds.has(item.id) &&
        !suppressedNoticeKeys.has(decisionNoticeKey(item)),
    );
    latestAgents = body.agents;
    latestSessionMetrics = body.sessionMetrics ?? {};
    latestPlugins = body.plugins;
    localServer.syncPlugins(latestPlugins);
    const nextPluginContainerFingerprint = pluginFingerprint(latestPlugins);
    if (nextPluginContainerFingerprint !== pluginContainerFingerprint) {
      const statuses = await reconcilePluginContainers(latestPlugins);
      localServer.syncPluginRuntimeStatuses(statuses);
      const failed = statuses.filter((status) => !status.healthy);
      if (failed.length > 0) {
        startupLog(`plugin containers unhealthy: ${failed.map((status) => `${status.pluginId}: ${status.error}`).join(", ")}`);
      }
      pluginContainerFingerprint = nextPluginContainerFingerprint;
    }
    latestOutcomes = body.outcomes ?? [];
    latestViewModel = body.viewModel ?? latestViewModel;
    setTrayStatus(latestPending.length > 0 ? "pending" : "ok");
    refreshMenu();
    window?.webContents.send("openleash:update", {
      apiUrl,
      cloudApiUrl,
      mode: localServer.setupComplete ? "settings" : "setup",
      setupComplete: localServer.setupComplete,
      introSeen: localServer.introSeen,
      clientMode: localServer.clientMode,
      remoteApiUrl: localServer.remoteApiUrl,
      remoteOrganization: localServer.remoteOrganization,
      remoteUser: localServer.remoteUser,
      apiProvider: localServer.apiProvider ?? "openai",
      apiKeySet: localServer.apiKeySet,
      agentDoneSound: localServer.agentDoneSound,
      plugins: latestPlugins,
      outcomes: latestOutcomes,
      viewModel: latestViewModel,
      pending: latestPending,
      agents: latestAgents,
      sessionMetrics: latestSessionMetrics,
      localProtections,
      policies: localServer.policies,
      history: latestRemoteHistory.length
        ? latestRemoteHistory
        : localServer.history,
      mcpServers: localServer.mcpServers,
      skills: localServer.skills,
    });
    const nextPending = latestPending[0];
    if (nextPending) {
      const key = decisionNoticeKey(nextPending);
      if (
        !suppressedNoticeKeys.has(key) &&
        (activeNoticeKey !== key || !noticeWindow || !noticeWindow.isVisible())
      ) {
        showDecisionNotice({ kind: "ask", pending: nextPending });
      }
    } else if (activeNoticeKey?.startsWith("ask:")) {
      noticeWindow?.close();
      noticeWindow = undefined;
      activeNoticeKey = undefined;
    }
  } catch {
    await refreshLocalProtections();
    setDisconnected();
  }
}

function refreshPendingApprovalsSoon() {
  for (const delayMs of [
    100, 250, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000, 7000, 10000, 15000,
    20000, 30000,
  ]) {
    setTimeout(() => {
      void poll();
    }, delayMs);
  }
}

async function fetchTrayState(): Promise<
  | {
      pending: PendingDecision[];
      agents: AgentStatus[];
      sessionMetrics?: SessionMetrics;
      plugins: PluginCatalogItem[];
      outcomes?: PluginOutcome[];
      viewModel?: OpenLeashClientViewModel;
    }
  | undefined
> {
  const localState = await fetchLocalTrayState();

  const remoteApiUrl = localServer.remoteApiUrl;
  const remoteToken = localServer.effectiveToken;
  if (!remoteApiUrl || !remoteToken) return localState;

  try {
    const notifications = await fetchRemoteNotifications(
      remoteApiUrl,
      remoteToken,
    );
    if (notifications?.pending.length) {
      return mergeTrayState(
        localState,
        notifications,
        localState?.plugins ?? latestPlugins,
        latestOutcomes,
      );
    }

    const [stateResponse, plugins, outcomes] = await Promise.all([
      fetch(new URL("/v1/mobile/state", remoteApiUrl), {
        headers: {
          authorization: `Bearer ${remoteToken}`,
          ...apiVersionHeaders("mobileState"),
        },
      }),
      fetchRemotePluginCatalog(
        remoteApiUrl,
        remoteToken,
        localState?.plugins ?? [],
      ),
      fetchRemotePluginOutcomes(remoteApiUrl, remoteToken),
    ]);
    if (!stateResponse.ok)
      return localState ? { ...localState, plugins, outcomes } : undefined;
    return mergeTrayState(
      localState,
      mapRemoteMobileState((await stateResponse.json()) as RemoteMobileState),
      plugins,
      outcomes,
    );
  } catch {
    return localState;
  }
}

async function fetchLocalTrayState() {
  const response = await fetch(`${apiUrl}/admin/tray-status`, {
    headers: apiVersionHeaders("tenantTrayStatus"),
  });
  if (!response.ok) return undefined;
  const body = (await response.json()) as {
    pending: PendingDecision[];
    agents: AgentStatus[];
    session_metrics?: SessionMetrics;
    sessionMetrics?: SessionMetrics;
  };
  return {
    pending: body.pending,
    agents: body.agents,
    sessionMetrics: body.session_metrics ?? body.sessionMetrics,
    plugins: localServer.plugins,
    outcomes: latestOutcomes,
    viewModel: latestViewModel,
  };
}

async function fetchRemoteNotifications(
  remoteApiUrl: string,
  remoteToken: string,
): Promise<
  | {
      pending: PendingDecision[];
      agents: AgentStatus[];
      sessionMetrics?: SessionMetrics;
    }
  | undefined
> {
  try {
    const response = await fetch(
      new URL("/v1/client/notifications", remoteApiUrl),
      {
        headers: {
          authorization: `Bearer ${remoteToken}`,
          ...apiVersionHeaders("clientNotifications"),
        },
      },
    );
    if (!response.ok) return undefined;
    const body = (await response.json()) as RemoteMobileState;
    latestRemoteHistory = Array.isArray(body.recentActivity)
      ? body.recentActivity
      : latestRemoteHistory;
    return mapRemoteMobileState(body);
  } catch {
    return undefined;
  }
}

async function fetchRemotePluginCatalog(
  remoteApiUrl: string,
  remoteToken: string,
  fallback: PluginCatalogItem[],
) {
  try {
    const response = await fetch(new URL("/v1/plugins", remoteApiUrl), {
      headers: {
        authorization: `Bearer ${remoteToken}`,
        ...apiVersionHeaders("tenantPluginsRead"),
      },
    });
    if (!response.ok) return fallback;
    const body = (await response.json()) as { plugins?: PluginCatalogItem[] };
    const plugins = Array.isArray(body.plugins) ? body.plugins : fallback;
    if (isLocalApiUrl(remoteApiUrl))
      return await mergePublicCloudPluginCatalog(plugins);
    return plugins;
  } catch {
    return fallback;
  }
}

async function mergePublicCloudPluginCatalog(plugins: PluginCatalogItem[]) {
  try {
    const response = await fetch(
      new URL("/public/plugins", publicPluginCatalogApiUrl),
      {
        headers: apiVersionHeaders("tenantPluginsRead"),
      },
    );
    if (!response.ok) return plugins;
    const body = (await response.json()) as {
      listings?: PublicPluginListing[];
    };
    if (!Array.isArray(body.listings)) return plugins;
    const listings = new Map<string, PublicPluginListing>();
    for (const listing of body.listings) {
      const id = optionalText(listing.id);
      if (id) listings.set(id, listing);
    }
    const merged = plugins.map((plugin) => {
      const listing = listings.get(plugin.id);
      if (!listing) return plugin;
      const version = optionalText(listing.version);
      return {
        ...plugin,
        slug: plugin.slug ?? optionalText(listing.slug),
        repositoryUrl:
          plugin.repositoryUrl ?? optionalText(listing.repositoryUrl),
        marketplace: listing,
        settings: {
          ...plugin.settings,
          availableVersion: version ?? plugin.settings?.availableVersion,
          updateAvailable: Boolean(
            plugin.settings?.enabled &&
            plugin.settings?.installedVersion &&
            version &&
            plugin.settings.installedVersion !== version,
          ),
        },
      } as PluginCatalogItem;
    });
    const existingIds = new Set(merged.map((plugin) => plugin.id));
    for (const listing of listings.values()) {
      const item = publicListingToPluginCatalogItem(listing);
      if (!item || existingIds.has(item.id)) continue;
      existingIds.add(item.id);
      merged.push(item);
    }
    return merged;
  } catch {
    return plugins;
  }
}

function publicListingToPluginCatalogItem(
  listing: PublicPluginListing,
): PluginCatalogItem | undefined {
  const id = optionalText(listing.id);
  const name = optionalText(listing.name) || optionalText(listing.slug) || id;
  const description =
    optionalText(listing.description) ||
    optionalText(listing.shortDescription) ||
    "OpenLeash plugin.";
  const version = optionalText(listing.version) || "0.0.0";
  const publisher = optionalText(listing.publisher) || "openleash";
  const runtime = optionalText(listing.runtime) || "openleash-core";
  const entrypoint = optionalText(listing.entrypoint) || "";
  if (!id || !name || !entrypoint) return undefined;
  return {
    id,
    slug: optionalText(listing.slug),
    name,
    description,
    repositoryUrl: optionalText(listing.repositoryUrl),
    version,
    publisher,
    runtime,
    entrypoint,
    events: Array.isArray(listing.events)
      ? (listing.events as PluginCatalogItem["events"])
      : [],
    permissions: Array.isArray(listing.permissions)
      ? (listing.permissions as PluginCatalogItem["permissions"])
      : [],
    effects: Array.isArray(listing.effects)
      ? (listing.effects as PluginCatalogItem["effects"])
      : [],
    ordering:
      typeof listing.ordering === "object" && listing.ordering
        ? (listing.ordering as PluginCatalogItem["ordering"])
        : undefined,
    configSchema:
      typeof listing.configSchema === "object" && listing.configSchema
        ? (listing.configSchema as PluginCatalogItem["configSchema"])
        : undefined,
    defaultConfig:
      typeof listing.defaultConfig === "object" && listing.defaultConfig
        ? (listing.defaultConfig as Record<string, unknown>)
        : {},
    tags: Array.isArray(listing.tags) ? (listing.tags as string[]) : [],
    marketplace: listing,
    settings: {
      enabled: false,
      config:
        typeof listing.defaultConfig === "object" && listing.defaultConfig
          ? (listing.defaultConfig as Record<string, unknown>)
          : {},
      orderingPriority:
        typeof listing.ordering?.priority === "number"
          ? listing.ordering.priority
          : null,
      availableVersion: version,
      updatePolicy: "manual",
    },
    organizationPolicy: {
      mandatory: false,
      defaultEnabled: false,
      userInstallAllowed: true,
      configLocked: false,
    },
  } as PluginCatalogItem;
}

async function readLocalPluginFolderListing(
  folderPath: string,
): Promise<PublicPluginListing> {
  const stat = fs.statSync(folderPath);
  if (!stat.isDirectory()) throw new Error("Choose a plugin folder.");
  const manifest = readLocalPluginManifestJson(folderPath);
  if (!manifest) {
    throw new Error(
      "No OpenLeash plugin manifest found. Add openleash.plugin.json, plugin.json, manifest.json, or package.json with an openleash/openleashPlugin field.",
    );
  }
  const id = optionalText(manifest.id);
  const name = optionalText(manifest.name) || optionalText(manifest.slug) || id;
  const description =
    optionalText(manifest.description) ||
    optionalText(manifest.shortDescription);
  const version = optionalText(manifest.version);
  const runtime = optionalText(manifest.runtime);
  const entrypoint = optionalText(manifest.entrypoint);
  if (!id || !name || !description || !version || !runtime || !entrypoint) {
    throw new Error(
      "Plugin manifest must include id, name, description, version, runtime, and entrypoint.",
    );
  }
  const slug = slugifyLocalPlugin(optionalText(manifest.slug) || name || id);
  const publisher = optionalText(manifest.publisher) || "local";
  const shortDescription =
    optionalText(manifest.shortDescription) || description;
  return {
    ...manifest,
    id,
    slug,
    name,
    description,
    version,
    publisher,
    runtime,
    entrypoint,
    source: "private",
    reviewStatus: "approved",
    developerName:
      optionalText(manifest.developerName) ||
      (publisher === "openleash" ? "OpenLeash" : "Local"),
    shortDescription,
    longDescription: optionalText(manifest.longDescription) || description,
    heroTagline: optionalText(manifest.heroTagline) || shortDescription,
    packageUrl: optionalText(manifest.packageUrl) || `file:${folderPath}`,
    repositoryUrl: optionalText(manifest.repositoryUrl),
    documentationUrl: optionalText(manifest.documentationUrl),
    iconText:
      optionalText(manifest.iconText) || slug.slice(0, 2).toUpperCase() || "OL",
    visualPng: optionalText(manifest.visualPng),
    events: Array.isArray(manifest.events) ? manifest.events : [],
    permissions: Array.isArray(manifest.permissions)
      ? manifest.permissions
      : [],
    effects: Array.isArray(manifest.effects) ? manifest.effects : [],
    ordering:
      typeof manifest.ordering === "object" && manifest.ordering
        ? (manifest.ordering as Record<string, unknown>)
        : undefined,
    configSchema:
      typeof manifest.configSchema === "object" && manifest.configSchema
        ? (manifest.configSchema as Record<string, unknown>)
        : undefined,
    defaultConfig:
      typeof manifest.defaultConfig === "object" && manifest.defaultConfig
        ? (manifest.defaultConfig as Record<string, unknown>)
        : {},
    tags: Array.isArray(manifest.tags) ? manifest.tags : [],
    seoTitle: optionalText(manifest.seoTitle) || `${slug} Plugin for OpenLeash`,
    seoDescription:
      optionalText(manifest.seoDescription) ||
      `Install ${slug} for OpenLeash. ${shortDescription}`,
  };
}

function readLocalPluginManifestJson(
  folderPath: string,
): Record<string, unknown> | undefined {
  for (const name of [
    "openleash.plugin.json",
    "plugin.json",
    "manifest.json",
  ]) {
    const filePath = path.join(folderPath, name);
    if (!fs.existsSync(filePath)) continue;
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<
      string,
      unknown
    >;
  }
  const packagePath = path.join(folderPath, "package.json");
  if (!fs.existsSync(packagePath)) return undefined;
  const packageJson = JSON.parse(
    fs.readFileSync(packagePath, "utf8"),
  ) as Record<string, unknown>;
  const embedded = packageJson.openleashPlugin ?? packageJson.openleash;
  if (embedded && typeof embedded === "object") {
    return {
      ...(embedded as Record<string, unknown>),
      name:
        optionalText((embedded as Record<string, unknown>).name) ||
        optionalText(packageJson.name),
      version:
        optionalText((embedded as Record<string, unknown>).version) ||
        optionalText(packageJson.version),
    };
  }
  return undefined;
}

function slugifyLocalPlugin(value: string) {
  return value
    .toLowerCase()
    .replace(/^@[^/]+\//, "")
    .replace(/^plugin-/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function optionalText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || undefined;
}

async function fetchRemotePluginOutcomes(
  remoteApiUrl: string,
  remoteToken: string,
) {
  try {
    const url = new URL("/v1/outcomes", remoteApiUrl);
    url.searchParams.set("limit", "80");
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${remoteToken}`,
        ...apiVersionHeaders("authAccountOutcomes"),
      },
    });
    if (!response.ok) return latestOutcomes;
    const body = (await response.json()) as {
      outcomes?: PluginOutcome[];
      viewModel?: OpenLeashClientViewModel;
    };
    latestViewModel = body.viewModel ?? latestViewModel;
    return Array.isArray(body.outcomes) ? body.outcomes : latestOutcomes;
  } catch {
    return latestOutcomes;
  }
}

function mergeTrayState(
  localState:
    | {
        pending: PendingDecision[];
        agents: AgentStatus[];
        sessionMetrics?: SessionMetrics;
        plugins: PluginCatalogItem[];
        outcomes?: PluginOutcome[];
        viewModel?: OpenLeashClientViewModel;
      }
    | undefined,
  remoteState: {
    pending: PendingDecision[];
    agents: AgentStatus[];
    sessionMetrics?: SessionMetrics;
  },
  plugins: PluginCatalogItem[],
  outcomes: PluginOutcome[] = [],
) {
  if (!localState)
    return { ...remoteState, plugins, outcomes, viewModel: latestViewModel };
  return {
    pending: dedupePending([...localState.pending, ...remoteState.pending]),
    agents: dedupeById([...localState.agents, ...remoteState.agents]),
    sessionMetrics: remoteState.sessionMetrics ?? localState.sessionMetrics,
    plugins,
    outcomes,
    viewModel: latestViewModel ?? localState.viewModel,
  };
}

function dedupeById<T extends { id: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function dedupePending(items: PendingDecision[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = pendingNoticeKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pendingNoticeKey(item: PendingDecision) {
  return (
    canonicalIntentKey(rawIntentKey(item.payload)) ??
    credentialPendingKey(item) ??
    [
      item.agent_kind,
      item.project_path ?? "",
      item.tool_name ?? item.event_name,
      item.summary,
      primaryPendingResource(item),
    ].join("|")
  );
}

function decisionNoticeKey(item: PendingDecision) {
  return `ask:${item.id}`;
}

function rememberedDecisionKey(item: PendingDecision) {
  return `${pendingNoticeKey(item)}|plugin:${noticePluginName(item).toLowerCase()}`;
}

function applyRememberedApprovalChoices(items: PendingDecision[]) {
  const now = Date.now();
  for (const [key, choice] of rememberedApprovalChoices) {
    if (choice.expiresAt <= now) rememberedApprovalChoices.delete(key);
  }
  for (const item of items) {
    if (resolvingDecisionIds.has(item.id)) continue;
    const choice = rememberedApprovalChoices.get(rememberedDecisionKey(item));
    if (!choice || choice.expiresAt <= now) continue;
    resolvingDecisionIds.add(item.id);
    localServer.resolve(item.id, choice.resolution);
    startupLog(
      `remembered approval ${choice.resolution} applied to ${item.id}`,
    );
    void syncRemoteDecision(item.id, choice.resolution).finally(() =>
      resolvingDecisionIds.delete(item.id),
    );
  }
}

function credentialPendingKey(item: PendingDecision) {
  const resource = primaryPendingResource(item);
  if (!resource) return undefined;
  return [
    item.agent_kind,
    item.project_path ?? "",
    "credential",
    resource,
  ].join("|");
}

function rawIntentKey(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const raw = record.raw;
  if (raw && typeof raw === "object") {
    const intentKey = (raw as Record<string, unknown>).openleashIntentKey;
    if (typeof intentKey === "string" && intentKey.trim()) return intentKey;
  }
  const intentKey = record.openleashIntentKey;
  return typeof intentKey === "string" && intentKey.trim()
    ? intentKey
    : undefined;
}

function canonicalIntentKey(intentKey?: string) {
  if (!intentKey) return undefined;
  const parts = intentKey.split("|");
  if (parts.length === 4 && parts[2]?.startsWith("credential-")) {
    return [parts[0], parts[1], "credential", parts[3]].join("|");
  }
  if (parts.length === 5 && parts[3]?.startsWith("credential-")) {
    return [parts[0], parts[2], "credential", parts[4]].join("|");
  }
  return intentKey;
}

function primaryPendingResource(item: PendingDecision) {
  const text = `${item.question ?? ""} ${item.summary ?? ""} ${JSON.stringify(item.payload ?? {})}`;
  if (/\.env(?:\b|["'\\/\s])/.test(text)) return ".env";
  return "";
}

function mapRemoteMobileState(state: RemoteMobileState): {
  pending: PendingDecision[];
  agents: AgentStatus[];
  sessionMetrics?: SessionMetrics;
} {
  return {
    pending: (state.pendingApprovals ?? []).map((item) => ({
      id: item.id,
      question: item.question,
      summary: item.summary ?? item.question ?? "OpenLeash approval needed.",
      agent_name: item.agent_name ?? "AI agent",
      agent_kind: item.agent_kind ?? "unknown",
      hostname: item.hostname ?? "cloud",
      user_name: item.user_name,
      event_name: item.event_name ?? "approval",
      tool_name: item.tool_name,
      project_path: item.project_path,
      payload: item.payload,
      triggered_policies: item.triggered_policies,
      purpose_summary: item.purpose_summary,
      recent_context: item.recent_context,
      plugin_id: item.plugin_id,
      plugin_name: item.plugin_name,
      quote: item.quote,
      created_at: item.created_at ?? new Date().toISOString(),
    })),
    agents: (state.agents ?? []).map((agent) => ({
      id: agent.id,
      kind: agent.kind ?? "unknown",
      display_name: agent.display_name ?? "AI agent",
      hostname: agent.hostname ?? agent.platform ?? "cloud",
      last_seen_at: agent.last_seen_at,
      event_name: agent.event_name,
      tool_name: agent.tool_name,
      project_path: agent.project_path,
      activity_at: agent.activity_at,
      decision: agent.decision,
      resolution: agent.resolution ?? null,
      question: agent.question,
      payload: agent.payload,
      triggered_policies: agent.triggered_policies,
      recent_activity: agent.recent_activity,
      sessions: agent.sessions,
      decision_summary: agent.decision_summary,
      short_summary:
        agent.short_summary ??
        agent.decision_summary ??
        friendlyAction(agent.event_name, agent.tool_name),
    })),
    sessionMetrics: mapRemoteSessionMetrics(state.sessionMetrics),
  };
}

function mapRemoteSessionMetrics(
  metrics: Record<string, unknown> | undefined,
): SessionMetrics | undefined {
  if (!metrics) return undefined;
  const numberValue = (key: string) => {
    const value = metrics[key];
    return typeof value === "number" ? value : Number(value ?? 0);
  };
  return {
    today: {
      session_count: numberValue("today_sessions"),
      duration_seconds: numberValue("today_seconds"),
    },
    last24h: {
      session_count: numberValue("last24h_sessions"),
      duration_seconds: numberValue("last24h_seconds"),
    },
    week: {
      session_count: numberValue("week_sessions"),
      duration_seconds: numberValue("week_seconds"),
    },
    month: {
      session_count: numberValue("month_sessions"),
      duration_seconds: numberValue("month_seconds"),
    },
  };
}

async function syncRemoteDecision(
  id: string,
  resolution: "allow" | "deny",
  resolutionGuidance?: string,
) {
  const guidance =
    resolution === "deny"
      ? cleanResolutionGuidance(resolutionGuidance)
      : undefined;

  const remoteApiUrl = localServer.remoteApiUrl;
  const remoteToken = localServer.effectiveToken;
  if (!remoteApiUrl || !remoteToken) return;
  const response = await fetch(
    new URL(`/v1/mobile/decisions/${id}/resolve`, remoteApiUrl),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${remoteToken}`,
        ...apiVersionHeaders("mobileDecisionResolve"),
      },
      body: JSON.stringify({
        resolution,
        ...(guidance ? { resolutionGuidance: guidance } : {}),
      }),
    },
  );
  if (!response.ok)
    throw new Error(`OpenLeash could not resolve approval ${id}.`);
}

function cleanResolutionGuidance(value?: string) {
  const cleaned = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.slice(0, 500) : undefined;
}

function handleCliRuleImport() {
  const args = process.argv.slice(1);
  const importPath =
    readCliValue(args, "--import-rules") ?? readCliValue(args, "--rules");
  if (!importPath) return undefined;
  try {
    const input = JSON.parse(
      fs.readFileSync(path.resolve(importPath), "utf8"),
    ) as unknown;
    const replace =
      args.includes("--replace-rules") || args.includes("--rules-replace");
    const policies = localServer.importPolicies(input, replace);
    console.log(
      `OpenLeash imported ${policies.length} rule${policies.length === 1 ? "" : "s"} from ${importPath}.`,
    );
    return {
      ok: true,
      exitAfter:
        args.includes("--quit-after-import") || args.includes("--no-ui"),
    };
  } catch (error) {
    console.error(
      `OpenLeash rule import failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return { ok: false, exitAfter: true };
  }
}

async function handleCliUpdate() {
  const args = process.argv.slice(1);
  if (!args.includes("--update") && !args.includes("--check-for-updates"))
    return undefined;
  const autoInstall = args.includes("--yes") || args.includes("--install");
  const exitAfter =
    args.includes("--no-ui") ||
    args.includes("--quit-after-update") ||
    autoInstall;
  const ok = await checkForUpdates({
    source: "cli",
    force: true,
    autoInstall,
    silent: false,
  });
  return { ok, exitAfter };
}

function readCliValue(args: string[], name: string) {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function tenantToApiUrl(tenant: string) {
  const trimmed = tenant.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

async function handleCliEnrollment() {
  const args = process.argv.slice(1);
  if (!args.includes("--enroll")) return undefined;
  const tenant =
    readCliValue(args, "--tenant") ??
    readCliValue(args, "--tenant-url") ??
    readCliValue(args, "--organization");
  const deploymentToken =
    readCliValue(args, "--token") ?? readCliValue(args, "--deployment-token");
  if (!tenant || !deploymentToken) {
    console.error("OpenLeash enrollment requires --tenant and --token.");
    return { ok: false, exitAfter: true };
  }
  const enrollmentApiUrl =
    readCliValue(args, "--api-url") ?? tenantToApiUrl(tenant);
  try {
    const response = await fetch(new URL("/v1/enroll", enrollmentApiUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...apiVersionHeaders("tenantEnroll"),
      },
      body: JSON.stringify({
        deploymentToken,
        email: readCliValue(args, "--email"),
        displayName:
          readCliValue(args, "--display-name") ?? os.userInfo().username,
        hostname: os.hostname(),
        platform: os.platform(),
        osRelease: os.release(),
        mode: readCliValue(args, "--mode") ?? "cloud",
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.token) {
      console.error(
        `OpenLeash enrollment failed: ${body.error ?? response.statusText}`,
      );
      return { ok: false, exitAfter: true };
    }
    localServer.completeSetup(localServer.policies, {
      clientMode:
        body.mode === "enterprise" || body.mode === "private"
          ? "custom"
          : "cloud",
      remoteApiUrl: body.apiUrl ?? enrollmentApiUrl,
      remoteToken: body.token,
      remoteOrganization: body.tenantUrl ?? tenant,
      remoteUser: body.user?.email ?? readCliValue(args, "--email"),
    });
    await configureLocalAgent();
    await installLeashCli();
    const selectedAgents = (readCliValue(args, "--agents") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (args.includes("--install-hooks") || selectedAgents.length > 0) {
      const agents =
        selectedAgents.length > 0 ? selectedAgents : ["claude-code"];
      for (const agent of agents) {
        await installAgentProtection(agent, hookInstallContext());
        enforcedAgentKinds.add(agent);
      }
    }
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: true,
      name: APP_DISPLAY_NAME,
    });
    console.log(
      `OpenLeash Client enrolled ${os.hostname()} with ${body.tenantUrl ?? tenant}.`,
    );
    return {
      ok: true,
      exitAfter:
        args.includes("--no-ui") || args.includes("--quit-after-configure"),
    };
  } catch (error) {
    console.error(
      `OpenLeash enrollment failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    return { ok: false, exitAfter: true };
  }
}

async function handleCliClientConfig() {
  const args = process.argv.slice(1);
  const configuredApiUrl = readCliValue(args, "--api-url");
  const configuredToken =
    readCliValue(args, "--token") ?? readCliValue(args, "--user-token");
  const configuredMode = readCliValue(args, "--mode") ?? "community";
  if (!configuredApiUrl && !configuredToken) return undefined;
  const clientApiUrl = configuredApiUrl ?? cloudApiUrl;
  const token = configuredToken ?? localServer.token;
  const dir = path.join(os.homedir(), ".openleash");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    `${JSON.stringify(
      {
        apiUrl: clientApiUrl,
        token,
        mode: configuredMode,
        clientVersion: app.getVersion(),
        enrolledAt: new Date().toISOString(),
        computer: { hostname: os.hostname() },
      },
      null,
      2,
    )}\n`,
  );
  localServer.completeSetup(localServer.policies, {
    clientMode:
      configuredMode === "cloud"
        ? "cloud"
        : configuredMode === "enterprise" || configuredMode === "custom"
          ? "custom"
          : "custom",
    remoteApiUrl: clientApiUrl,
    remoteToken: token,
    remoteOrganization:
      readCliValue(args, "--organization") ?? readCliValue(args, "--tenant"),
    remoteUser: readCliValue(args, "--user"),
  });
  await installLeashCli();
  const selectedAgents = (readCliValue(args, "--agents") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (args.includes("--install-hooks") || selectedAgents.length > 0) {
    const agents = selectedAgents.length > 0 ? selectedAgents : ["claude-code"];
    for (const agent of agents) {
      await installAgentProtection(agent, hookInstallContext());
      enforcedAgentKinds.add(agent);
    }
  }
  if (args.includes("--uninstall-hooks") || args.includes("--unhook")) {
    const agents =
      selectedAgents.length > 0
        ? selectedAgents
        : ["claude-code", "codex", "nanoclaw", "openclaw"];
    for (const agent of agents) {
      await unprotectAgentKind(agent);
    }
  }
  console.log(`OpenLeash Client configured for ${clientApiUrl}.`);
  return {
    ok: true,
    exitAfter:
      args.includes("--no-ui") || args.includes("--quit-after-configure"),
  };
}

async function migrateLocalDevCloudTarget() {
  if (app.isPackaged || process.env.OPENLEASH_CLOUD_API_URL) return;
  if (localServer.clientMode !== "cloud" && localServer.clientMode !== "custom")
    return;
  const current = localServer.remoteApiUrl ?? "";
  if (current && !/^https:\/\/api\.openleash\.com\/?$/i.test(current)) return;
  if (!(await canReach(new URL("/health", localDevCloudApiUrl).toString())))
    return;

  localServer.updateRemoteApiUrl(localDevCloudApiUrl);
  await configureLocalAgent();

  const protectedAgents = detectLocalAgentProtections({
    appVersion: app.getVersion(),
  }).filter((agent) => agent.protected && agent.supportsInstall);
  for (const agent of protectedAgents) {
    await installAgentProtection(agent.kind, hookInstallContext());
    enforcedAgentKinds.add(agent.kind);
  }
  startupLog(`dev cloud target migrated to ${localDevCloudApiUrl}`);
}

async function maybeOfferUpdate() {
  const state = readUpdateState();
  if (
    state.lastCheckedAt &&
    Date.now() - new Date(state.lastCheckedAt).getTime() < updateCheckIntervalMs
  )
    return;
  await checkForUpdates({ source: "auto", silent: true });
}

async function checkForUpdates(options: {
  source: "auto" | "manual" | "cli";
  force?: boolean;
  autoInstall?: boolean;
  silent?: boolean;
}) {
  try {
    const manifest = await fetchUpdateManifest();
    if (!manifest) {
      if (!options.silent && options.source !== "auto") {
        await dialog.showMessageBox({
          type: "info",
          message: "Automatic updates are disabled",
          detail:
            "This OpenLeash install is configured for manual or private update distribution.",
        });
      }
      return true;
    }
    const state = readUpdateState();
    writeUpdateState({ ...state, lastCheckedAt: new Date().toISOString() });
    if (compareVersions(manifest.version, app.getVersion()) <= 0) {
      if (!options.silent && options.source !== "auto") {
        await dialog.showMessageBox({
          type: "info",
          message: "OpenLeash is up to date",
          detail: `You are running OpenLeash ${app.getVersion()}.`,
        });
      }
      return true;
    }

    if (
      options.source === "auto" &&
      !options.force &&
      wasUpdatePromptedRecently(state, manifest.version)
    ) {
      return true;
    }

    if (options.autoInstall) {
      await installUpdate(manifest);
      return true;
    }

    const buttons = manifest.notesUrl
      ? ["Install update", "Later", "Release notes"]
      : ["Install update", "Later"];
    const updatePrompt = {
      type: "info",
      buttons,
      defaultId: 0,
      cancelId: 1,
      message: `OpenLeash ${manifest.version} is available`,
      detail:
        "A newer personal build is ready. Install it now, or keep working and update later.",
    } as const;
    const response = window
      ? await dialog.showMessageBox(window, updatePrompt)
      : await dialog.showMessageBox(updatePrompt);
    writeUpdateState({
      ...readUpdateState(),
      lastCheckedAt: new Date().toISOString(),
      lastPromptedAt: new Date().toISOString(),
      lastPromptedVersion: manifest.version,
    });
    if (response.response === 2 && manifest.notesUrl) {
      await openTrustedExternalUrl(manifest.notesUrl);
      return true;
    }
    if (response.response !== 0) return true;
    await installUpdate(manifest);
    return true;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Could not check for updates.";
    if (!options.silent && options.source !== "auto") {
      await dialog.showMessageBox({
        type: "warning",
        message: "Could not check for updates",
        detail: message,
      });
    }
    console.error(`OpenLeash update check failed: ${message}`);
    return false;
  }
}

async function fetchUpdateManifest(): Promise<UpdateManifest | undefined> {
  const feedUrl = updateFeedUrl();
  if (!feedUrl) return undefined;
  const response = await fetch(feedUrl, {
    method: shouldUseUpdatePost(feedUrl) ? "POST" : "GET",
    cache: "no-store",
    headers: {
      ...(shouldUseUpdatePost(feedUrl)
        ? { "content-type": "application/json" }
        : {}),
      ...apiVersionHeaders(
        shouldUseUpdatePost(feedUrl)
          ? "clientUpdateCheck"
          : "clientUpdateLatest",
      ),
    },
    body: shouldUseUpdatePost(feedUrl)
      ? JSON.stringify(updateCheckPayload())
      : undefined,
  });
  if (!response.ok) throw new Error(`Update feed returned ${response.status}.`);
  const manifest = (await response.json()) as Partial<UpdateManifest>;
  const version = manifest.latestVersion ?? manifest.version;
  if (!version || typeof version !== "string") {
    throw new Error("Update feed is missing a version.");
  }
  manifest.version = version;
  if (!manifest.dmgUrl && !manifest.downloadUrl) {
    if (compareVersions(version, app.getVersion()) > 0) {
      throw new Error("Update feed is missing a DMG download URL.");
    }
  }
  if (
    compareVersions(version, app.getVersion()) > 0 &&
    !/^[a-f0-9]{64}$/i.test(manifest.sha256 ?? "")
  ) {
    throw new Error("Update feed is missing a valid SHA-256 checksum.");
  }
  return manifest as UpdateManifest;
}

function updateFeedUrl() {
  const args = process.argv.slice(1);
  const mode =
    readCliValue(args, "--update-mode") ?? process.env.OPENLEASH_UPDATE_MODE;
  if (mode === "manual" || mode === "disabled" || mode === "private-manual")
    return undefined;
  return (
    readCliValue(args, "--update-feed") ??
    process.env.OPENLEASH_UPDATE_FEED_URL ??
    defaultUpdateFeedUrl
  );
}

function shouldUseUpdatePost(feedUrl: string) {
  return !/\.json(?:\?|$)/i.test(feedUrl) && !feedUrl.includes("/latest");
}

function updateCheckPayload() {
  return {
    app: process.env.OPENLEASH_UPDATE_APP ?? "openleash-personal",
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    channel: process.env.OPENLEASH_UPDATE_CHANNEL ?? "stable",
    installMode: process.env.OPENLEASH_INSTALL_MODE ?? "personal",
    updateSource: process.env.OPENLEASH_UPDATE_SOURCE ?? "public",
  };
}

function wasUpdatePromptedRecently(state: UpdateState, version: string) {
  if (state.lastPromptedVersion !== version || !state.lastPromptedAt)
    return false;
  return (
    Date.now() - new Date(state.lastPromptedAt).getTime() <
    updateCheckIntervalMs
  );
}

async function installUpdate(manifest: UpdateManifest) {
  const dmgUrl = manifest.dmgUrl ?? manifest.downloadUrl;
  if (!dmgUrl) throw new Error("Update has no DMG URL.");
  const downloadPath = path.join(
    app.getPath("temp"),
    `OpenLeash-${manifest.version}.dmg`,
  );
  await dialog.showMessageBox({
    type: "info",
    message: "OpenLeash will update now",
    detail:
      "The app will close for a moment while the new version is installed. Your local settings and history will stay in place.",
  });
  await downloadFile(dmgUrl, downloadPath);
  const actualSha256 = crypto
    .createHash("sha256")
    .update(fs.readFileSync(downloadPath))
    .digest("hex");
  if (actualSha256.toLowerCase() !== manifest.sha256?.toLowerCase()) {
    fs.rmSync(downloadPath, { force: true });
    throw new Error("Downloaded update failed SHA-256 verification.");
  }
  const installer = installerScriptPath();
  if (!fs.existsSync(installer)) {
    await openTrustedExternalUrl(dmgUrl);
    throw new Error(
      "Installer helper was not found, so the DMG was opened in your browser instead.",
    );
  }
  const child = spawn(
    "/bin/bash",
    [installer, "--dmg", downloadPath, "--keep-settings", "--quiet"],
    {
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref();
  quitting = true;
  noticeWindow?.destroy();
  window?.destroy();
  tray?.destroy();
  setTimeout(() => app.quit(), 250);
}

async function downloadFile(url: string, targetPath: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download returned ${response.status}.`);
  const data = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(targetPath, data);
}

function installerScriptPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "install-openleash-personal.sh")
    : path.resolve(
        here,
        "..",
        "..",
        "..",
        "scripts",
        "install-openleash-personal.sh",
      );
}

function readUpdateState(): UpdateState {
  const file = updateStatePath();
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as UpdateState;
  } catch {
    return {};
  }
}

function writeUpdateState(state: UpdateState) {
  const file = updateStatePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

function updateStatePath() {
  return path.join(app.getPath("userData"), "update-state.json");
}

function compareVersions(left: string, right: string) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (
    let index = 0;
    index < Math.max(leftParts.length, rightParts.length);
    index += 1
  ) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }
  return 0;
}

function versionParts(value: string) {
  return value
    .replace(/^v/i, "")
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .filter((part) => Number.isFinite(part));
}

function setDisconnected() {
  setTrayStatus("down");
  ensureTray("down").setToolTip(`${APP_DISPLAY_NAME} API unavailable`);
  refreshMenu();
}

function ensureTray(status: "ok" | "pending" | "down" = currentTrayStatus) {
  currentTrayStatus = status;
  if (!tray || tray.isDestroyed()) {
    tray = new Tray(createTrayIcon(status));
    tray.on("click", () => {
      if (process.platform !== "darwin") {
        refreshMenu(true);
        return;
      }
      if (traySingleClickTimer) clearTimeout(traySingleClickTimer);
      traySingleClickTimer = setTimeout(() => {
        traySingleClickTimer = undefined;
        refreshMenu(true);
      }, 260);
    });
    tray.on("double-click", () => {
      if (traySingleClickTimer) {
        clearTimeout(traySingleClickTimer);
        traySingleClickTimer = undefined;
      }
      restoreMainWindow();
    });
    tray.on("right-click", () => refreshMenu(true));
  } else {
    tray.setImage(createTrayIcon(status));
  }
  tray.setTitle("");
  tray.setToolTip(trayTooltip(status));
  return tray;
}

function setTrayStatus(status: "ok" | "pending" | "down") {
  ensureTray(status);
}

function trayTooltip(status: "ok" | "pending" | "down") {
  return status === "ok"
    ? `${APP_DISPLAY_NAME} agent defense`
    : status === "pending"
      ? `${latestPending.length} ${APP_DISPLAY_NAME} approval${latestPending.length === 1 ? "" : "s"} waiting`
      : `${APP_DISPLAY_NAME} API unavailable`;
}

function refreshMenu(open = false) {
  const approvalLabel =
    latestPending.length === 0
      ? "No pending approvals"
      : `${latestPending.length} pending approval${latestPending.length === 1 ? "" : "s"}`;
  const agentLabel =
    latestAgents.length === 0
      ? "No active agents"
      : `${latestAgents.length} active agent${latestAgents.length === 1 ? "" : "s"}`;
  const installedAgents = localProtections.filter((agent) => agent.installed);
  const protectedAgents = installedAgents.filter((agent) => agent.protected);
  const protectionLabel =
    installedAgents.length === 0
      ? "No installed agents detected"
      : `${protectedAgents.length}/${installedAgents.length} agents protected`;
  const proxyLabel = proxyStatus.healthy
    ? `Proxy active · ${proxyStatus.configuredAgents.length} agent${proxyStatus.configuredAgents.length === 1 ? "" : "s"}`
    : proxyStatus.running
      ? "Proxy starting"
      : "Proxy off";
  const protectionItems =
    localProtections.length === 0
      ? [{ label: "No agents detected", enabled: false }]
      : localProtections
          .slice()
          .sort(
            (a, b) =>
              Number(b.installed) - Number(a.installed) ||
              a.displayName.localeCompare(b.displayName),
          )
          .map(agentProtectionMenuItem);
  const activeAgentItems =
    latestAgents.length === 0
      ? [{ label: "No active agents", enabled: false }]
      : latestAgents.map((agent) => ({
          label: `${agent.display_name} - ${compactSummary(agent.short_summary)}`,
          sublabel: formatAgentMenuSublabel(agent),
          click: () => showAgentDetail(agent),
        }));
  const pendingItems =
    latestPending.length === 0
      ? [{ label: "No approvals waiting", enabled: false }]
      : latestPending.map((item) => ({
          label: `${item.agent_name} - ${compactSummary(item.question ?? item.summary)}`,
          sublabel: `${item.tool_name ?? item.event_name} · ${timeAgo(item.created_at)}`,
          click: () => showDecisionNotice({ kind: "ask", pending: item }),
        }));

  const menu = Menu.buildFromTemplate([
    { label: "Settings", click: () => showMainWindow("settings") },
    { type: "separator" },
    { label: APP_DISPLAY_NAME, enabled: false },
    { label: `API hooks · ${protectionLabel}`, submenu: protectionItems },
    { label: proxyLabel, click: () => showMainWindow("settings") },
    { type: "separator" },
    { label: agentLabel, submenu: activeAgentItems },
    { label: approvalLabel, submenu: pendingItems },
    { type: "separator" },
    {
      label: "Check for updates",
      click: () => void checkForUpdates({ source: "manual", force: true }),
    },
    { type: "separator" },
    { label: "Quit", click: quitOpenLeash },
  ]);
  const statusItem = ensureTray();
  if (process.platform === "darwin") statusItem.setContextMenu(null);
  else statusItem.setContextMenu(menu);
  if (open) statusItem.popUpContextMenu(menu);
}

function installApplicationMenu() {
  const template: MenuItemConstructorOptions[] =
    process.platform === "darwin"
      ? [
          {
            label: APP_DISPLAY_NAME,
            submenu: [
              { role: "about", label: `About ${APP_DISPLAY_NAME}` },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide", label: `Hide ${APP_DISPLAY_NAME}` },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              {
                label: `Quit ${APP_DISPLAY_NAME}`,
                accelerator: "Command+Q",
                click: quitOpenLeash,
              },
            ],
          },
          {
            label: "File",
            submenu: [
              {
                label: "Settings",
                accelerator: "Command+,",
                click: () => showMainWindow("settings"),
              },
            ],
          },
          {
            label: "Edit",
            submenu: [
              { role: "undo" },
              { role: "redo" },
              { type: "separator" },
              { role: "cut" },
              { role: "copy" },
              { role: "paste" },
              { role: "selectAll" },
            ],
          },
          {
            label: "View",
            submenu: [
              { role: "reload" },
              { role: "toggleDevTools" },
              { type: "separator" },
              { role: "resetZoom" },
              { role: "zoomIn" },
              { role: "zoomOut" },
            ],
          },
          {
            label: "Window",
            submenu: [{ role: "minimize" }, { role: "close" }],
          },
          {
            role: "help",
            submenu: [
              { label: "Settings", click: () => showMainWindow("settings") },
            ],
          },
        ]
      : [
          {
            label: "File",
            submenu: [
              { label: "Settings", click: () => showMainWindow("settings") },
              { type: "separator" },
              { label: "Quit", click: quitOpenLeash },
            ],
          },
          {
            label: "View",
            submenu: [{ role: "reload" }, { role: "toggleDevTools" }],
          },
        ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function refreshLocalProtections(force = false) {
  const now = Date.now();
  if (
    !force &&
    now - localProtectionCheckedAt < 10000 &&
    localProtections.length > 0
  )
    return;
  localProtectionCheckedAt = now;
  localProtections = detectLocalAgentProtections({
    appVersion: app.getVersion(),
  });
  void syncRemoteAgentInventory();
}

async function syncRemoteAgentInventory() {
  const remoteApiUrl = localServer.remoteApiUrl;
  const token = localServer.effectiveToken;
  if (!remoteApiUrl || !token || localProtections.length === 0) return;
  const agents = desktopInventoryAgents();
  try {
    const response = await fetch(new URL("/v1/desktop/agents", remoteApiUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...apiVersionHeaders("desktopEnroll"),
      },
      body: JSON.stringify({
        hostname: os.hostname(),
        platform: os.platform(),
        osRelease: os.release(),
        clientVersion: app.getVersion(),
        agents,
      }),
      signal: AbortSignal.timeout(
        Number(process.env.OPENLEASH_DESKTOP_INVENTORY_TIMEOUT_MS ?? 10000),
      ),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      startupLog(
        `remote agent inventory sync failed: ${response.status} ${body.error || response.statusText}`,
      );
    } else {
      startupLog(
        `remote agent inventory synced: ${agents.length} agent${agents.length === 1 ? "" : "s"}`,
      );
      await reconcileRemoteAgentMonitoring(remoteApiUrl, token);
    }
  } catch {
    startupLog("remote agent inventory sync failed: request did not complete");
  }
}

async function saveRemoteAgentMonitoring(
  remoteApiUrl: string,
  token: string,
  kind: string,
  monitored: boolean,
) {
  try {
    const response = await fetch(
      new URL(
        `/v1/agents/${encodeURIComponent(kind)}/monitoring`,
        remoteApiUrl,
      ),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          ...apiVersionHeaders("mobileState"),
        },
        body: JSON.stringify({ monitored }),
        signal: AbortSignal.timeout(
          Number(
            process.env.OPENLEASH_DESKTOP_AGENT_MONITORING_TIMEOUT_MS ?? 10000,
          ),
        ),
      },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok)
      return {
        ok: false,
        error: body.error || "Could not save agent monitoring.",
      };
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach the managed OpenLeash API." };
  }
}

async function reconcileRemoteAgentMonitoring(
  remoteApiUrl: string,
  token: string,
) {
  try {
    const response = await fetch(new URL("/v1/mobile/state", remoteApiUrl), {
      headers: {
        authorization: `Bearer ${token}`,
        ...apiVersionHeaders("mobileState"),
      },
      signal: AbortSignal.timeout(
        Number(
          process.env.OPENLEASH_DESKTOP_AGENT_MONITORING_TIMEOUT_MS ?? 10000,
        ),
      ),
    });
    if (!response.ok) return;
    const body = (await response.json()) as RemoteMobileState;
    const desiredByKind = new Map<string, boolean>();
    for (const agent of body.agents ?? []) {
      const desired = agent.desired_monitored ?? agent.desiredMonitored;
      if (typeof desired === "boolean")
        desiredByKind.set(String(agent.kind ?? "").toLowerCase(), desired);
    }
    if (desiredByKind.size === 0) return;
    let changed = false;
    for (const agent of detectLocalAgentProtections({
      appVersion: app.getVersion(),
    })) {
      const desired = desiredByKind.get(agent.kind);
      if (
        typeof desired !== "boolean" ||
        !agent.installed ||
        !agent.supportsInstall
      )
        continue;
      if (desired && !agent.protected) {
        await protectAgentKind(agent.kind);
        changed = true;
      } else if (!desired && agent.protected) {
        await unprotectAgentKind(agent.kind);
        changed = true;
      }
    }
    if (changed) {
      localProtections = detectLocalAgentProtections({
        appVersion: app.getVersion(),
      });
      await postRemoteAgentInventory(
        remoteApiUrl,
        token,
        desktopInventoryAgents(),
      );
      refreshMenu();
      window?.webContents.send("openleash:update", {
        apiUrl,
        localProtections,
      });
    }
  } catch {
    startupLog(
      "remote agent monitoring reconcile failed: request did not complete",
    );
  }
}

async function postRemoteAgentInventory(
  remoteApiUrl: string,
  token: string,
  agents: ReturnType<typeof desktopInventoryAgents>,
) {
  await fetch(new URL("/v1/desktop/agents", remoteApiUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...apiVersionHeaders("desktopEnroll"),
    },
    body: JSON.stringify({
      hostname: os.hostname(),
      platform: os.platform(),
      osRelease: os.release(),
      clientVersion: app.getVersion(),
      agents,
    }),
    signal: AbortSignal.timeout(
      Number(process.env.OPENLEASH_DESKTOP_INVENTORY_TIMEOUT_MS ?? 10000),
    ),
  }).catch(() => undefined);
}

function rememberCurrentlyProtectedAgents() {
  for (const agent of localProtections) {
    if (agent.protected && agent.supportsInstall)
      enforcedAgentKinds.add(agent.kind);
  }
}

function startProtectionIntegrityGuard() {
  syncProtectionWatchers();
  protectionAuditTimer ??= setInterval(
    () => {
      scheduleProtectionRepair("periodic-audit");
    },
    5 * 60 * 1000,
  );
}

async function protectAgentKind(kind: string) {
  await installAgentProtection(kind, hookInstallContext());
  enforcedAgentKinds.add(kind);
  if (proxyStatus.running && isAutomaticProxyAgent(kind))
    configureAgentProxy(kind, true);
  await refreshLocalProtections(true);
  startProtectionIntegrityGuard();
}

const automaticProxyAgents = new Set([
  "claude-code",
  "codex",
  "opencode",
  "nanoclaw",
]);

function isAutomaticProxyAgent(kind: string) {
  return automaticProxyAgents.has(kind);
}

async function installProxyForMonitoredAgents(agents: string[]) {
  const token = localServer.effectiveToken || desktopAuthSession?.token;
  if (!token) throw new Error("OpenLeash backend token is unavailable.");
  return installLocalProxy({
    clientApiUrl: apiUrl,
    token,
    agents: agents.filter(isAutomaticProxyAgent),
  });
}

async function removeDesktopMonitoring() {
  await uninstallLocalProxy().catch(() => undefined);
  for (const kind of [...enforcedAgentKinds]) await unprotectAgentKind(kind);
}

async function unprotectAgentKind(kind: string) {
  enforcedAgentKinds.delete(kind);
  const pending = pendingProtectionRepairs.get(kind);
  if (pending) clearTimeout(pending);
  pendingProtectionRepairs.delete(kind);
  syncProtectionWatchers();
  if (isAutomaticProxyAgent(kind)) configureAgentProxy(kind, false);
  await uninstallAgentProtection(kind);
  await refreshLocalProtections(true);
  syncProtectionWatchers();
}

function syncProtectionWatchers() {
  const targets = protectionWatchTargets().filter((target) =>
    enforcedAgentKinds.has(target.kind),
  );
  const wantedPaths = new Set<string>();
  for (const target of targets) {
    for (const filePath of target.paths) {
      wantedPaths.add(filePath);
      ensureProtectionWatcher(filePath, target.kind);
      ensureProtectionWatcher(path.dirname(filePath), target.kind);
    }
  }
  for (const [watchPath, watcher] of protectionWatchers) {
    if (
      !wantedPaths.has(watchPath) &&
      ![...wantedPaths].some((filePath) => path.dirname(filePath) === watchPath)
    ) {
      watcher.close();
      protectionWatchers.delete(watchPath);
    }
  }
}

function ensureProtectionWatcher(watchPath: string, kind: string) {
  if (protectionWatchers.has(watchPath)) return;
  try {
    if (!fs.existsSync(watchPath))
      fs.mkdirSync(
        path.extname(watchPath) ? path.dirname(watchPath) : watchPath,
        { recursive: true },
      );
    const watcher = fs.watch(watchPath, { persistent: false }, () => {
      scheduleProtectionRepair(`watch:${kind}`);
    });
    watcher.on("error", (error) => {
      startupLog(
        `protection watcher failed for ${watchPath}: ${error.message}`,
      );
      protectionWatchers.delete(watchPath);
    });
    protectionWatchers.set(watchPath, watcher);
  } catch (error) {
    startupLog(
      `could not watch ${watchPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function scheduleProtectionRepair(reason: string) {
  for (const kind of enforcedAgentKinds) {
    const existing = pendingProtectionRepairs.get(kind);
    if (existing) clearTimeout(existing);
    pendingProtectionRepairs.set(
      kind,
      setTimeout(() => {
        pendingProtectionRepairs.delete(kind);
        void repairProtectedAgent(kind, reason);
      }, 1000),
    );
  }
}

function startSkillIntegrityGuard() {
  syncSkillWatchers();
  skillWatcherSyncTimer ??= setInterval(() => syncSkillWatchers(), 60 * 1000);
}

function syncSkillWatchers() {
  if (!localServer?.setupComplete) return;
  const targets = skillWatchTargets();
  const wanted = new Set(targets.map((target) => target.dir));
  for (const target of targets) {
    ensureSkillWatcher(target);
    scheduleSkillScan(target.dir, target, 50);
  }
  for (const [dir, watcher] of skillWatchers) {
    if (!wanted.has(dir)) {
      watcher.close();
      skillWatchers.delete(dir);
    }
  }
  reconcileRemovedSkills();
}

function reconcileRemovedSkills() {
  if (!localServer?.setupComplete) return;
  for (const skill of localServer.skills) {
    if (fs.existsSync(skill.skill_path)) continue;
    const target = {
      agentKind: skill.agent_kind,
      agentName: skill.agent_name,
      scope: skill.scope,
      projectPath: skill.project_path,
    };
    const observation = localServer.observeSkillRemoved({
      ...target,
      skillName:
        skill.skill_name || path.basename(path.dirname(skill.skill_path)),
      skillPath: skill.skill_path,
    });
    if (!observation.unchanged) {
      observedSkillHashes.delete(skill.skill_path);
      void sendRemoteSkillObservation({
        target,
        skillPath: skill.skill_path,
        observation,
      });
    }
  }
}

function skillWatchTargets() {
  const home = os.homedir();
  const claudeConfigDir =
    process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
  const codexHome = process.env.CODEX_HOME || path.join(home, ".codex");
  const targets: Array<{
    dir: string;
    agentKind: string;
    agentName: string;
    scope: "user" | "project";
    projectPath?: string | null;
  }> = [
    {
      dir: path.join(claudeConfigDir, "skills"),
      agentKind: "claude-code",
      agentName: "Claude Code",
      scope: "user",
    },
    {
      dir: path.join(codexHome, "skills"),
      agentKind: "codex",
      agentName: "OpenAI Codex",
      scope: "user",
    },
  ];
  targets.push(...discoverClaudePluginSkillTargets(claudeConfigDir));
  for (const projectPath of knownProjectPaths()) {
    targets.push(...discoverProjectSkillTargets(projectPath));
  }
  return targets
    .map((target) => ({
      ...target,
      dir: path.resolve(target.dir),
      projectPath: target.projectPath
        ? path.resolve(target.projectPath)
        : target.projectPath,
    }))
    .filter((target) => fs.existsSync(target.dir))
    .filter(
      (target, index, all) =>
        all.findIndex((item) => item.dir === target.dir) === index,
    );
}

function knownProjectPaths() {
  const paths = new Set<string>();
  paths.add(process.cwd());
  for (const agent of latestAgents)
    if (agent.project_path) paths.add(agent.project_path);
  for (const item of localServer?.history ?? [])
    if (item.project_path) paths.add(item.project_path);
  return [...paths]
    .map((item) => path.resolve(item))
    .filter((item) => item.startsWith(os.homedir()) && fs.existsSync(item))
    .slice(0, 100);
}

function discoverProjectSkillTargets(projectPath: string) {
  const targets: Array<{
    dir: string;
    agentKind: string;
    agentName: string;
    scope: "project";
    projectPath: string;
  }> = [];
  for (const base of projectConfigBases(projectPath)) {
    targets.push(
      {
        dir: path.join(base, ".claude", "skills"),
        agentKind: "claude-code",
        agentName: "Claude Code",
        scope: "project",
        projectPath: base,
      },
      {
        dir: path.join(base, ".codex", "skills"),
        agentKind: "codex",
        agentName: "OpenAI Codex",
        scope: "project",
        projectPath: base,
      },
      {
        dir: path.join(base, ".agents", "skills"),
        agentKind: "unknown",
        agentName: "Local agent",
        scope: "project",
        projectPath: base,
      },
    );
  }
  for (const dir of findNestedSkillDirs(projectPath)) {
    const normalized = dir.replace(/\\/g, "/");
    const agentKind = normalized.includes("/.claude/")
      ? "claude-code"
      : normalized.includes("/.codex/")
        ? "codex"
        : "unknown";
    targets.push({
      dir,
      agentKind,
      agentName:
        agentKind === "claude-code"
          ? "Claude Code"
          : agentKind === "codex"
            ? "OpenAI Codex"
            : "Local agent",
      scope: "project",
      projectPath,
    });
  }
  return targets;
}

function projectConfigBases(projectPath: string) {
  const bases: string[] = [];
  let current = path.resolve(projectPath);
  const stop = repoRootFor(current);
  while (true) {
    bases.push(current);
    if (current === stop) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return bases;
}

function repoRootFor(projectPath: string) {
  let current = path.resolve(projectPath);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return projectPath;
    current = parent;
  }
}

function findNestedSkillDirs(root: string) {
  const found: string[] = [];
  const stack = [{ dir: path.resolve(root), depth: 0 }];
  while (stack.length && found.length < 200) {
    const { dir, depth } = stack.pop()!;
    if (depth > 5) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (
        ["node_modules", ".git", "dist", "build", ".next", "target"].includes(
          entry.name,
        )
      )
        continue;
      const full = path.join(dir, entry.name);
      if ([".claude", ".codex", ".agents"].includes(entry.name)) {
        const skills = path.join(full, "skills");
        if (fs.existsSync(skills)) found.push(skills);
      }
      stack.push({ dir: full, depth: depth + 1 });
    }
  }
  return found;
}

function discoverClaudePluginSkillTargets(claudeConfigDir: string) {
  const roots = [
    path.join(claudeConfigDir, "plugins"),
    path.join(claudeConfigDir, "plugins", "cache"),
  ].filter((dir) => fs.existsSync(dir));
  const targets: Array<{
    dir: string;
    agentKind: string;
    agentName: string;
    scope: "user";
    projectPath?: null;
  }> = [];
  for (const root of roots) {
    const pluginSkillDirs = findPluginSkillDirs(root);
    for (const dir of pluginSkillDirs) {
      targets.push({
        dir,
        agentKind: "claude-code",
        agentName: "Claude Code plugin",
        scope: "user",
        projectPath: null,
      });
    }
  }
  return targets;
}

function findPluginSkillDirs(root: string) {
  const found: string[] = [];
  const stack = [{ dir: path.resolve(root), depth: 0 }];
  while (stack.length && found.length < 500) {
    const { dir, depth } = stack.pop()!;
    if (depth > 6) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const hasPluginManifest =
      entries.some(
        (entry) => entry.isDirectory() && entry.name === ".claude-plugin",
      ) || entries.some((entry) => entry.isFile() && entry.name === "SKILL.md");
    if (hasPluginManifest) {
      if (fs.existsSync(path.join(dir, "SKILL.md"))) found.push(dir);
      const skills = path.join(dir, "skills");
      if (fs.existsSync(skills)) found.push(skills);
    }
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !["node_modules", ".git", "dist", "build"].includes(entry.name)
      ) {
        stack.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
      }
    }
  }
  return found;
}

function ensureSkillWatcher(target: {
  dir: string;
  agentKind: string;
  agentName: string;
  scope: "user" | "project";
  projectPath?: string | null;
}) {
  if (skillWatchers.has(target.dir)) return;
  try {
    if (!fs.existsSync(target.dir)) return;
    const recursive =
      process.platform === "darwin" || process.platform === "win32";
    const watcher = fs.watch(target.dir, { persistent: false, recursive }, () =>
      scheduleSkillScan(target.dir, target),
    );
    watcher.on("error", (error) => {
      startupLog(`skill watcher failed for ${target.dir}: ${error.message}`);
      skillWatchers.delete(target.dir);
    });
    skillWatchers.set(target.dir, watcher);
  } catch (error) {
    startupLog(
      `could not watch skills ${target.dir}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function scheduleSkillScan(
  dir: string,
  target: {
    dir: string;
    agentKind: string;
    agentName: string;
    scope: "user" | "project";
    projectPath?: string | null;
  },
  delay = 700,
) {
  const existing = pendingSkillScans.get(dir);
  if (existing) clearTimeout(existing);
  pendingSkillScans.set(
    dir,
    setTimeout(() => {
      pendingSkillScans.delete(dir);
      void scanSkillDirectory(target);
    }, delay),
  );
}

async function scanSkillDirectory(target: {
  dir: string;
  agentKind: string;
  agentName: string;
  scope: "user" | "project";
  projectPath?: string | null;
}) {
  if (!localServer?.setupComplete || !fs.existsSync(target.dir)) return;
  const foundSkillPaths = new Set<string>();
  for (const skillPath of findSkillManifests(target.dir)) {
    try {
      const content = fs.readFileSync(skillPath, "utf8");
      const stat = fs.statSync(skillPath);
      const changedAt = new Date(stat.mtimeMs).toISOString();
      const hash = `${stat.mtimeMs}:${content.length}:${content.slice(0, 64)}`;
      foundSkillPaths.add(path.resolve(skillPath));
      if (observedSkillHashes.get(skillPath) === hash) continue;
      observedSkillHashes.set(skillPath, hash);
      const observation = await localServer.observeSkill({
        agentKind: target.agentKind,
        agentName: target.agentName,
        scope: target.scope,
        projectPath: target.projectPath,
        skillName: path.basename(path.dirname(skillPath)),
        skillPath,
        content,
        changedAt,
      });
      void sendRemoteSkillObservation({
        target,
        skillPath,
        content,
        observation,
      });
      window?.webContents.send("openleash:update", {
        apiUrl,
        pending: latestPending,
        agents: latestAgents,
        sessionMetrics: latestSessionMetrics,
        plugins: latestPlugins,
        outcomes: latestOutcomes,
        viewModel: latestViewModel,
        history: localServer.history,
        mcpServers: localServer.mcpServers,
        skills: localServer.skills,
        localProtections,
      });
    } catch (error) {
      startupLog(
        `could not inspect skill ${skillPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  for (const skill of localServer.skills) {
    const skillPath = path.resolve(skill.skill_path);
    if (!isPathInside(skillPath, target.dir) || foundSkillPaths.has(skillPath))
      continue;
    const observation = localServer.observeSkillRemoved({
      agentKind: target.agentKind,
      agentName: target.agentName,
      scope: target.scope,
      projectPath: target.projectPath,
      skillName:
        skill.skill_name || path.basename(path.dirname(skill.skill_path)),
      skillPath: skill.skill_path,
    });
    if (!observation.unchanged) {
      observedSkillHashes.delete(skill.skill_path);
      void sendRemoteSkillObservation({
        target,
        skillPath: skill.skill_path,
        observation,
      });
    }
  }
}

function isPathInside(filePath: string, directory: string) {
  const relative = path.relative(
    path.resolve(directory),
    path.resolve(filePath),
  );
  return (
    Boolean(relative) &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

function findSkillManifests(root: string) {
  const found: string[] = [];
  const stack = [root];
  while (stack.length && found.length < 500) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!["node_modules", ".git", "dist", "build"].includes(entry.name))
          stack.push(full);
      } else if (entry.isFile() && entry.name === "SKILL.md") {
        found.push(full);
      }
    }
  }
  return found;
}

async function sendRemoteSkillObservation({
  target,
  skillPath,
  content,
  observation,
}: {
  target: {
    agentKind: string;
    agentName: string;
    scope: "user" | "project";
    projectPath?: string | null;
  };
  skillPath: string;
  content?: string;
  observation: {
    assessment?: {
      riskScore?: number;
      reasons?: Array<{ reason: string; quote?: string }>;
      malicious?: boolean;
    };
    suspicious?: boolean;
    unchanged?: boolean;
    eventType?: "detected" | "changed" | "seen" | "removed";
    contentHash?: string;
    purposeSummary?: string;
  };
}) {
  const remoteApiUrl = localServer.remoteApiUrl;
  const token = localServer.effectiveToken;
  if (!remoteApiUrl || !token) return;
  const contentHash = content
    ? crypto.createHash("sha256").update(content).digest("hex")
    : observation.contentHash;
  try {
    await fetch(new URL("/v1/skills/observations", remoteApiUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...apiVersionHeaders("tenantSkillObservation"),
      },
      body: JSON.stringify({
        agentKind: target.agentKind,
        agentName: target.agentName,
        scope: target.scope,
        projectPath: target.projectPath,
        skillName: path.basename(path.dirname(skillPath)),
        skillPath,
        eventType:
          observation.eventType ?? (observation.unchanged ? "seen" : "changed"),
        contentHash,
        content: content?.slice(0, 80000),
        contentPreview: content?.slice(0, 12000),
        purposeSummary: observation.purposeSummary,
        status:
          observation.eventType === "removed"
            ? "deleted"
            : observation.suspicious
              ? "suspicious"
              : "observed",
        riskScore: observation.assessment?.riskScore ?? 0,
        reasons: observation.assessment?.reasons ?? [],
      }),
    });
  } catch (error) {
    startupLog(
      `could not send skill observation: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function pluginEnabled(pluginId: string) {
  const plugin = (
    latestPlugins.length > 0 ? latestPlugins : localServer.plugins
  ).find((item) => item.id === pluginId);
  return plugin?.settings?.enabled ?? true;
}

async function repairProtectedAgent(kind: string, reason: string) {
  if (repairingProtections || !localServer?.setupComplete) return;
  repairingProtections = true;
  try {
    const before = detectLocalAgentProtections({
      appVersion: app.getVersion(),
    }).find((agent) => agent.kind === kind);
    if (
      !before?.installed ||
      (before.protected && before.approvalHandoff !== false)
    )
      return;
    await installAgentProtection(kind, hookInstallContext());
    startupLog(`repaired ${kind} protection after ${reason}`);
    await refreshLocalProtections(true);
    syncProtectionWatchers();
    refreshMenu();
    window?.webContents.send("openleash:update", {
      apiUrl,
      pending: latestPending,
      agents: latestAgents,
      sessionMetrics: latestSessionMetrics,
      plugins: latestPlugins,
      outcomes: latestOutcomes,
      viewModel: latestViewModel,
      history: localServer.history,
      mcpServers: localServer.mcpServers,
      skills: localServer.skills,
      localProtections,
    });
  } catch (error) {
    startupLog(
      `could not repair ${kind} protection: ${error instanceof Error ? error.stack || error.message : String(error)}`,
    );
  } finally {
    repairingProtections = false;
  }
}

function showMainWindow(
  mode: "setup" | "settings" = localServer?.setupComplete
    ? "settings"
    : "setup",
) {
  showDockIcon();
  const sendState = () => {
    window?.webContents.send("openleash:update", {
      apiUrl,
      cloudApiUrl,
      mode,
      setupComplete: localServer?.setupComplete ?? false,
      introSeen: localServer?.introSeen ?? false,
      clientMode: localServer?.clientMode ?? "cloud",
      remoteApiUrl: localServer?.remoteApiUrl,
      remoteOrganization: localServer?.remoteOrganization,
      remoteUser: localServer?.remoteUser,
      apiProvider: localServer?.apiProvider ?? "openai",
      apiKeySet: localServer?.apiKeySet ?? false,
      agentDoneSound: localServer?.agentDoneSound ?? false,
      pending: latestPending,
      agents: latestAgents,
      sessionMetrics: latestSessionMetrics,
      plugins: latestPlugins,
      outcomes: latestOutcomes,
      viewModel: latestViewModel,
      localProtections,
      policies: localServer?.policies ?? [],
      history: localServer?.history ?? [],
      mcpServers: localServer?.mcpServers ?? [],
      skills: localServer?.skills ?? [],
    });
  };
  if (!window) {
    let hiddenByCloseButton = false;
    window = new BrowserWindow({
      width: MAIN_WINDOW_WIDTH,
      height: MAIN_WINDOW_HEIGHT,
      minWidth: MAIN_WINDOW_MIN_WIDTH,
      minHeight: MAIN_WINDOW_MIN_HEIGHT,
      show: false,
      skipTaskbar: false,
      frame: true,
      movable: true,
      resizable: true,
      title: APP_DISPLAY_NAME,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        preload: path.join(here, "preload.js"),
      },
    });
    const mainWindow = window;
    hardenWindow(mainWindow);
    mainWindow.loadFile(path.join(here, "window.html"));
    mainWindow.webContents.once("did-finish-load", sendState);
    mainWindow.on("close", (event) => {
      if (quitting) return;
      event.preventDefault();
      hiddenByCloseButton = true;
      window?.setSkipTaskbar(!setupNeedsDockIcon());
      window?.hide();
      hideDockIconIfTrayMode();
    });
    mainWindow.on("minimize", () => {
      hiddenByCloseButton = false;
      mainWindow.setSkipTaskbar(false);
      showDockIcon();
    });
    mainWindow.on("restore", () => {
      hiddenByCloseButton = false;
      mainWindow.setSkipTaskbar(false);
      showDockIcon();
    });
    mainWindow.on("show", () => {
      hiddenByCloseButton = false;
    });
    mainWindow.on("hide", () => {
      if (quitting) return;
      if (hiddenByCloseButton) {
        mainWindow.setSkipTaskbar(!setupNeedsDockIcon());
        hideDockIconIfTrayMode();
      } else {
        mainWindow.setSkipTaskbar(false);
        showDockIcon();
      }
    });
    mainWindow.on("closed", () => {
      if (window === mainWindow) window = undefined;
    });
  }
  window.setTitle(APP_DISPLAY_NAME);
  if (window.isMinimized()) window.restore();
  if (mode === "setup" || !localServer?.setupComplete) {
    fitMainWindowOnLargestDisplay(window);
  } else {
    window.center();
  }
  activateOpenLeashApp();
  window.setSkipTaskbar(false);
  window.show();
  window.moveTop();
  window.focus();
  showDockIcon();
  setTimeout(() => {
    if (!window || window.isDestroyed()) return;
    activateOpenLeashApp();
    window.show();
    window.moveTop();
    window.focus();
  }, 80);
  if (!window.webContents.isLoading()) sendState();
}

function quitOpenLeash() {
  quitting = true;
  noticeWindow?.destroy();
  noticeWindow = undefined;
  window?.destroy();
  window = undefined;
  for (const watcher of protectionWatchers.values()) watcher.close();
  protectionWatchers.clear();
  if (protectionAuditTimer) clearInterval(protectionAuditTimer);
  for (const timer of pendingProtectionRepairs.values()) clearTimeout(timer);
  pendingProtectionRepairs.clear();
  for (const watcher of skillWatchers.values()) watcher.close();
  skillWatchers.clear();
  if (skillWatcherSyncTimer) clearInterval(skillWatcherSyncTimer);
  for (const timer of pendingSkillScans.values()) clearTimeout(timer);
  pendingSkillScans.clear();
  tray?.destroy();
  tray = undefined;
  app.quit();
}

function relaunchOpenLeash() {
  quitting = true;
  latestPending = [];
  latestAgents = [];
  activeNoticeKey = undefined;
  app.relaunch();
  setTimeout(() => app.exit(0), 250);
}

function restoreMainWindow() {
  if (!app.isReady() || !localServer) return;
  if (Date.now() < suppressMainWindowActivationUntil) return;
  showMainWindow(localServer.setupComplete ? "settings" : "setup");
}

function suppressMainWindowActivation(durationMs = 30000) {
  suppressMainWindowActivationUntil = Date.now() + durationMs;
}

function closeNoticeWithoutOpeningMainWindow() {
  suppressMainWindowActivation();
  if (noticeWindow && !noticeWindow.isDestroyed()) noticeWindow.destroy();
  noticeWindow = undefined;
  activeNoticeKey = undefined;
  if (window && !window.isDestroyed() && !window.isVisible()) {
    window.hide();
    window.setSkipTaskbar(!setupNeedsDockIcon());
    hideDockIconIfTrayMode();
  }
  if (process.platform === "darwin" && !setupNeedsDockIcon()) app.hide();
}

function showAgentDetail(_agent: AgentStatus) {
  showMainWindow("settings");
}

function largestDisplay(): Display {
  return screen.getAllDisplays().reduce((largest, candidate) => {
    const largestArea = largest.workArea.width * largest.workArea.height;
    const candidateArea = candidate.workArea.width * candidate.workArea.height;
    return candidateArea > largestArea ? candidate : largest;
  }, screen.getPrimaryDisplay());
}

function centerWindowOnLargestDisplay(target: BrowserWindow) {
  const display = largestDisplay().workArea;
  const bounds = target.getBounds();
  target.setPosition(
    Math.round(display.x + (display.width - bounds.width) / 2),
    Math.round(display.y + (display.height - bounds.height) / 2),
    false,
  );
}

function fitMainWindowOnLargestDisplay(target: BrowserWindow) {
  const display = largestDisplay().workArea;
  const width = Math.min(
    MAIN_WINDOW_WIDTH,
    Math.max(MAIN_WINDOW_MIN_WIDTH, display.width - 48),
  );
  const height = Math.min(
    MAIN_WINDOW_HEIGHT,
    Math.max(MAIN_WINDOW_MIN_HEIGHT, display.height - 48),
  );
  target.setMinimumSize(
    Math.min(MAIN_WINDOW_MIN_WIDTH, width),
    Math.min(MAIN_WINDOW_MIN_HEIGHT, height),
  );
  target.setBounds(
    {
      x: Math.round(display.x + (display.width - width) / 2),
      y: Math.round(display.y + (display.height - height) / 2),
      width,
      height,
    },
    false,
  );
}

type DecisionNotice =
  | { kind: "ask"; pending: PendingDecision }
  | {
      kind: "sample";
      agentName: string;
      summary: string;
      policy: string;
      project: string;
    };

function noticeWorkArea(notice: DecisionNotice) {
  return largestDisplay().workArea;
}

function showDecisionNotice(notice: DecisionNotice) {
  const display = noticeWorkArea(notice);
  const width = 486;
  const supportsGuidance =
    notice.kind === "ask"
      ? supportsAgentGuidance(notice.pending.agent_kind)
      : false;
  const height = notice.kind === "sample" ? 362 : 650;
  const noticeKey =
    notice.kind === "ask" ? decisionNoticeKey(notice.pending) : "sample";
  if (
    activeNoticeKey === noticeKey &&
    noticeWindow &&
    !noticeWindow.isDestroyed()
  ) {
    noticeWindow.webContents.send("openleash:notice", formatNotice(notice));
    if (!noticeWindow.isVisible()) noticeWindow.showInactive();
    return;
  }
  const previousNoticeWindow = noticeWindow;
  previousNoticeWindow?.close();
  suppressMainWindowActivation();
  activeNoticeKey = noticeKey;
  const createdNoticeWindow = new BrowserWindow({
    width,
    height,
    x: Math.round(display.x + display.width - width - 18),
    y: Math.round(display.y + 18),
    show: false,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    hasShadow: false,
    focusable: supportsGuidance,
    acceptFirstMouse: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: path.join(here, "preload.js"),
    },
  });
  noticeWindow = createdNoticeWindow;
  hardenWindow(noticeWindow);
  noticeWindow.setAlwaysOnTop(true, "screen-saver");
  noticeWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  noticeWindow.loadFile(path.join(here, "notice.html"));
  noticeWindow.once("closed", () => {
    if (noticeWindow !== createdNoticeWindow) return;
    noticeWindow = undefined;
    if (activeNoticeKey === noticeKey) activeNoticeKey = undefined;
  });
  noticeWindow.webContents.once("did-finish-load", () => {
    if (
      noticeWindow !== createdNoticeWindow ||
      createdNoticeWindow.isDestroyed()
    )
      return;
    createdNoticeWindow.webContents.send(
      "openleash:notice",
      formatNotice(notice),
    );
    createdNoticeWindow.showInactive();
    createdNoticeWindow.setAlwaysOnTop(true, "screen-saver");
    createdNoticeWindow.moveTop();
    createdNoticeWindow.flashFrame(true);
  });
}

function formatNotice(notice: DecisionNotice) {
  if (notice.kind === "ask") {
    const item = notice.pending;
    const action = friendlyAction(item.event_name, item.tool_name);
    return {
      kind: "ask",
      id: item.id,
      agentName: item.agent_name,
      agentIcon: agentIconFor(item.agent_name),
      action,
      summary: item.summary,
      purpose: item.purpose_summary ?? noticePurpose(item),
      evidence: item.quote || requestText(item.payload),
      contextSummary: precedingContextSummary(item),
      detail: noticeDetail(item),
      policy: item.triggered_policies?.[0]?.policy_name,
      pluginName: noticePluginName(item),
      project: projectTag(item.project_path),
      time: timeAgo(item.created_at),
      supportsGuidance: supportsAgentGuidance(item.agent_kind),
    };
  }
  if (notice.kind === "sample") {
    return {
      kind: "sample",
      agentName: notice.agentName,
      agentIcon: agentIconFor(notice.agentName),
      summary: notice.summary,
      policy: notice.policy,
      project: notice.project,
      time: "example",
    };
  }
}

function noticePluginName(item: PendingDecision) {
  const payload =
    item.payload && typeof item.payload === "object"
      ? (item.payload as {
          openleashPluginRuns?: Array<{
            pluginId?: string;
            plugin_id?: string;
            decision?: string;
          }>;
        })
      : undefined;
  const runs = Array.isArray(payload?.openleashPluginRuns)
    ? payload.openleashPluginRuns
    : [];
  const run = runs.find((entry) =>
    ["blocked", "needs_question", "failed"].includes(
      String((entry as { status?: string }).status ?? "").toLowerCase(),
    ),
  );
  const pluginId = item.plugin_id || run?.pluginId || run?.plugin_id;
  if (!pluginId || pluginId === "openleash.core") return "openleash-core";
  const slug = pluginId.replace(/^openleash\./, "");
  return slug === "prompt-compression" ? "token-saver" : slug;
}

function precedingContextSummary(item: PendingDecision) {
  const turns = (item.recent_context ?? []).filter((turn) =>
    turn.content?.trim(),
  );
  if (turns.length < 2) return undefined;
  const prior = turns.slice(0, -1).slice(-2);
  return prior
    .map(
      (turn) =>
        `${turn.role === "assistant" ? "Agent" : "User"}: ${truncate(String(turn.content).replace(/\s+/g, " "), 90)}`,
    )
    .join(" · ");
}

function supportsAgentGuidance(agentKind?: string) {
  return ["claude-code", "codex", "openclaw", "nanoclaw"].includes(
    String(agentKind ?? ""),
  );
}

function noticeDetail(item: {
  project_path?: string;
  hostname?: string;
  payload?: unknown;
}) {
  return [projectTag(item.project_path), item.hostname]
    .filter(Boolean)
    .join(" · ");
}

function noticePurpose(item: {
  event_name?: string;
  tool_name?: string;
  payload?: unknown;
  question?: string;
  summary?: string;
}) {
  const payload =
    item.payload && typeof item.payload === "object"
      ? (item.payload as {
          openleashPurposeSummary?: unknown;
          transcript?: Array<{ role?: string; content?: string }>;
          prompt?: string;
          tool?: { name?: string; input?: unknown };
        })
      : undefined;
  if (
    typeof payload?.openleashPurposeSummary === "string" &&
    payload.openleashPurposeSummary.trim()
  ) {
    return payload.openleashPurposeSummary.trim();
  }
  const recent =
    payload?.transcript?.slice(-NOTICE_CONTEXT_MESSAGE_COUNT) ?? [];
  const latestUser = [...recent]
    .reverse()
    .find((turn) => turn.role === "user" && turn.content?.trim())?.content;
  const prompt = payload?.prompt || latestUser;
  const action =
    item.tool_name || payload?.tool?.name
      ? `use ${item.tool_name ?? payload?.tool?.name}`
      : item.event_name === "UserPromptSubmit"
        ? "answer the latest prompt"
        : "continue the current task";
  if (prompt)
    return `It appears to ${action} for: ${truncate(prompt.replace(/\s+/g, " "), 110)}`;
  return undefined;
}

function requestText(payload: unknown) {
  if (!payload || typeof payload !== "object") return undefined;
  const event = payload as { prompt?: unknown; tool?: { input?: unknown } };
  if (typeof event.prompt === "string" && event.prompt.trim())
    return truncate(event.prompt, 220);
  const input = event.tool?.input;
  if (typeof input === "string" && input.trim()) return truncate(input, 120);
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    const value =
      record.command ?? record.file_path ?? record.path ?? record.url;
    if (typeof value === "string" && value.trim()) return truncate(value, 120);
  }
  return undefined;
}

function evidenceItems(value: string[] | string | undefined) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is string => typeof item === "string" && item.length > 0,
        )
      : [value];
  } catch {
    return [value];
  }
}

function projectTag(value?: string) {
  if (!value) return undefined;
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.split("/").filter(Boolean).pop() ?? normalized;
}

function friendlyAction(eventName?: string, toolName?: string) {
  if (/^Write$/i.test(toolName || "") || /^MultiEdit$/i.test(toolName || ""))
    return "edit a file";
  if (toolName) return `use ${toolName}`;
  if (eventName === "UserPromptSubmit") return "submit your prompt";
  if (eventName === "PreToolUse") return "use a tool";
  if (eventName === "PostToolUse") return "finish a tool result";
  if (eventName === "Stop") return "finish this session";
  return "continue";
}

let lastAgentDoneSoundAt = 0;
function playAgentDoneSound() {
  const now = Date.now();
  if (now - lastAgentDoneSoundAt < 1200) return;
  lastAgentDoneSoundAt = now;
  if (process.platform === "darwin") {
    const child = spawn("afplay", ["/System/Library/Sounds/Glass.aiff"], {
      stdio: "ignore",
      detached: true,
    });
    child.unref();
    return;
  }
  process.stdout.write("\x07");
}

async function configureLocalAgent() {
  const dir = path.join(os.homedir(), ".openleash");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    `${JSON.stringify(
      {
        apiUrl,
        token: localServer.token,
        mode: localServer.clientMode,
        remoteApiUrl: localServer.remoteApiUrl,
        clientVersion: app.getVersion(),
        enrolledAt: new Date().toISOString(),
        computer: { hostname: os.hostname() },
      },
      null,
      2,
    )}\n`,
  );
}

function localHookInstallContext() {
  return {
    apiUrl,
    token: localServer.token,
    clientVersion: app.getVersion(),
    apiFunction: "localHookEvaluate",
    apiVersion: "2026-05-22.local-hook-evaluate.v1",
  };
}

function hookInstallContext() {
  const managed = Boolean(localServer.remoteApiUrl);
  return {
    apiUrl: localServer.remoteApiUrl || apiUrl,
    token: localServer.effectiveToken,
    clientVersion: app.getVersion(),
    apiFunction: managed ? "tenantHookEvaluate" : "localHookEvaluate",
    apiVersion: managed
      ? "2026-05-22.tenant-hook-evaluate.v1"
      : "2026-05-22.local-hook-evaluate.v1",
  };
}

function normalizeRemoteApiUrl(value: string) {
  const trimmed = String(value || "").trim();
  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const url = new URL(withProtocol);
  if (!["https:", "http:"].includes(url.protocol))
    throw new Error("Remote API URL must use http or https.");
  if ((url.username || url.password) && !isLocalApiHost(url.hostname)) {
    throw new Error("Remote API URL cannot include credentials.");
  }
  if (url.protocol === "http:" && !isLocalApiHost(url.hostname)) {
    throw new Error(
      "Remote API URL must use https unless it is local development.",
    );
  }
  return url.toString().replace(/\/+$/, "");
}

function isLocalApiHost(hostname: string) {
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
}

function isLocalApiUrl(value: string) {
  try {
    return isLocalApiHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

async function checkSelfHostedRuntime() {
  const docker = spawnSync("docker", ["--version"], { encoding: "utf8" });
  const dockerInstalled = docker.status === 0;
  const info = dockerInstalled
    ? spawnSync("docker", ["info"], { encoding: "utf8", timeout: 8000 })
    : undefined;
  const dockerRunning = Boolean(info && info.status === 0);
  const apiReachable = await canReach("http://127.0.0.1:9318/health");
  return {
    dockerInstalled,
    dockerRunning,
    apiReachable,
    status: apiReachable
      ? "OpenLeash API is reachable"
      : dockerRunning
        ? "Docker is ready"
        : dockerInstalled
          ? "Docker is installed but not running"
          : "Docker is not installed",
    log: [docker.stdout, docker.stderr, info?.stderr]
      .filter(Boolean)
      .join("\n")
      .trim(),
  };
}

async function startSelfHostedRuntime() {
  const before = await checkSelfHostedRuntime();
  if (!before.dockerInstalled) {
    await openTrustedExternalUrl(
      "https://www.docker.com/products/docker-desktop/",
    );
    return {
      ...before,
      status:
        "Docker Desktop is required. Install it, start it, then continue.",
      log: before.log,
    };
  }
  if (!before.dockerRunning) {
    return {
      ...before,
      status: "Start Docker Desktop, then click Start local OpenLeash again.",
      log: before.log,
    };
  }
  const runtimeDir = path.join(
    os.homedir(),
    ".openleash",
    "individual-open-source",
  );
  ensureIndividualOpenSourceRuntime(runtimeDir);
  const compose = dockerComposeArgs();
  const setup = [
    spawnSync("docker", [...compose, "pull"], {
      encoding: "utf8",
      timeout: 300000,
      cwd: runtimeDir,
    }),
    spawnSync("docker", [...compose, "up", "-d", "postgres"], {
      encoding: "utf8",
      timeout: 180000,
      cwd: runtimeDir,
    }),
    spawnSync(
      "docker",
      [...compose, "--profile", "setup", "run", "--rm", "migrate"],
      { encoding: "utf8", timeout: 180000, cwd: runtimeDir },
    ),
    spawnSync(
      "docker",
      [...compose, "--profile", "setup", "run", "--rm", "seed"],
      { encoding: "utf8", timeout: 180000, cwd: runtimeDir },
    ),
    spawnSync("docker", [...compose, "up", "-d", "client-api"], {
      encoding: "utf8",
      timeout: 180000,
      cwd: runtimeDir,
    }),
  ];
  const failed = setup.find((result) => result.status !== 0);
  const apiReachable = await waitForReachable(
    `${individualOpenSourceApiUrl}/health`,
    60000,
  );
  return {
    dockerInstalled: true,
    dockerRunning: true,
    apiReachable,
    status: apiReachable
      ? "Setup finished. Local OpenLeash is ready."
      : "Containers started, but setup is not ready yet.",
    log: [
      `Runtime: ${runtimeDir}`,
      ...setup.flatMap((result) => [result.stdout, result.stderr]),
      failed ? `Failed command exited ${failed.status}` : "",
    ]
      .filter(Boolean)
      .join("\n")
      .trim(),
  };
}

function dockerComposeArgs() {
  const compose = spawnSync("docker", ["compose", "version"], {
    encoding: "utf8",
  });
  if (compose.status === 0) return ["compose"];
  return ["compose"];
}

function ensureIndividualOpenSourceRuntime(runtimeDir: string) {
  fs.mkdirSync(path.join(runtimeDir, "backups"), { recursive: true });
  const envPath = path.join(runtimeDir, ".env");
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(
      envPath,
      [
        "OPENLEASH_IMAGE_REGISTRY=ghcr.io/open-leash",
        `OPENLEASH_VERSION=${process.env.OPENLEASH_BACKEND_VERSION || "0.36.7@sha256:c84ac6c8d0f17ef6790cedaa2b546e9230da3b304a5b7abfc3c2ced5f53e7fb4"}`,
        "OPENLEASH_POSTGRES_DB=openleash",
        "OPENLEASH_POSTGRES_USER=openleash",
        `OPENLEASH_POSTGRES_PASSWORD=${randomHexSecret()}`,
        "OPENLEASH_CLIENT_API_PORT=9318",
        `OPENLEASH_RELEASE_ADMIN_TOKEN=${randomHexSecret()}`,
        `OPENLEASH_MODEL_KEY_ENCRYPTION_KEY=${randomHexSecret()}`,
        `OPENLEASH_PROVIDER_USAGE_ENCRYPTION_KEY=${randomHexSecret()}`,
        `OPENLEASH_SECRET_KEY=${randomHexSecret()}`,
        "",
      ].join("\n"),
    );
  }
  upsertEnvValues(envPath, {
    OPENLEASH_DEV_TOKEN: localServer.token,
    OPENLEASH_ALLOW_PROD_DEV_TOKEN_SEED: "1",
    OPENLEASH_DEV_ORG_SLUG: "individual-open-source",
    OPENLEASH_DEV_ORG_NAME: "Individual Open Source",
  });
  fs.writeFileSync(
    path.join(runtimeDir, "docker-compose.yml"),
    individualOpenSourceCompose(),
  );
}

function upsertEnvValues(envPath: string, values: Record<string, string>) {
  const existing = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, "utf8")
    : "";
  const lines = existing.split(/\r?\n/).filter((line) => line.length > 0);
  const seen = new Set<string>();
  const next = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match) return line;
    const key = match[1];
    if (!(key in values)) return line;
    seen.add(key);
    return `${key}=${values[key]}`;
  });
  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) next.push(`${key}=${value}`);
  }
  fs.writeFileSync(envPath, `${next.join("\n")}\n`);
}

function randomHexSecret() {
  return crypto.randomBytes(24).toString("hex");
}

function individualOpenSourceCompose() {
  return `name: openleash-individual

services:
  postgres:
    image: postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777
    container_name: openleash-individual-postgres
    environment:
      POSTGRES_DB: \${OPENLEASH_POSTGRES_DB:-openleash}
      POSTGRES_USER: \${OPENLEASH_POSTGRES_USER:-openleash}
      POSTGRES_PASSWORD: \${OPENLEASH_POSTGRES_PASSWORD:-openleash}
    volumes:
      - openleash-individual-postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U \${OPENLEASH_POSTGRES_USER:-openleash} -d \${OPENLEASH_POSTGRES_DB:-openleash}"]
      interval: 5s
      timeout: 5s
      retries: 20

  migrate:
    image: \${OPENLEASH_IMAGE_REGISTRY:-ghcr.io/open-leash}/client-api:\${OPENLEASH_VERSION:-0.36.7@sha256:c84ac6c8d0f17ef6790cedaa2b546e9230da3b304a5b7abfc3c2ced5f53e7fb4}
    profiles: ["setup"]
    environment:
      DATABASE_URL: postgres://\${OPENLEASH_POSTGRES_USER:-openleash}:\${OPENLEASH_POSTGRES_PASSWORD:-openleash}@postgres:5432/\${OPENLEASH_POSTGRES_DB:-openleash}
      OPENLEASH_DEV_TOKEN: \${OPENLEASH_DEV_TOKEN:-}
      OPENLEASH_ALLOW_PROD_DEV_TOKEN_SEED: \${OPENLEASH_ALLOW_PROD_DEV_TOKEN_SEED:-1}
      OPENLEASH_DEV_ORG_SLUG: individual-open-source
      OPENLEASH_DEV_ORG_NAME: Individual Open Source
      OPENLEASH_DEPLOYMENT_MODE: individual-open-source
    command: ["node", "apps/client-api/dist/migrate.js", "--apply"]
    depends_on:
      postgres:
        condition: service_healthy

  seed:
    image: \${OPENLEASH_IMAGE_REGISTRY:-ghcr.io/open-leash}/client-api:\${OPENLEASH_VERSION:-0.36.7@sha256:c84ac6c8d0f17ef6790cedaa2b546e9230da3b304a5b7abfc3c2ced5f53e7fb4}
    profiles: ["setup"]
    environment:
      DATABASE_URL: postgres://\${OPENLEASH_POSTGRES_USER:-openleash}:\${OPENLEASH_POSTGRES_PASSWORD:-openleash}@postgres:5432/\${OPENLEASH_POSTGRES_DB:-openleash}
    command: ["node", "apps/client-api/dist/create-organization.js", "--name", "Individual Open Source", "--slug", "individual-open-source", "--mode", "private"]
    depends_on:
      postgres:
        condition: service_healthy

  client-api:
    image: \${OPENLEASH_IMAGE_REGISTRY:-ghcr.io/open-leash}/client-api:\${OPENLEASH_VERSION:-0.36.7@sha256:c84ac6c8d0f17ef6790cedaa2b546e9230da3b304a5b7abfc3c2ced5f53e7fb4}
    container_name: openleash-individual-client-api
    environment:
      DATABASE_URL: postgres://\${OPENLEASH_POSTGRES_USER:-openleash}:\${OPENLEASH_POSTGRES_PASSWORD:-openleash}@postgres:5432/\${OPENLEASH_POSTGRES_DB:-openleash}
      OPENLEASH_API_PORT: 9318
      OPENLEASH_API_SURFACE: client
      OPENLEASH_DEPLOYMENT_MODE: individual-open-source
      OPENLEASH_DEV_ORG_SLUG: individual-open-source
      OPENLEASH_DEV_ORG_NAME: Individual Open Source
      OPENLEASH_DEV_TOKEN: \${OPENLEASH_DEV_TOKEN:-}
      OPENLEASH_ALLOW_PROD_DEV_TOKEN_SEED: \${OPENLEASH_ALLOW_PROD_DEV_TOKEN_SEED:-1}
      OPENLEASH_RELEASE_ADMIN_TOKEN: \${OPENLEASH_RELEASE_ADMIN_TOKEN:-local-release-admin-token}
      OPENLEASH_MODEL_KEY_ENCRYPTION_KEY: \${OPENLEASH_MODEL_KEY_ENCRYPTION_KEY:-openleash-local-model-key-change-me}
      OPENLEASH_PROVIDER_USAGE_ENCRYPTION_KEY: \${OPENLEASH_PROVIDER_USAGE_ENCRYPTION_KEY:-openleash-local-provider-key-change-me}
      OPENLEASH_SECRET_KEY: \${OPENLEASH_SECRET_KEY:-openleash-local-secret-change-me}
    ports:
      - "127.0.0.1:\${OPENLEASH_CLIENT_API_PORT:-9318}:9318"
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  openleash-individual-postgres:
`;
}

function findRepoFile(fileName: string) {
  const candidates = [
    process.cwd(),
    here,
    path.resolve(here, ".."),
    path.resolve(here, "..", ".."),
    path.resolve(here, "..", "..", ".."),
    path.resolve(here, "..", "..", "..", ".."),
  ].map((dir) => path.join(dir, fileName));
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function canReach(url: string) {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForReachable(url: string, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await canReach(url)) return true;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return false;
}

function localRulesConfigPath() {
  return path.join(os.homedir(), ".openleash", "rules.json");
}

type InstructionRuleSource = {
  agent: string;
  scope: "global" | "project";
  label: string;
  path: string;
};

function discoverAgentInstructionFiles(): InstructionRuleSource[] {
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
  const sources: InstructionRuleSource[] = [
    {
      agent: "Claude Code",
      scope: "global",
      label: "Global CLAUDE.md",
      path: path.join(home, ".claude", "CLAUDE.md"),
    },
    {
      agent: "Codex CLI",
      scope: "global",
      label: "Global AGENTS.md",
      path: path.join(home, ".codex", "AGENTS.md"),
    },
    {
      agent: "Cline",
      scope: "global",
      label: "Global AGENTS.md",
      path: path.join(home, ".agents", "AGENTS.md"),
    },
    {
      agent: "OpenCode",
      scope: "global",
      label: "Global AGENTS.md",
      path: path.join(
        process.platform === "win32" ? appData : path.join(home, ".config"),
        "opencode",
        "AGENTS.md",
      ),
    },
    {
      agent: "Windsurf",
      scope: "global",
      label: "Global rules",
      path: path.join(
        home,
        ".codeium",
        "windsurf",
        "memories",
        "global_rules.md",
      ),
    },
    {
      agent: "GitHub Copilot",
      scope: "global",
      label: "CLI instructions",
      path: path.join(home, ".copilot", "copilot-instructions.md"),
    },
  ];

  for (const root of projectInstructionRoots()) {
    sources.push(
      {
        agent: "Claude Code",
        scope: "project",
        label: "Project CLAUDE.md",
        path: path.join(root, "CLAUDE.md"),
      },
      {
        agent: "Claude Code",
        scope: "project",
        label: "Project .claude/CLAUDE.md",
        path: path.join(root, ".claude", "CLAUDE.md"),
      },
      {
        agent: "Codex/OpenCode/Cline/Cursor/Copilot",
        scope: "project",
        label: "Project AGENTS.md",
        path: path.join(root, "AGENTS.md"),
      },
      {
        agent: "Cursor",
        scope: "project",
        label: "Legacy .cursorrules",
        path: path.join(root, ".cursorrules"),
      },
      {
        agent: "Cline",
        scope: "project",
        label: "Legacy .clinerules",
        path: path.join(root, ".clinerules"),
      },
      {
        agent: "Windsurf",
        scope: "project",
        label: "Project .windsurfrules",
        path: path.join(root, ".windsurfrules"),
      },
      {
        agent: "GitHub Copilot",
        scope: "project",
        label: "Copilot instructions",
        path: path.join(root, ".github", "copilot-instructions.md"),
      },
    );
    for (const filePath of filesInDirectory(
      path.join(root, ".cursor", "rules"),
      /\.(mdc|md|markdown|txt)$/i,
    )) {
      sources.push({
        agent: "Cursor",
        scope: "project",
        label: "Cursor rule",
        path: filePath,
      });
    }
    for (const filePath of filesInDirectory(
      path.join(root, ".clinerules"),
      /\.(md|markdown|txt|rules)$/i,
    )) {
      sources.push({
        agent: "Cline",
        scope: "project",
        label: "Cline rule",
        path: filePath,
      });
    }
    for (const filePath of filesInDirectory(
      path.join(root, ".windsurf", "rules"),
      /\.(md|markdown|txt|rules)$/i,
    )) {
      sources.push({
        agent: "Windsurf",
        scope: "project",
        label: "Windsurf rule",
        path: filePath,
      });
    }
    for (const filePath of filesInDirectory(
      path.join(root, ".github", "instructions"),
      /\.instructions\.md$/i,
    )) {
      sources.push({
        agent: "GitHub Copilot",
        scope: "project",
        label: "Path-specific Copilot instruction",
        path: filePath,
      });
    }
  }

  const byPath = new Map<string, InstructionRuleSource>();
  for (const source of sources) {
    if (!fs.existsSync(source.path)) continue;
    const resolved = path.resolve(source.path);
    if (!byPath.has(resolved))
      byPath.set(resolved, { ...source, path: resolved });
  }
  return [...byPath.values()];
}

function projectInstructionRoots() {
  const candidates = [
    process.env.OPENLEASH_PROJECT_ROOT,
    process.env.PWD,
    process.cwd(),
  ].filter((value): value is string => Boolean(value));
  const roots = new Set<string>();
  for (const candidate of candidates) {
    let current = path.resolve(candidate);
    if (!fs.existsSync(current)) continue;
    if (!fs.statSync(current).isDirectory()) current = path.dirname(current);
    roots.add(current);
    const gitRoot = nearestGitRoot(current);
    if (gitRoot) roots.add(gitRoot);
  }
  return [...roots];
}

function nearestGitRoot(start: string) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function filesInDirectory(directory: string, pattern: RegExp) {
  try {
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && pattern.test(entry.name))
      .map((entry) => path.join(directory, entry.name));
  } catch {
    return [];
  }
}

function parseRulesImport(content: string, filePath: string) {
  if (path.extname(filePath).toLowerCase() === ".json")
    return JSON.parse(content) as unknown;
  const rules = ruleCandidatesFromMarkdown(content).map((text) => ({
    id: `imported-${crypto.createHash("sha1").update(text).digest("hex").slice(0, 12)}`,
    name: importedRuleTitle(text),
    category: "Imported rules",
    description: text,
    enabled: true,
    match: [text],
  }));
  return { rules };
}

function ruleCandidatesFromMarkdown(content: string) {
  const cleaned = content.replace(/```[\s\S]*?```/g, "").replace(/\r\n/g, "\n");
  const candidates: string[] = [];
  for (const paragraph of cleaned.split(/\n{2,}/g)) {
    const lines = paragraph
      .split(/\n/g)
      .map((line) => line.replace(/^#{1,6}\s+/, "").trim())
      .filter(Boolean);
    if (lines.length === 0) continue;
    const listItems = lines
      .filter((line) => /^\s*(?:[-*]|\d+[.)])\s+/.test(line))
      .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim())
      .filter(isRuleCandidateText);
    if (listItems.length > 0) {
      candidates.push(...listItems);
      continue;
    }
    const text = lines.join(" ").replace(/\s+/g, " ").trim();
    if (isRuleCandidateText(text)) candidates.push(text);
  }
  return [
    ...new Map(candidates.map((text) => [text.toLowerCase(), text])).values(),
  ];
}

function isRuleCandidateText(text: string) {
  return (
    text.length >= 8 &&
    !/^(rules|instructions|guidelines|notes?|overview|context)$/i.test(text)
  );
}

function parsePluginRulesJsonImport(content: string) {
  const parsed = JSON.parse(content) as unknown;
  const rawRules = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { rules?: unknown[] }).rules)
      ? (parsed as { rules: unknown[] }).rules
      : [];
  if (rawRules.length === 0) {
    throw new Error(
      "JSON must be an array of rules or an object with a rules array.",
    );
  }
  const rules = rawRules
    .map((rule) => {
      if (typeof rule === "string") return { text: rule.trim(), action: "ask" };
      if (rule && typeof rule === "object") {
        const record = rule as Record<string, unknown>;
        return {
          text: String(
            record.text ??
              record.rule ??
              record.description ??
              record.natural_language_rule ??
              "",
          ).trim(),
          action: record.action === "block" ? "block" : "ask",
        };
      }
      return { text: "", action: "ask" };
    })
    .filter((rule) => rule.text);
  if (rules.length === 0)
    throw new Error("No valid rules found in that JSON file.");
  return rules;
}

function importedRuleTitle(rule: string) {
  const cleaned = rule
    .replace(/[^\w\s.+/#-]/g, " ")
    .replace(
      /\b(do not|don't|never|always|must|should|the|a|an|to|from|that|which|any|before)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  const title = (cleaned || "Imported rule").split(/\s+/).slice(0, 7).join(" ");
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function ensureLocalRulesConfig() {
  const rulesPath = localRulesConfigPath();
  fs.mkdirSync(path.dirname(rulesPath), { recursive: true });
  if (!fs.existsSync(rulesPath)) {
    fs.writeFileSync(
      rulesPath,
      `${JSON.stringify({ rules: localServer.policies }, null, 2)}\n`,
    );
  }
}

async function installLeashCli() {
  const binDir = path.join(os.homedir(), ".openleash", "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const scriptPath = path.join(binDir, "leash");
  fs.writeFileSync(
    scriptPath,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "$#" -lt 1 ]]; then
  echo "Usage: leash <agent> [args...]" >&2
  exit 2
fi
agent="$1"
shift
case "$agent" in
  claude|claude-code) exec claude "$@" ;;
  codex|openai-codex) exec codex "$@" ;;
  gemini) exec gemini "$@" ;;
  opencode) exec opencode "$@" ;;
  openclaw) exec openclaw "$@" ;;
  nanoclaw) exec nanoclaw "$@" ;;
  *) exec "$agent" "$@" ;;
esac
`,
  );
  fs.chmodSync(scriptPath, 0o755);
}

async function handleDesktopAuthCallback(rawUrl: string) {
  try {
    const callback = new URL(rawUrl);
    if (callback.protocol !== "openleash:" || callback.hostname !== "auth")
      return;
    const dashboardToken =
      callback.searchParams.get("dashboard_token") ||
      callback.searchParams.get("token");
    if (dashboardToken) {
      desktopAuthSession = {
        token: dashboardToken,
        apiUrl: normalizeRemoteApiUrl(
          callback.searchParams.get("api_url") || cloudApiUrl,
        ),
        expiresAt: callback.searchParams.get("expires_at") || undefined,
        organizationName:
          callback.searchParams.get("organization_name") || undefined,
        organizationSlug:
          callback.searchParams.get("organization_slug") || undefined,
        userName: callback.searchParams.get("user_name") || undefined,
        userEmail: callback.searchParams.get("user_email") || undefined,
      };
      restoreMainWindow();
      window?.webContents.send("openleash:auth", {
        ok: true,
        ...desktopAuthSession,
      });
      return;
    }
    const code = callback.searchParams.get("code");
    if (!code || !pendingDesktopAuth) {
      window?.webContents.send("openleash:auth", {
        ok: false,
        error: "Sign-in did not return a usable authorization code.",
      });
      return;
    }
    const response = await fetch(
      new URL("/v1/mobile/auth/exchange", pendingDesktopAuth.apiUrl),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...apiVersionHeaders("mobileAuthExchange"),
        },
        body: JSON.stringify({
          redirectUri:
            pendingDesktopAuth.exchangeRedirectUri || desktopRedirectUri,
          authorizationCode: code,
          providerType: pendingDesktopAuth.providerType,
          organizationId: pendingDesktopAuth.organizationId,
          organizationSlug: pendingDesktopAuth.organizationSlug,
          audience: pendingDesktopAuth.audience ?? "individual",
        }),
      },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      window?.webContents.send("openleash:auth", {
        ok: false,
        error:
          body.message || body.error || "OpenLeash could not finish sign-in.",
      });
      return;
    }
    const token =
      body.token ||
      body.sessionToken ||
      body.session?.token ||
      body.tokens?.accessToken;
    if (!token) {
      window?.webContents.send("openleash:auth", {
        ok: false,
        error: "The API did not return a client session token.",
      });
      return;
    }
    desktopAuthSession = {
      token,
      apiUrl: pendingDesktopAuth.apiUrl,
      expiresAt: body.tokens?.expiresAt,
      organizationName:
        body.organization?.name || body.session?.organization?.name,
      organizationSlug:
        body.organization?.slug ||
        body.session?.organization?.slug ||
        pendingDesktopAuth.organizationSlug,
      userName:
        body.user?.display_name ||
        body.user?.name ||
        body.session?.user?.display_name ||
        body.session?.user?.name,
      userEmail: body.user?.email || body.session?.user?.email,
    };
    pendingDesktopAuth = undefined;
    restoreMainWindow();
    window?.webContents.send("openleash:auth", {
      ok: true,
      ...desktopAuthSession,
    });
  } catch (error) {
    window?.webContents.send("openleash:auth", {
      ok: false,
      error: "OpenLeash could not process the sign-in callback.",
    });
  }
}

function compactSummary(value: string) {
  const words = value
    .replace(/^(Allowed|Blocked|Needs approval)\s*·\s*/i, "")
    .replace(/\s+in\s+\/.*$/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 7);
  return words.length === 0 ? "Recently active..." : `${words.join(" ")}...`;
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}...`;
}

function formatAgentMenuSublabel(agent: AgentStatus) {
  return `${agent.decision ?? "active"} · ${timeAgo(agent.activity_at ?? agent.last_seen_at)}`;
}

function agentProtectionSublabel(agent: LocalAgentProtection) {
  if (!agent.installed) return agent.detail || "Not installed";
  if (!agent.supportsInstall)
    return agent.detail || "Protection not supported yet";
  if (!agent.protected) return agent.detail || "Ready to protect";
  return agent.approvalHandoff
    ? "Protected · OpenLeash approvals primary"
    : "Protected";
}

function agentProtectionMenuItem(
  agent: LocalAgentProtection,
): MenuItemConstructorOptions {
  const canToggle = agent.installed && agent.supportsInstall;
  const unavailableLabel = !agent.installed
    ? "Not installed"
    : agent.detail || "Protection not supported yet";

  return {
    label: agent.displayName,
    sublabel: agentProtectionSublabel(agent),
    enabled: agent.installed,
    submenu: canToggle
      ? [
          {
            label: "Protected",
            type: "radio",
            checked: agent.protected,
            click: async () => {
              if (agent.protected) return;
              await protectAgentKind(agent.kind);
              refreshMenu(true);
            },
          },
          {
            label: "Unprotected",
            type: "radio",
            checked: !agent.protected,
            click: async () => {
              if (!agent.protected) return;
              await unprotectAgentKind(agent.kind);
              refreshMenu(true);
            },
          },
        ]
      : [{ label: unavailableLabel, enabled: false }],
  };
}

function timeAgo(value?: string) {
  if (!value) return "now";
  const date = new Date(value);
  const seconds = Math.max(1, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function createTrayIcon(status: "ok" | "pending" | "down") {
  const image = nativeImage
    .createFromPath(path.join(here, "tray-icon.png"))
    .resize({ width: 22, height: 22 });
  if (image.isEmpty()) {
    const color =
      status === "ok"
        ? "#11795f"
        : status === "pending"
          ? "#a76800"
          : "#bc2d3f";
    return nativeImage.createFromDataURL(createBadgeSvg(color));
  }
  image.setTemplateImage(false);
  return image;
}

function createBadgeSvg(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <rect width="64" height="64" fill="none"/>
    <g transform="translate(7 7) scale(1.45)">
      <path d="M8 8c0 4.4 3.6 8 8 8s8-3.6 8-8" stroke="#F7F8FA" stroke-width="2.8" stroke-linecap="round" fill="none"/>
      <path d="M8 17c0 4.4 3.6 8 8 8s8-3.6 8-8" stroke="#F7F8FA" stroke-width="2.8" stroke-linecap="round" opacity=".72" fill="none"/>
      <circle cx="26" cy="8" r="3.4" fill="#F7F8FA"/>
    </g>
    <circle cx="47" cy="17" r="7" fill="${color}" stroke="white" stroke-width="3"/>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
