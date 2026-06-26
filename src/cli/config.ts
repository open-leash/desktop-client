import fs from "node:fs/promises";
import { openLeashConfigPath, openLeashDir } from "./paths.js";
import { OPENLEASH_DESKTOP_API_URL, OPENLEASH_PUBLIC_CLOUD_API_URL } from "../public-config.js";

export type LocalConfig = {
  apiUrl: string;
  token: string;
  mode?: "community" | "cloud" | "enterprise" | "personal" | "private";
  tenantUrl?: string;
  remoteApiUrl?: string;
  enrolledAt?: string;
  clientVersion?: string;
  user?: {
    email?: string;
    displayName?: string;
  };
  computer?: {
    id?: string;
    hostname?: string;
  };
};

export const defaultDesktopApiUrl = OPENLEASH_DESKTOP_API_URL;
export const defaultCloudApiUrl = OPENLEASH_PUBLIC_CLOUD_API_URL;

export function hookApiUrl(config: Pick<LocalConfig, "apiUrl" | "remoteApiUrl">) {
  return (config.remoteApiUrl || config.apiUrl).replace(/\/+$/, "");
}

export async function readConfig(): Promise<LocalConfig> {
  const raw = await fs.readFile(openLeashConfigPath, "utf8");
  return JSON.parse(raw) as LocalConfig;
}

export async function writeConfig(config: LocalConfig) {
  await fs.mkdir(openLeashDir, { recursive: true });
  await fs.writeFile(openLeashConfigPath, `${JSON.stringify(config, null, 2)}\n`);
}
