import crypto from "node:crypto";
import { pool } from "./db.js";

export const TENANT_MODEL_PROVIDERS = ["openai", "anthropic", "deepseek"] as const;
export type TenantModelProvider = (typeof TENANT_MODEL_PROVIDERS)[number];

export type TenantModelKey = {
  provider: TenantModelProvider;
  apiKey: string;
  masked: string;
  fingerprint: string;
  updatedAt: string;
  managedFallback?: boolean;
};

type StoredTenantModelKey = Omit<TenantModelKey, "apiKey"> & {
  ciphertext: string;
  keyId: string;
};

export function normalizeTenantModelProvider(value: unknown): TenantModelProvider | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "claude") return "anthropic";
  return TENANT_MODEL_PROVIDERS.find((provider) => provider === normalized);
}

export async function upsertTenantModelKey({
  organizationId,
  provider,
  apiKey
}: {
  organizationId: string;
  provider: TenantModelProvider;
  apiKey: string;
}) {
  const updatedAt = new Date().toISOString();
  const fingerprint = crypto.createHash("sha256").update(`${provider}:${apiKey}`).digest("hex");
  const masked = maskApiKey(apiKey);
  const stored: StoredTenantModelKey = {
    provider,
    masked,
    fingerprint,
    updatedAt,
    ...encryptModelKey(apiKey)
  };
  const result = await pool.query(
    `update organizations
     set infrastructure_config = coalesce(infrastructure_config, '{}'::jsonb) || $2::jsonb,
         updated_at = now()
     where id = $1
     returning id, name, slug, infrastructure_config`,
    [
      organizationId,
      JSON.stringify({
        evaluationMode: "tenant-byok",
        tenantModelKey: stored,
        modelProvider: provider,
        modelKeyFingerprint: fingerprint,
        modelKeyMasked: masked,
        modelKeyUpdatedAt: updatedAt
      })
    ]
  );
  return { organization: result.rows[0], provider, masked, fingerprint, updatedAt };
}

export async function readTenantModelKey(organizationId: string): Promise<TenantModelKey | undefined> {
  const result = await pool.query(
    `select infrastructure_config from organizations where id = $1 limit 1`,
    [organizationId]
  );
  const stored = result.rows[0]?.infrastructure_config?.tenantModelKey as StoredTenantModelKey | undefined;
  if (!stored?.ciphertext || !normalizeTenantModelProvider(stored.provider)) return undefined;
  return {
    provider: stored.provider,
    apiKey: decryptModelKey(stored.ciphertext),
    masked: stored.masked,
    fingerprint: stored.fingerprint,
    updatedAt: stored.updatedAt
  };
}

export async function tenantModelKeySummary(organizationId: string) {
  const result = await pool.query(
    `select infrastructure_config from organizations where id = $1 limit 1`,
    [organizationId]
  );
  const config = result.rows[0]?.infrastructure_config ?? {};
  const provider = normalizeTenantModelProvider(config.modelProvider);
  const masked = typeof config.modelKeyMasked === "string" ? config.modelKeyMasked : undefined;
  const updatedAt = typeof config.modelKeyUpdatedAt === "string" ? config.modelKeyUpdatedAt : undefined;
  return provider && masked ? { connected: true, provider, masked, updatedAt } : { connected: false };
}

export async function deleteTenantModelKey(organizationId: string) {
  await pool.query(
    `update organizations
     set infrastructure_config = coalesce(infrastructure_config, '{}'::jsonb)
       - 'tenantModelKey'
       - 'modelProvider'
       - 'modelKeyFingerprint'
       - 'modelKeyMasked'
       - 'modelKeyUpdatedAt'
       || jsonb_build_object('evaluationMode', 'openleash-managed'),
         updated_at = now()
     where id = $1`,
    [organizationId]
  );
  return { ok: true };
}

function maskApiKey(apiKey: string) {
  if (apiKey.length <= 12) return `${apiKey.slice(0, 3)}...${apiKey.slice(-2)}`;
  return `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}`;
}

function encryptModelKey(apiKey: string) {
  const key = encryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    keyId: process.env.OPENLEASH_MODEL_KEY_ID ?? "default",
    ciphertext: Buffer.concat([iv, tag, encrypted]).toString("base64")
  };
}

function decryptModelKey(ciphertext: string) {
  const raw = Buffer.from(ciphertext, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function encryptionKey() {
  const secret = process.env.OPENLEASH_MODEL_KEY_ENCRYPTION_KEY ?? process.env.OPENLEASH_SECRET_KEY ?? "openleash-local-dev-model-key";
  return crypto.createHash("sha256").update(secret).digest();
}
