import {
  FIRST_PARTY_PLUGIN_MANIFESTS,
  type OpenLeashPluginManifest,
  type PipelineEvent,
} from "@openleash/shared";
import { codeScannerManifest } from "./code-scanner/manifest.js";

export const firstPartyPluginManifests = orderPlugins([
  ...FIRST_PARTY_PLUGIN_MANIFESTS,
  codeScannerManifest,
]);

export function pluginsForEvent(event: PipelineEvent) {
  return firstPartyPluginManifests.filter((plugin) =>
    plugin.events.includes(event),
  );
}

export function pluginSupportsAgent(
  plugin: OpenLeashPluginManifest,
  agentKind?: string,
) {
  const agentKinds = (
    plugin as OpenLeashPluginManifest & { agentKinds?: string[] }
  ).agentKinds;
  return (
    !agentKinds?.length || Boolean(agentKind && agentKinds.includes(agentKind))
  );
}

export function orderPlugins(plugins: OpenLeashPluginManifest[]) {
  const byId = new Map(plugins.map((plugin) => [plugin.id, plugin]));
  const edges = new Map<string, Set<string>>();
  for (const plugin of plugins) edges.set(plugin.id, new Set());

  for (const plugin of plugins) {
    for (const before of plugin.ordering?.before ?? []) {
      if (byId.has(before)) edges.get(plugin.id)?.add(before);
    }
    for (const after of plugin.ordering?.after ?? []) {
      if (byId.has(after)) edges.get(after)?.add(plugin.id);
    }
  }

  const incoming = new Map<string, number>();
  for (const plugin of plugins) incoming.set(plugin.id, 0);
  for (const nextIds of edges.values()) {
    for (const nextId of nextIds)
      incoming.set(nextId, (incoming.get(nextId) ?? 0) + 1);
  }

  const queue = plugins
    .filter((plugin) => (incoming.get(plugin.id) ?? 0) === 0)
    .sort(comparePriority);
  const ordered: OpenLeashPluginManifest[] = [];

  while (queue.length > 0) {
    const plugin = queue.shift()!;
    ordered.push(plugin);
    for (const nextId of edges.get(plugin.id) ?? []) {
      incoming.set(nextId, (incoming.get(nextId) ?? 0) - 1);
      if (incoming.get(nextId) === 0) {
        queue.push(byId.get(nextId)!);
        queue.sort(comparePriority);
      }
    }
  }

  if (ordered.length !== plugins.length) {
    return [...plugins].sort(comparePriority);
  }

  return ordered;
}

function comparePriority(
  a: OpenLeashPluginManifest,
  b: OpenLeashPluginManifest,
) {
  return (
    (a.ordering?.priority ?? 1000) - (b.ordering?.priority ?? 1000) ||
    a.id.localeCompare(b.id)
  );
}
