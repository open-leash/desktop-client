#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";

const mode = process.argv[2];
const dryRun = process.argv.includes("--dry-run");

const modes = {
  "self-hosted": {
    description: "Managed private-cloud/on-prem development. Customer-hosted client-api, dashboard-api, dashboard-web, and desktop client.",
    before: [
      {
        name: "postgres",
        command: "docker",
        args: ["compose", "up", "-d", "postgres"]
      },
      {
        name: "migrate",
        command: "npm",
        args: ["run", "db:migrate", "--", "--apply"]
      },
      {
        name: "seed-org",
        command: "npm",
        args: [
          "run",
          "db:create-org",
          "--",
          "--name",
          "OpenLeash Private Cloud Dev",
          "--slug",
          "self-hosted",
          "--mode",
          "private"
        ]
      }
    ],
    processes: managedProcesses({
      deploymentMode: "private",
      orgSlug: "self-hosted"
    })
  },
  cloud: {
    description: "OpenLeash Cloud simulation using local OSS services. Real hosted cloud-only adapters live outside this repo.",
    before: [
      {
        name: "postgres",
        command: "docker",
        args: ["compose", "up", "-d", "postgres"]
      },
      {
        name: "migrate",
        command: "npm",
        args: ["run", "db:migrate", "--", "--apply"]
      },
      {
        name: "seed-org",
        command: "npm",
        args: [
          "run",
          "db:create-org",
          "--",
          "--name",
          "OpenLeash Cloud Dev",
          "--slug",
          "openleash-cloud",
          "--mode",
          "cloud"
        ]
      }
    ],
    processes: managedProcesses({
      deploymentMode: "cloud",
      orgSlug: "openleash-cloud"
    })
  }
};

if (!mode || mode === "--help" || mode === "-h" || !modes[mode]) {
  printHelp();
  process.exit(mode && !modes[mode] && !mode.startsWith("-") ? 2 : 0);
}

const selected = modes[mode];
const children = new Set();
let shuttingDown = false;

console.log(`[openleash] ${mode}: ${selected.description}`);

try {
  for (const step of selected.before) {
    await runForeground(step);
  }

  if (dryRun) {
    console.log("[openleash] dry run complete. No long-running services were started.");
    process.exit(0);
  }

  for (const child of selected.processes) {
    runBackground(child);
  }

  console.log("[openleash] Press Ctrl+C to stop this mode.");
} catch (error) {
  console.error(`[openleash] ${error.message}`);
  stopChildren();
  process.exit(1);
}

process.on("SIGINT", () => {
  shuttingDown = true;
  stopChildren();
  process.exit(130);
});

process.on("SIGTERM", () => {
  shuttingDown = true;
  stopChildren();
  process.exit(143);
});

