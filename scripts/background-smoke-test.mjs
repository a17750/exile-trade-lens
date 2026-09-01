import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundledRaw = fs.readFileSync(path.join(root, "extension/data/bundled.json"), "utf8");
const stores = { local: {}, sync: {} };
let onMessage;
let onInstalled;
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
    getManifest() { return { version: "0.5.8" }; },
    getURL(file) { return `chrome-extension://test/${file}`; },
    onInstalled: { addListener(listener) { onInstalled = listener; } },
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
  importScripts() {},
});

vm.runInContext(
  fs.readFileSync(path.join(root, "extension/shared/missing-report-policy.js"), "utf8"),
  context,
  { filename: "missing-report-policy.js" },
);

vm.runInContext(
  fs.readFileSync(path.join(root, "extension/background/service-worker.js"), "utf8"),
  context,
  { filename: "service-worker.js" },
);

assert.doesNotThrow(
  () => context.validateDataset(JSON.parse(bundledRaw)),
  "远程更新校验必须接受构建器生成的 GGPK signed rendering",
);
const invalidRenderingDataset = JSON.parse(bundledRaw);
invalidRenderingDataset.stats.entries["explicit.stat_3639275092"].renderings[0].source =
  "unverified-guess";
assert.throws(
  () => context.validateDataset(invalidRenderingDataset),
  /渲染变体无效/,
  "远程更新仍必须拒绝未经声明的 rendering 来源",
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
  context: "fetch:smoke-test",
  source: "trade-api",
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
assert.equal(dataset.dataset.affixNames.prefixes.Frosted, "結霜的");
assert.equal(dataset.dataset.affixNames.suffixes["of the Fletcher"], "製箭者之");
assert.deepEqual(
  dataset.dataset.domains.itemName.normalDisplayRules.map((rule) => rule.ruleId),
  ["client-string:QualityItem", "client-string:ExceptionalItem"],
);
assert.deepEqual(
  dataset.dataset.domains.itemName.magicAffixRule.targetOrder,
  ["prefix", "suffix", "base"],
);
assert.equal(dataset.dataset.itemPropertyType109.qualifiers.Ezomyte.text, "艾茲麥");
assert.equal(dataset.dataset.itemPropertyType109.classes.Staff.text, "長杖");

const resolvedPropertyReports = [
  { type: "property", key: "Bow", en: "Bow", context: "item-property", source: "trade-api" },
  { type: "property", key: "Cold Damage", en: "Cold Damage", context: "item-property", source: "trade-api" },
  { type: "property", key: "Dex", en: "Dex", context: "item-property", source: "trade-api" },
  { type: "property", key: "Staff", en: "Staff", context: "item-property", source: "trade-api" },
  { type: "property", key: "Elemental Damage", en: "Elemental Damage", context: "item-property", source: "trade-api" },
];
await send({ type: "POE2ZH_REPORT_MISSING", reports: resolvedPropertyReports });
health = await send({ type: "POE2ZH_GET_HEALTH" });
for (const report of resolvedPropertyReports) {
  assert.equal(
    health.records.some((entry) => entry.key === report.key),
    false,
    `${report.key} 已有领域翻译，不应进入缺失记录`,
  );
}

const uiReport = {
  type: "ui",
  key: "Untranslated Filter Label",
  en: "Untranslated Filter Label",
  context: "filter-panel",
  region: "filter-panel",
  source: "dom-static-ui",
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

const catalogReport = {
  type: "stat",
  key: "explicit.stat_catalog_only",
  en: "Allocates Catalog Only",
  context: "explicit",
  source: "trade-api",
};
await send({ type: "POE2ZH_REPORT_MISSING", reports: [catalogReport] });
health = await send({ type: "POE2ZH_GET_HEALTH" });
assert.equal(health.records.some((entry) => entry.key === catalogReport.key), false);

const bilingualReport = {
  type: "ui",
  key: "# 元素抗性 (# total Elemental Resistances)",
  en: "# 元素抗性 (# total Elemental Resistances)",
  context: "filter-panel",
  region: "filter-panel",
  source: "dom-static-ui",
};
await send({ type: "POE2ZH_REPORT_MISSING", reports: [bilingualReport] });
health = await send({ type: "POE2ZH_GET_HEALTH" });
assert.equal(health.records.some((entry) => entry.key === bilingualReport.key), false);

const unknownNormalDisplayReport = {
  type: "item",
  key: "Unverified Bombard Crossbow",
  en: "Unverified Bombard Crossbow",
  context: "fetch:typeLine:normal-display-unresolved",
  source: "trade-api",
};
await send({ type: "POE2ZH_REPORT_MISSING", reports: [unknownNormalDisplayReport] });
health = await send({ type: "POE2ZH_GET_HEALTH" });
assert.equal(
  health.records.some(
    (entry) =>
      entry.key === unknownNormalDisplayReport.key &&
      entry.context === unknownNormalDisplayReport.context,
  ),
  true,
  "未知普通物品展示模板必须保留在漏译队列",
);

stores.local.missingRecords["ui:Legacy Typed Dropdown Fragment"] = {
  id: "ui:Legacy Typed Dropdown Fragment",
  type: "ui",
  key: "Legacy Typed Dropdown Fragment",
  en: "Legacy Typed Dropdown Fragment",
  context: "dropdown-option",
  seenCount: 1,
};
health = await send({ type: "POE2ZH_GET_HEALTH" });
assert.equal(
  health.records.some((entry) => entry.key === "Legacy Typed Dropdown Fragment"),
  false,
  "升级后必须清理无法验证来源的旧版下拉输入污染",
);

const recordsBeforeUntrusted = health.records.length;
await send({
  type: "POE2ZH_REPORT_MISSING",
  reports: [{
    type: "ui",
    key: "Untrusted Typed Fragment",
    en: "Untrusted Typed Fragment",
    context: "dropdown-option",
  }],
});
health = await send({ type: "POE2ZH_GET_HEALTH" });
assert.equal(health.records.length, recordsBeforeUntrusted);
assert.equal(
  health.records.some((entry) => entry.key === "Untrusted Typed Fragment"),
  false,
  "后台必须拒绝没有可信来源元数据的 DOM 报告",
);

assert.equal(stores.local.missingRecordsBuildVersion, "0.5.8");
assert.equal(typeof onInstalled, "function");
await onInstalled({ reason: "update", previousVersion: "0.5.7" });
health = await send({ type: "POE2ZH_GET_HEALTH" });
assert.equal(health.records.length, 0, "扩展代码更新后必须清空上一版本的漏译记录");
assert.equal(stores.local.missingRecordsLastReset.reason, "onInstalled:update");

console.log("background-smoke-test: ok");
