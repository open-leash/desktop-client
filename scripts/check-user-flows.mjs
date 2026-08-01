#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";

const read = (path) => fs.readFileSync(path, "utf8");
const scopeFlagIndex = process.argv.indexOf("--scope");
const scope = scopeFlagIndex >= 0 ? process.argv[scopeFlagIndex + 1] : "full";
if (!new Set(["public", "full"]).has(scope)) {
  console.error("Usage: check-user-flows.mjs [--scope public|full]");
  process.exit(2);
}

const hostedCompositionPrefixes = ["apps/main-web/", "apps/cloud-dashboard-web/"];

const checks = [
  {
    path: "docs/USER_FLOWS.md",
    text: "Solo developers never see the organization-admin/CISO dashboard.",
    reason: "canonical solo dashboard invariant"
  },
  {
    path: "docs/Product.md",
    text: "Public cloud BYOK clarification",
    reason: "Product.md is the BYOK source of truth"
  },
  {
    path: "docs/Product.md",
    text: "Individual Open Source mode",
    reason: "Product.md includes the local open-source individual mode"
  },
  {
    path: "docs/USER_FLOWS.md",
    text: "Solo Dev - Individual Open Source",
    reason: "canonical Individual Open Source flow"
  },
  {
    path: "docs/USER_FLOWS.md",
    text: "It must not reintroduce SQLite",
    reason: "Individual Open Source forbids the old partial local backend"
  },
  {
    path: "docs/Product.md",
    text: "Individual BYOK: free",
    reason: "Product.md individual BYOK package"
  },
  {
    path: "docs/Product.md",
    text: "Organization BYOK: free up to 5 users, then $5 per user per month after that",
    reason: "Product.md organization BYOK package and free tier"
  },
  {
    path: "docs/USER_FLOWS.md",
    text: "You're setting up a team - continue onboarding in the dashboard",
    reason: "org cloud dashboard handoff"
  },
  {
    path: "docs/USER_FLOWS.md",
    text: "work Google Workspace or Microsoft 365 / Entra ID account",
    reason: "org cloud identity-first signup"
  },
  {
    path: "docs/USER_FLOWS.md",
    text: "First launch of the Private Cloud dashboard starts bootstrap.",
    reason: "private cloud bootstrap"
  },
  {
    path: "AGENTS.md",
    text: "docs/USER_FLOWS.md",
    reason: "agent memory pointer"
  },
  {
    path: "package.json",
    text: "\"dev:mode:individual-open-source\": \"python3 run.py --mode individual-open-source\"",
    reason: "Individual Open Source runner script goes through run.py"
  },
  {
    path: "package.json",
    text: "\"dev:mode:self-hosted\": \"python3 run.py --mode private-cloud\"",
    reason: "Private Cloud runner script goes through run.py"
  },
  {
    path: "package.json",
    text: "\"dev:mode:cloud\": \"python3 run.py --mode public-cloud\"",
    reason: "OpenLeash Cloud runner script goes through run.py"
  },
  {
    path: "scripts/run-openleash.py",
    text: "Product contract: desktop-client requires Individual Open Source, OpenLeash Cloud, or Private Cloud backend.",
    reason: "interactive runner explains the backend-required mode contract"
  },
  {
    path: "scripts/run-openleash.py",
    text: "def choose_run_questionnaire()",
    reason: "run.py defaults to an interactive questionnaire"
  },
  {
    path: "scripts/run-openleash.py",
    text: "What do you want to run?",
    reason: "run.py asks for the target mode"
  },
  {
    path: "scripts/run-openleash.py",
    text: "Start from a fully clean local OpenLeash environment?",
    reason: "run.py asks whether each run should start from a full clean local environment"
  },
  {
    path: "scripts/run-openleash.py",
    text: "docker\", \"compose\", \"down\", \"-v\", \"--remove-orphans\"",
    reason: "run.py cleanup removes Compose containers and the dev database volume"
  },
  {
    path: "scripts/run-openleash.py",
    text: "docker\", \"compose\", \"down\", \"--remove-orphans\"",
    reason: "run.py clears stale Compose containers before starting a mode"
  },
  {
    path: "scripts/run-openleash.py",
    text: "Real OAuth",
    reason: "run.py defaults to real OAuth while keeping dev auth explicit"
  },
  {
    path: "scripts/run-openleash.py",
    text: "choices=list(USER_MODE_ALIASES.keys())",
    reason: "run.py supports backend-backed Product.md modes"
  },
  {
    path: "scripts/run-openleash.py",
    text: "\"OPENLEASH_DEPLOYMENT_MODE\": \"individual-open-source\"",
    reason: "runner has an Individual Open Source local backend mode"
  },
  {
    path: "scripts/install-openleash-personal.sh",
    text: "--open-source             Install local Individual Open Source backend with Docker.",
    reason: "installer exposes Individual Open Source install"
  },
  {
    path: "scripts/install-openleash-personal.sh",
    text: "client-api:${OPENLEASH_VERSION:-",
    reason: "installer starts the published client-api image"
  },
  {
    path: "deploy/docker/individual-open-source.compose.yml",
    text: "OPENLEASH_DEPLOYMENT_MODE: individual-open-source",
    reason: "Individual Open Source compose uses the local open-source backend mode"
  },
  {
    path: "scripts/docker-images.mjs",
    text: "dashboard-web",
    reason: "docker image publisher includes dashboard web"
  },
  {
    path: "migrate.py",
    text: "Status is read-only. Apply is explicit.",
    reason: "migrate.py is the explicit operator entrypoint for database changes"
  },
  {
    path: "scripts/run-openleash.py",
    text: "\"--slug\", \"openleash-cloud\"",
    reason: "OpenLeash Cloud runner seeds a cloud development organization"
  },
  {
    path: "scripts/run-openleash.py",
    text: "\"--slug\", \"self-hosted\"",
    reason: "Private Cloud runner seeds a private development organization"
  },
  {
    path: "apps/desktop-client/src/main.ts",
    text: "clientMode === \"cloud\" && audience === \"organization\"",
    reason: "solo cloud must not open dashboard"
  },
  {
    path: "apps/desktop-client/src/window.html",
    text: "audience: setupAudience",
    reason: "desktop setup sends audience to main process"
  },
  {
    path: "apps/desktop-client/src/window.html",
    text: "startOrgCloudOnboarding",
    reason: "desktop org public cloud hands off to dashboard sign-up"
  },
  {
    path: "apps/desktop-client/src/window.html",
    text: "orgCloud ? [",
    reason: "desktop org public cloud does not continue into agents/rules"
  },
  {
    path: "apps/desktop-client/src/window.html",
    text: "orgCloudMicrosoft",
    reason: "desktop org public cloud offers Microsoft 365 handoff"
  },
  {
    path: "apps/main-web/components/redesign/site.jsx",
    text: "href=\"/account\"",
    reason: "marketing entry stays on marketing account surface"
  },
  {
    path: "apps/main-web/app/account/AccountClient.tsx",
    text: "Solo accounts stay in the personal OpenLeash surface.",
    reason: "solo web account flow blocks dashboard drift"
  },
  {
    path: "apps/main-web/components/redesign/PricingSection.jsx",
    text: "$5/user/mo after",
    reason: "main website org BYOK is free up to 5 and then $5/user/month"
  },
  {
    path: "apps/main-web/app/account/AccountClient.tsx",
    text: "price: \"Free up to 5, then $5/user/mo\"",
    reason: "account org BYOK is free up to 5 and then $5/user/month"
  },
  {
    path: "apps/main-web/app/account/AccountClient.tsx",
    text: "OpenLeash Cloud stores it encrypted and invokes evaluation from the cloud",
    reason: "personal BYOK account explains cloud-side evaluation"
  },
  {
    path: "apps/dashboard-web/components/DashboardSettings.tsx",
    text: "Save evaluation key",
    reason: "organization dashboard can configure BYOK evaluation key"
  },
  {
    path: "apps/client-api/src/server.ts",
    text: "app.post(\"/admin/evaluation-key\"",
    reason: "organization BYOK evaluation key API exists"
  },
  {
    path: "apps/client-api/src/model-keys.ts",
    text: "tenantModelKey",
    reason: "tenant model key is stored as encrypted organization config"
  },
  {
    path: "apps/mobile-client/lib/main.dart",
    text: "_audience = 'individual'",
    reason: "mobile asks individual vs organization"
  },
  {
    path: "apps/mobile-client/lib/main.dart",
    text: "_audience = 'organization'",
    reason: "mobile org cloud hands off to dashboard"
  },
  {
    path: "apps/dashboard-web/components/DashboardAuth.tsx",
    text: "isDashboardRole",
    reason: "dashboard is admin/CISO surface only"
  },
  {
    path: "apps/client-api/src/server.ts",
    text: "audience === \"organization\" ? \"admin\" : \"engineer\"",
    reason: "public cloud auth separates org admins from solo users"
  },
  {
    path: "apps/client-api/src/server.ts",
    text: "requestPath === \"/v1/mobile/auth/exchange\"",
    reason: "dashboard cloud auth callback can exchange sign-in code"
  },
  {
    path: "apps/client-api/src/server.ts",
    text: "requestPath === \"/v1/auth/google/callback\"",
    reason: "real public-cloud Google callback is allowed on the dashboard surface"
  },
  {
    path: "apps/client-api/src/server.ts",
    text: "cloudMicrosoftConfig",
    reason: "public cloud supports Microsoft 365 org sign-in"
  },
  {
    path: "apps/dashboard-web/components/TenantEntry.tsx",
    text: "Continue with Microsoft 365",
    reason: "dashboard org entry is identity-first"
  },
  {
    path: "apps/cloud-dashboard-web/app/[slug]/page.tsx",
    text: "setupCompleted?: boolean",
    reason: "cloud dashboard tenant page reads organization setup state"
  },
  {
    path: "apps/cloud-dashboard-web/app/auth/cloud/CloudGoogleCallback.tsx",
    text: "const destination = next || (setupCompleted ? `/${encodeURIComponent(slug)}` : \"/onboarding\")",
    reason: "public cloud sign-up lands unfinished orgs in onboarding"
  }
];

let failed = false;

for (const check of checks) {
  if (scope === "public" && hostedCompositionPrefixes.some((prefix) => check.path.startsWith(prefix))) continue;
  const body = read(check.path);
  if (!body.includes(check.text)) {
    failed = true;
    console.error(`[flows] missing ${check.reason} in ${check.path}`);
  }
}

if (failed) process.exit(1);

console.log(`[flows] canonical platform flows are documented and guarded (${scope}).`);