function managedProcesses({ deploymentMode, orgSlug }) {
  const commonEnv = {
    DATABASE_URL: "postgres://openleash:openleash@localhost:9543/openleash",
    OPENLEASH_DEPLOYMENT_MODE: deploymentMode,
    OPENLEASH_RELEASE_ADMIN_TOKEN: "dev-release-admin-token",
    OPENLEASH_DEV_ORG_SLUG: orgSlug,
    OPENLEASH_TENANT_DOMAIN: "openleash.com",
    OPENLEASH_MOBILE_DEV_AUTH: process.env.OPENLEASH_MOBILE_DEV_AUTH || "1",
    IDENTITY_LOADER_URL: "http://localhost:9321",
    ...(deploymentMode === "private" ? {
      OPENLEASH_MANAGED_MOBILE_ORG_NAME: "OpenLeash Private Cloud Dev",
      OPENLEASH_MANAGED_MOBILE_ORG_SLUG: orgSlug
    } : {})
  };
  const clientApiUrl = "http://127.0.0.1:9318";
  const dashboardApiUrl = "http://localhost:9319";
  const dashboardPort = deploymentMode === "cloud" ? "9302" : "9301";

  return [
    {
      name: "identity-loader",
      command: "dotnet",
      args: ["run", "--no-launch-profile"],
      cwd: "IdentityLoader/IdentityLoader",
      env: {
        DATABASE_URL: commonEnv.DATABASE_URL,
        ASPNETCORE_URLS: "http://localhost:9321",
        ASPNETCORE_ENVIRONMENT: "Development",
        DOTNET_ROLL_FORWARD: "Major",
        OPENLEASH_IDENTITY_LOADER_DEV_MOCK: process.env.OPENLEASH_IDENTITY_LOADER_DEV_MOCK || "1"
      }
    },
    {
      name: "client-api",
      command: "npm",
      args: ["run", "dev:client-api"],
      env: {
        ...commonEnv,
        OPENLEASH_API_PORT: "9318",
        OPENLEASH_API_SURFACE: "client"
      }
    },
    {
      name: "dashboard-api",
      command: "npm",
      args: ["run", "dev:dashboard-api"],
      env: {
        ...commonEnv,
        OPENLEASH_API_PORT: "9319",
        OPENLEASH_API_SURFACE: "dashboard"
      }
    },
    {
      name: "dashboard-web",
      command: "npm",
      args: ["run", "dev:dashboard-web"],
      env: {
        ...commonEnv,
        OPENLEASH_DASHBOARD_PORT: dashboardPort,
        OPENLEASH_API_URL: dashboardApiUrl,
        NEXT_PUBLIC_OPENLEASH_API_URL: dashboardApiUrl
      }
    },
    {
      name: "desktop-client",
      command: "npm",
      args: ["run", "desktop-client"],
      env: {
        OPENLEASH_CLIENT_MODE: deploymentMode === "cloud" ? "cloud" : "self-hosted",
        OPENLEASH_CLOUD_API_URL: clientApiUrl,
        OPENLEASH_CLOUD_DASHBOARD_URL: `http://localhost:${dashboardPort}`
      }
    }
  ];
}

function runForeground(step) {
  return new Promise((resolve, reject) => {
    if (dryRun) {
      console.log(`[openleash:${step.name}] ${formatCommand(step)}`);
      resolve();
      return;
    }

    console.log(`[openleash:${step.name}] ${formatCommand(step)}`);
    const child = spawn(step.command, step.args, {
      cwd: process.cwd(),
      env: { ...process.env, ...step.env },
      stdio: "inherit"
    });

    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${step.name} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`));
    });
    child.on("error", (error) => reject(error));
  });
}

function runBackground(step) {
  console.log(`[openleash:${step.name}] ${formatCommand(step)}`);
  const child = spawn(step.command, step.args, {
    cwd: step.cwd ?? process.cwd(),
    env: { ...process.env, ...step.env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  children.add(child);

  child.stdout.on("data", (chunk) => writePrefixed(step.name, chunk, process.stdout));
  child.stderr.on("data", (chunk) => writePrefixed(step.name, chunk, process.stderr));
  child.on("exit", (code, signal) => {
    children.delete(child);
    const reason = signal ? `signal ${signal}` : `exit ${code}`;
    console.log(`[openleash:${step.name}] stopped (${reason})`);
    if (!shuttingDown) {
      shuttingDown = true;
      stopChildren();
      process.exit(code ?? 1);
    }
    if (children.size === 0) process.exit(code ?? 0);
  });
  child.on("error", (error) => {
    console.error(`[openleash:${step.name}] ${error.message}`);
  });
}

function stopChildren() {
  for (const child of children) {
    child.kill("SIGTERM");
  }
}

function writePrefixed(name, chunk, stream) {
  const lines = String(chunk).split(/\r?\n/);
  for (const line of lines) {
    if (line.length > 0) stream.write(`[${name}] ${line}\n`);
  }
}

function formatCommand(step) {
  return [step.command, ...step.args].join(" ");
}

function printHelp() {
  console.log(`Usage:
  node scripts/dev-mode.mjs self-hosted [--dry-run]
  node scripts/dev-mode.mjs cloud [--dry-run]

Modes:
  self-hosted  local private-cloud/on-prem stack with Postgres
  cloud        local simulation of OpenLeash Cloud`);
}
