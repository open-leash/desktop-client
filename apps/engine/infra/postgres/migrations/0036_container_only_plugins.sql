-- First-party plugins are isolated OCI workers; no in-process runtime remains.
with plugin_runtime(plugin_id, slug, current_version, failure_mode, edge_port) as (
  values
    ('openleash.blast-radius', 'blast-radius', '1.0.2', 'closed', 9351),
    ('openleash.sensitive-access', 'sensitive-access', '1.0.0', 'closed', 9352),
    ('openleash.dlp', 'data-leakage-prevention', '1.0.0', 'closed', 9353),
    ('openleash.rules-enforcer', 'rules-enforcer', '1.0.0', 'closed', 9354),
    ('openleash.mcp-scanner', 'mcp-scanner', '1.0.0', 'closed', 9355),
    ('openleash.code-scanner', 'code-scanner', '1.0.0', 'closed', 9356),
    ('openleash.skill-scanner', 'skill-scanner', '1.0.2', 'closed', 9357),
    ('openleash.siem-exporter', 'siem-exporter', '1.0.0', 'open', 9358)
)
update plugin_marketplace pm
set runtime = 'container',
    entrypoint = 'container',
    version = runtime.current_version,
    execution = jsonb_build_object(
      'type', 'container',
      'placement', 'either',
      'protocol', 'openleash-container-plugin.v1',
      'image', 'ghcr.io/open-leash/plugin-' || runtime.slug || ':' || runtime.current_version,
      'healthPath', '/healthz',
      'eventPath', '/v1/events',
      'edgePort', runtime.edge_port,
      'timeoutMs', 30000,
      'failureMode', runtime.failure_mode,
      'isolation', 'shared-trusted',
      'resources', jsonb_build_object('memoryMb', 256, 'cpuShares', 256),
      'storage', jsonb_build_object('persistent', false)
    ),
    updated_at = now()
from plugin_runtime runtime
where pm.plugin_id = runtime.plugin_id;

with plugin_runtime(plugin_id, slug, failure_mode, edge_port) as (
  values
    ('openleash.blast-radius', 'blast-radius', 'closed', 9351),
    ('openleash.sensitive-access', 'sensitive-access', 'closed', 9352),
    ('openleash.dlp', 'data-leakage-prevention', 'closed', 9353),
    ('openleash.rules-enforcer', 'rules-enforcer', 'closed', 9354),
    ('openleash.mcp-scanner', 'mcp-scanner', 'closed', 9355),
    ('openleash.code-scanner', 'code-scanner', 'closed', 9356),
    ('openleash.skill-scanner', 'skill-scanner', 'closed', 9357),
    ('openleash.siem-exporter', 'siem-exporter', 'open', 9358)
)
update plugin_releases release
set runtime = 'container',
    entrypoint = 'container',
    execution = jsonb_build_object(
      'type', 'container',
      'placement', 'either',
      'protocol', 'openleash-container-plugin.v1',
      'image', 'ghcr.io/open-leash/plugin-' || runtime.slug || ':' || release.version,
      'healthPath', '/healthz',
      'eventPath', '/v1/events',
      'edgePort', runtime.edge_port,
      'timeoutMs', 30000,
      'failureMode', runtime.failure_mode,
      'isolation', 'shared-trusted',
      'resources', jsonb_build_object('memoryMb', 256, 'cpuShares', 256),
      'storage', jsonb_build_object('persistent', false)
    ),
    updated_at = now()
from plugin_runtime runtime
where release.plugin_id = runtime.plugin_id;
