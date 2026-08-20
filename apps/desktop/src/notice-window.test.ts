import assert from "node:assert/strict";
import test from "node:test";
import { clampNoticeWindowSize, isPointInNoticeBounds } from "./notice-window";

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

test("only the visible island is interactive inside its transparent window", () => {
  const windowBounds = { x: 500, y: 0 };
  const interactiveBounds = { x: 96, y: 0, width: 286, height: 46 };
  assert.equal(isPointInNoticeBounds({ x: 700, y: 20 }, windowBounds, interactiveBounds), true);
  assert.equal(isPointInNoticeBounds({ x: 700, y: 66 }, windowBounds, interactiveBounds), false);
  assert.equal(isPointInNoticeBounds({ x: 520, y: 20 }, windowBounds, interactiveBounds), false);
});
