import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataset = JSON.parse(fs.readFileSync(path.join(root, "extension/data/bundled.json"), "utf8"));
const bridgeSource = fs.readFileSync(path.join(root, "extension/content/bridge.js"), "utf8");
const listeners = new Map();
const itemLabel = { nodeType: 3, nodeValue: "Item Level", parentElement: null };
const requiresLabel = { nodeType: 3, nodeValue: "Requires:", parentElement: null };
const evasionSummary = { nodeType: 3, nodeValue: "Evasion: 69", parentElement: null };
const armourSummary = { nodeType: 3, nodeValue: "Armour: 1,234", parentElement: null };
const energyShieldSummary = { nodeType: 3, nodeValue: "Energy Shield: 33", parentElement: null };
const wardSummary = { nodeType: 3, nodeValue: "Ward: 120", parentElement: null };
const basePercentileSummary = { nodeType: 3, nodeValue: "Base Percentile: 87%", parentElement: null };
const unknownResultText = { nodeType: 3, nodeValue: "Unverified Stat: 12", parentElement: null };
const popup = {
  nodeType: 1,
  closest(selector) { return selector.includes("itemPopup") ? this : null; },
  querySelectorAll() { return []; },
};
itemLabel.parentElement = popup;
requiresLabel.parentElement = popup;
evasionSummary.parentElement = popup;
armourSummary.parentElement = popup;
energyShieldSummary.parentElement = popup;
wardSummary.parentElement = popup;
basePercentileSummary.parentElement = popup;
unknownResultText.parentElement = popup;
const body = {
  nodeType: 1,
  closest() { return null; },
  querySelectorAll() { return []; },
};
const documentElement = { dataset: {}, setAttribute() {} };
const configNode = { textContent: JSON.stringify({ dataset, enabled: true, mode: "bilingual" }) };
const document = {
  readyState: "complete",
  body,
  head: { append() {} },
  documentElement,
  getElementById(id) { return id === "poe2zh-shared-config" ? configNode : null; },
  addEventListener(name, callback) { listeners.set(name, callback); },
  removeEventListener(name, callback) { if (listeners.get(name) === callback) listeners.delete(name); },
  dispatchEvent() {},
  createTreeWalker() {
    const nodes = [
      itemLabel,
      requiresLabel,
      evasionSummary,
      armourSummary,
      energyShieldSummary,
      wardSummary,
      basePercentileSummary,
      unknownResultText,
    ];
    let index = 0;
    return { nextNode() { return nodes[index++] ?? null; } };
  },
};
const chrome = {
  runtime: {
    id: "test-extension",
    async sendMessage(message) {
      if (message.type === "POE2ZH_GET_DATASET") return { ok: true, dataset };
      return null;
    },
  },
  storage: {
    sync: { async get(defaults) { return defaults; } },
    onChanged: { addListener() {} },
  },
};
const context = vm.createContext({
  chrome,
  clearTimeout,
  console,
  document,
  Event: class Event { constructor(type) { this.type = type; } },
  MutationObserver: class MutationObserver { observe() {} disconnect() {} },
  Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
  NodeFilter: { SHOW_TEXT: 4 },
  setTimeout,
});

vm.runInContext(
  fs.readFileSync(path.join(root, "extension/shared/missing-report-policy.js"), "utf8"),
  context,
  { filename: "missing-report-policy.js" },
);
vm.runInContext(
  fs.readFileSync(path.join(root, "extension/shared/result-label-policy.js"), "utf8"),
  context,
  { filename: "result-label-policy.js" },
);
vm.runInContext(bridgeSource, context, { filename: "bridge.js" });
await new Promise((resolve) => setTimeout(resolve, 0));

assert.equal(itemLabel.nodeValue, "物品等級 (Item Level)");
assert.equal(requiresLabel.nodeValue, "需求 (Requires):");
assert.equal(evasionSummary.nodeValue, "閃避 (Evasion): 69");
assert.equal(armourSummary.nodeValue, "護甲 (Armour): 1,234");
assert.equal(energyShieldSummary.nodeValue, "能量護盾 (Energy Shield): 33");
assert.equal(wardSummary.nodeValue, "保護 (Ward): 120");
assert.equal(basePercentileSummary.nodeValue, "基礎百分位 (Base Percentile): 87%");
assert.equal(unknownResultText.nodeValue, "Unverified Stat: 12");
console.log("item-label-dom-smoke-test: ok");
