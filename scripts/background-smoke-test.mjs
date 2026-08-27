import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundledRaw = fs.readFileSync(path.join(root, "extension/data/bundled.json"), "utf8");
const stores = { local: {}, sync: {} };
let onMessage;
let badgeText = "";

function makeStorage(area) {
  return {
    async get(keys) {
      const store = stores[area];
      if (typeof keys === "string") return { [keys]: store[keys] };
      if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, store[key]]));
      if (keys && typeof keys === "object") {
        return Object.fromEntries(
          Object.entries(keys).map(([key, fallback]) => [key, store[key] ?? fallback]),
        );
      }
      return { ...store };
    },
    async set(values) {
      Object.assign(stores[area], values);
    },
  };
}

const chrome = {
  storage: { local: makeStorage("local"), sync: makeStorage("sync") },
  action: {
    async setBadgeBackgroundColor() {},
    async setBadgeText({ text }) { badgeText = text; },
    async setTitle() {},
  },
  alarms: {
    async get() { return null; },
    async create() {},
    onAlarm: { addListener() {} },
  },
  runtime: {
    getURL(file) { return `chrome-extension://test/${file}`; },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    onMessage: { addListener(listener) { onMessage = listener; } },
  },
};

const context = vm.createContext({
  chrome,
  console,
  URL,
  TextEncoder,
  crypto,
  fetch: async (url) => {
    if (String(url).endsWith("/data/bundled.json")) return new Response(bundledRaw);
    throw new Error(`unexpected fetch: ${url}`);
  },
});

vm.runInContext(
  fs.readFileSync(path.join(root, "extension/background/service-worker.js"), "utf8"),
  context,
  { filename: "service-worker.js" },
);

async function send(message) {
  return new Promise((resolve, reject) => {
    const keepAlive = onMessage(message, {}, resolve);
    if (!keepAlive) reject(new Error(`message not handled: ${message.type}`));
  });
}

const report = {
  type: "stat",
  key: "explicit.stat_self_check_test",
  en: "#% Test Damage",
  context: "smoke-test",
};
await send({ type: "POE2ZH_REPORT_MISSING", reports: [report, report] });
let health = await send({ type: "POE2ZH_GET_HEALTH" });
assert.equal(health.records.length, 1);
assert.equal(health.records[0].seenCount, 2);
assert.equal(badgeText, "1");

const rejected = await send({
  type: "POE2ZH_SAVE_OVERRIDE",
  payload: { ...report, translation: "测试伤害" },
});
assert.equal(rejected.ok, false);

const saved = await send({
  type: "POE2ZH_SAVE_OVERRIDE",
  payload: { ...report, translation: "增加 #% 测试伤害" },
});
assert.equal(saved.ok, true);
health = await send({ type: "POE2ZH_GET_HEALTH" });
assert.equal(health.records.length, 0);
assert.equal(health.overrideCount, 1);
const dataset = await send({ type: "POE2ZH_GET_DATASET" });
assert.equal(dataset.dataset.stats.entries[report.key].text, "增加 #% 测试伤害");

const uiReport = {
  type: "ui",
  key: "Untranslated Filter Label",
  en: "Untranslated Filter Label",
  context: "filter-panel",
};
await send({ type: "POE2ZH_REPORT_MISSING", reports: [uiReport] });
health = await send({ type: "POE2ZH_GET_HEALTH" });
assert.equal(health.records.length, 1);
assert.equal(health.records[0].type, "ui");
const savedUi = await send({
  type: "POE2ZH_SAVE_OVERRIDE",
  payload: { ...uiReport, translation: "未翻译的筛选标签" },
});
assert.equal(savedUi.ok, true);
const uiDataset = await send({ type: "POE2ZH_GET_DATASET" });
assert.equal(uiDataset.dataset.exact[uiReport.key], "未翻译的筛选标签");

const bilingualReport = {
  type: "ui",
  key: "# 元素抗性 (# total Elemental Resistances)",
  en: "# 元素抗性 (# total Elemental Resistances)",
  context: "filter-panel",
};
await send({ type: "POE2ZH_REPORT_MISSING", reports: [bilingualReport] });
health = await send({ type: "POE2ZH_GET_HEALTH" });
assert.equal(health.records.some((entry) => entry.key === bilingualReport.key), false);

console.log("background-smoke-test: ok");
