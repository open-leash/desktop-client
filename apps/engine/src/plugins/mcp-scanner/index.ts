import type { PluginCapabilities } from "@openleash/shared";
import { mcpToolCallFromEvent } from "@openleash/shared";
import { mcpScannerManifest as manifest } from "./manifest.js";
import { pluginRun, type EvaluationPipelineInput } from "../types.js";

export { manifest };

export async function runMcpScanner(input: EvaluationPipelineInput, capabilities: PluginCapabilities) {
  const startedAt = Date.now();
  const call = mcpToolCallFromEvent(input.request.event);
  if (call) {
    await capabilities.signals.emit({
      kind: "mcp.discovery",
      severity: "info",
      title: "MCP tool call observed",
      summary: call.argumentSummary || call.fullToolName,
      decision: "observed",
      status: "observed",
      target: {
        type: "mcp_tool",
        name: call.fullToolName
      },
      details: {
        serverName: call.serverName,
        toolName: call.toolName,
        argumentSummary: call.argumentSummary
      },
      correlationKeys: [`mcp:${call.serverName}`, `mcp-tool:${call.fullToolName}`]
    });
  }
  return {
    call,
    run: pluginRun({
      pluginId: manifest.id,
      event: input.request.event.eventName === "PostToolUse" ? "tool.afterUse" : "tool.beforeUse",
      status: call ? "passed" : "skipped",
      summary: call
        ? `Observed MCP tool ${call.fullToolName}.`
        : "No MCP tool call was found in this event.",
      startedAt,
      findings: call ? [{
        title: "MCP tool call observed",
        severity: "info",
        summary: call.argumentSummary || call.fullToolName,
        evidence: [call.fullToolName]
      }] : undefined,
      metadata: call ? {
        serverName: call.serverName,
        toolName: call.toolName
      } : undefined
    })
  };
}
