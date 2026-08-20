import assert from "node:assert/strict";
import test from "node:test";
import {
  activeAuditExportProviderId,
  configureAuditExportProvider,
  exportAuditLog,
  type AuditLogExport,
} from "./audit-export.js";
import { FIRST_PARTY_PLUGIN_MANIFESTS } from "@openleash/shared";

const logInput = {
  log: {
    pluginId: "openleash.core",
    level: "security",
    category: "system",
    code: "action-held-for-approval",
    message: "An action needs approval.",
    scope: "system",
    data: {},
    createdAt: "2026-08-07T00:00:00.000Z",
  },
  organization: { id: "org-test", name: "Test organization" },
} as AuditLogExport;

test.afterEach(() => configureAuditExportProvider());

test("personal runtimes use the disabled audit exporter", async () => {
  configureAuditExportProvider();
  assert.equal(activeAuditExportProviderId(), "disabled");
  assert.equal((await exportAuditLog(logInput)).status, "skipped");
});

test("SIEM is not present in the personal Feature catalog", () => {
  assert.equal(
    FIRST_PARTY_PLUGIN_MANIFESTS.some((feature) => feature.id === "openleash.siem-exporter"),
    false,
  );
});

test("organization runtimes can compose a typed audit exporter", async () => {
  let received: AuditLogExport | undefined;
  configureAuditExportProvider({
    id: "organization-siem",
    async exportDecision() {
      return { status: "delivered", summary: "delivered" };
    },
    async exportLog(input) {
      received = input;
      return { status: "delivered", summary: "delivered" };
    },
  });

  const result = await exportAuditLog(logInput);
  assert.equal(activeAuditExportProviderId(), "organization-siem");
  assert.equal(result.status, "delivered");
  assert.equal(received?.organization.id, "org-test");
});

test("audit delivery failures never replace the enforcement decision", async () => {
  configureAuditExportProvider({
    id: "broken-siem",
    async exportDecision() {
      throw new Error("SIEM unavailable");
    },
    async exportLog() {
      throw new Error("SIEM unavailable");
    },
  });

  const result = await exportAuditLog(logInput);
  assert.deepEqual(result, { status: "failed", summary: "SIEM unavailable" });
});
