import assert from "node:assert/strict";
import test from "node:test";
import { clampNoticeWindowSize } from "./notice-window";

test("keeps the full expanded island size on Windows", () => {
  assert.deepEqual(clampNoticeWindowSize({ width: 732, height: 700 }), {
    width: 732,
    height: 700,
  });
});

test("clamps malformed or oversized renderer requests", () => {
  assert.deepEqual(clampNoticeWindowSize({ width: 5000, height: 5000 }), {
    width: 780,
    height: 760,
  });
  assert.deepEqual(clampNoticeWindowSize({ width: 0, height: 0 }, 300), {
    width: 300,
    height: 52,
  });
});
