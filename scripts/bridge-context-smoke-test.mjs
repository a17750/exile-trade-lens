import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataset = JSON.parse(
  fs.readFileSync(path.join(root, "extension/data/bundled.json"), "utf8"),
);
const listeners = new Map();
const sharedConfig = { textContent: "" };
const documentElement = { dataset: {} };
let reportAttempts = 0;
let infoMessages = 0;
const unhandledRejections = [];
const onUnhandledRejection = (reason) => unhandledRejections.push(reason);
process.on("unhandledRejection", onUnhandledRejection);

const document = {
  readyState: "complete",
  body: null,
  head: { append() {} },
  documentElement,
  getElementById(id) {
    return id === "poe2zh-shared-config" ? sharedConfig : null;
  },
  addEventListener(name, callback) {
    listeners.set(name, callback);
  },
  removeEventListener(name, callback) {
    if (listeners.get(name) === callback) listeners.delete(name);
  },
  dispatchEvent() {},
};

const chrome = {
  runtime: {
    id: "test-extension",
    async sendMessage(message) {
      if (message.type === "POE2ZH_GET_DATASET") return { ok: true, dataset };
      if (message.type === "POE2ZH_REPORT_MISSING") {
        reportAttempts += 1;
        throw new Error("Extension context invalidated.");
      }
      throw new Error(`unexpected message: ${message.type}`);
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
  console: {
    error: console.error,
    warn: console.warn,
    info() { infoMessages += 1; },
  },
  document,
  Event: class Event {
    constructor(type) { this.type = type; }
  },
  setTimeout,
});

vm.runInContext(
  fs.readFileSync(path.join(root, "extension/shared/missing-report-policy.js"), "utf8"),
  context,
  { filename: "missing-report-policy.js" },
);

vm.runInContext(
  fs.readFileSync(path.join(root, "extension/content/bridge.js"), "utf8"),
  context,
  { filename: "bridge.js" },
);

await new Promise((resolve) => setTimeout(resolve, 0));
const missingListener = listeners.get("poe2zh:missing");
assert.equal(typeof missingListener, "function");

missingListener({
  detail: {
    type: "item",
    key: "Context Invalidation Test",
    en: "Context Invalidation Test",
    context: "fetch:test",
    source: "trade-api",
  },
});

await new Promise((resolve) => setTimeout(resolve, 800));
assert.equal(reportAttempts, 1);
assert.equal(documentElement.dataset.poe2zhBridge, "reload-required");
assert.equal(listeners.has("poe2zh:missing"), false);
assert.equal(infoMessages, 1);
assert.deepEqual(unhandledRejections, [], "上下文失效不得产生未处理 Promise 拒绝");
process.off("unhandledRejection", onUnhandledRejection);

console.log("bridge-context-smoke-test: ok");
