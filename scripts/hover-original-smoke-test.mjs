import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "extension/page/hover-originals.js"), "utf8");
const tooltipSource = fs.readFileSync(
  path.join(root, "extension/content/original-tooltip.js"),
  "utf8",
);
const emitted = [];
let transportNode = null;

const document = {
  head: {
    append(node) {
      transportNode = node;
    },
  },
  documentElement: { append() {} },
  getElementById() {
    return transportNode;
  },
  createElement() {
    return { id: "", type: "", hidden: false, textContent: "" };
  },
  dispatchEvent() {
    emitted.push(JSON.parse(transportNode.textContent));
  },
};

const context = vm.createContext({ document, Event, queueMicrotask });
vm.runInContext(source, context, { filename: "hover-originals.js" });
const hover = vm.runInContext("globalThis.POE2ZHHoverOriginals", context);

hover.register(" 增加 36% 精魂 ", "36% increased Spirit");
await new Promise((resolve) => queueMicrotask(resolve));
assert.deepEqual(
  JSON.parse(JSON.stringify(emitted)),
  [[["增加 36% 精魂", "36% increased Spirit"]]],
  "应把实际渲染中文和实际英文原文送到隔离环境",
);

hover.register("增加 36% 精魂", "Different English Source");
await new Promise((resolve) => queueMicrotask(resolve));
assert.equal(emitted.length, 1, "同一中文对应不同英文时必须停用该悬停映射");

hover.register("增加 36% 精魂", "36% increased Spirit");
await new Promise((resolve) => queueMicrotask(resolve));
assert.equal(emitted.length, 1, "发生冲突的中文不可被后续输入重新启用");

hover.register("護甲", "Armour");
hover.register("護甲", "Armour");
await new Promise((resolve) => queueMicrotask(resolve));
assert.deepEqual(
  JSON.parse(JSON.stringify(emitted.at(-1))),
  [["護甲", "Armour"]],
  "重复的相同映射应稳定去重",
);

const listeners = new Map();
const appended = [];
const tooltipDocument = {
  body: {
    append(node) {
      node.isConnected = true;
      appended.push(node);
    },
  },
  documentElement: { clientWidth: 1200, clientHeight: 800 },
  addEventListener(type, listener) {
    listeners.set(type, listener);
  },
  getElementById(id) {
    return appended.find((node) => node.id === id) ?? null;
  },
  createElement() {
    const attributes = new Map();
    return {
      id: "",
      isConnected: false,
      dataset: {},
      style: {},
      textContent: "",
      offsetWidth: 240,
      offsetHeight: 42,
      setAttribute(name, value) { attributes.set(name, String(value)); },
      getAttribute(name) { return attributes.get(name) ?? null; },
    };
  },
};
const tooltipWindow = { addEventListener() {} };
const tooltipContext = vm.createContext({
  document: tooltipDocument,
  window: tooltipWindow,
  setTimeout,
  clearTimeout,
});
vm.runInContext(tooltipSource, tooltipContext, { filename: "original-tooltip.js" });
const tooltipApi = vm.runInContext("globalThis.POE2ZHOriginalTooltip", tooltipContext);
const targetAttributes = new Map();
const target = {
  isConnected: true,
  setAttribute(name, value) { targetAttributes.set(name, String(value)); },
  getAttribute(name) { return targetAttributes.get(name) ?? null; },
  closest(selector) { return selector === "[data-poe2zh-original]" ? this : null; },
  getBoundingClientRect() {
    return { left: 300, right: 500, top: 200, bottom: 230, width: 200, height: 30 };
  },
};

assert.equal(tooltipApi.annotate(target, "  36% increased   Spirit "), true);
assert.equal(target.getAttribute("data-poe2zh-original"), "36% increased Spirit");
listeners.get("pointerover")({ target, relatedTarget: null });
await new Promise((resolve) => setTimeout(resolve, 170));
assert.equal(appended.length, 1, "全页只能创建一个英文原文 Tooltip");
assert.equal(appended[0].textContent, "36% increased Spirit");
assert.equal(appended[0].dataset.visible, "true");
listeners.get("pointerout")({ target, relatedTarget: null });
assert.equal(appended[0].dataset.visible, "false");
listeners.get("pointerover")({ target, relatedTarget: null });
await new Promise((resolve) => setTimeout(resolve, 170));
assert.equal(appended.length, 1, "再次悬停必须复用同一个 Tooltip 实例");

console.log("hover original smoke test passed");
