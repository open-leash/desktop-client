update plugin_marketplace
set icon_text = case slug
  when 'token-saver' then '✂️'
  when 'blast-radius' then '💥'
  when 'data-leakage-prevention' then '🤫'
  when 'mcp-scanner' then '📡'
  when 'rules-enforcer' then '📏'
  when 'sensitive-access' then '🔐'
  when 'siem-exporter' then '📤'
  when 'skill-scanner' then '🕵️'
  else icon_text
end,
updated_at = now()
where slug in (
  'token-saver',
  'blast-radius',
  'data-leakage-prevention',
  'mcp-scanner',
  'rules-enforcer',
  'sensitive-access',
  'siem-exporter',
  'skill-scanner'
);
