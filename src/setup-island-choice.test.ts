import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const renderer = readFileSync(path.join(__dirname, "window.html"), "utf8");
const main = readFileSync(path.join(__dirname, "main.ts"), "utf8");

test("installation asks whether to enable the Island and shows the real preview", () => {
  assert.match(renderer, /title: "Island"/);
  assert.match(renderer, /Do you want the Island\?/);
  assert.match(renderer, /src="island-preview\.png"/);
  assert.match(renderer, /name="setupIsland" value="on"/);
  assert.match(renderer, /name="setupIsland" value="off"/);
  assert.match(renderer, /tray icon is always installed/i);
  assert.match(renderer, /currentId === "island" && typeof setupIslandEnabled !== "boolean"/);
  assert.match(renderer, /islandVisibility: setupIslandEnabled \? "always" : "off"/);
});

test("tray remains useful when the Island is disabled", () => {
  assert.match(main, /localServer\?\.islandVisibility === "off"\) restoreMainWindow\(\)/);
  assert.match(main, /localServer\.islandVisibility === "off" && !manualIslandReveal\) return/);
  assert.match(renderer, /Off, tray only/);
});
