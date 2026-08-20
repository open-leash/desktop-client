update plugin_marketplace
set repository_url = case plugin_id
  when 'openleash.prompt-compression' then 'https://github.com/open-leash/plugin-token-saver'
  when 'openleash.skill-scanner' then 'https://github.com/open-leash/plugin-skill-scanner'
  when 'openleash.dlp' then 'https://github.com/open-leash/plugin-data-leakage-prevention'
  when 'openleash.sensitive-access' then 'https://github.com/open-leash/plugin-sensitive-access'
  when 'openleash.blast-radius' then 'https://github.com/open-leash/plugin-blast-radius'
  when 'openleash.rules-enforcer' then 'https://github.com/open-leash/plugin-rules-enforcer'
  when 'openleash.mcp-scanner' then 'https://github.com/open-leash/plugin-mcp-scanner'
  when 'openleash.siem-exporter' then 'https://github.com/open-leash/plugin-siem-exporter'
  else repository_url
end,
updated_at = now()
where plugin_id in (
  'openleash.prompt-compression',
  'openleash.skill-scanner',
  'openleash.dlp',
  'openleash.sensitive-access',
  'openleash.blast-radius',
  'openleash.rules-enforcer',
  'openleash.mcp-scanner',
  'openleash.siem-exporter'
)
and (
  repository_url is null
  or repository_url = ''
  or repository_url = 'https://github.com/open-leash/open-leash'
  or repository_url = 'https://github.com/open-leash/plugins'
);
