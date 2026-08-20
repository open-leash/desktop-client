alter table plugin_marketplace
  drop column if exists install_count,
  drop column if exists download_count,
  drop column if exists weekly_download_count,
  drop column if exists trend_percent,
  drop column if exists rating,
  drop column if exists rating_count;
