import {
  FIRST_PARTY_PLUGIN_MANIFESTS,
  type OpenLeashPluginManifest,
} from "@openleash/shared";

export const promptCompressionManifest = FIRST_PARTY_PLUGIN_MANIFESTS.find(
  (plugin) => plugin.id === "openleash.prompt-compression",
) as OpenLeashPluginManifest;
