import assert from "node:assert/strict";
import test from "node:test";
import { modelConfigFor } from "./evaluator.js";

test("BYOK accounts without a key do not fall back to the managed Leash key", () => {
  const config = modelConfigFor(
    {
      provider: "openai",
      apiKey: "",
      masked: "",
      fingerprint: "",
      updatedAt: "",
      managedFallback: false,
    },
    { OPENLEASH_OPENAI_API_KEY: "managed-secret" },
  );
  assert.equal(config, undefined);
});

test("managed accounts use the managed Leash evaluation key", () => {
  const config = modelConfigFor(undefined, {
    OPENLEASH_OPENAI_API_KEY: "managed-secret",
  });
  assert.equal(config?.source, "openleash-managed");
  assert.equal(config?.apiKey, "managed-secret");
});
