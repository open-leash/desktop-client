-- SIEM is an organization audit-export capability, not a personal Feature.
-- Preserve historical runs/logs for audit continuity, but remove every active
-- Feature setting and catalog/configuration surface from personal runtimes.
delete from plugin_island_contributions where plugin_id = 'openleash.siem-exporter';
delete from plugin_state where plugin_id = 'openleash.siem-exporter';
delete from user_plugin_settings where plugin_id = 'openleash.siem-exporter';
delete from plugin_settings where plugin_id = 'openleash.siem-exporter';
delete from plugin_releases where plugin_id = 'openleash.siem-exporter';
delete from plugin_submissions where plugin_id = 'openleash.siem-exporter';
delete from plugin_marketplace where plugin_id = 'openleash.siem-exporter';
