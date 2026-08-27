import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataset = JSON.parse(
  fs.readFileSync(path.join(root, "extension/data/bundled.json"), "utf8"),
);
const bundledRaw = fs.readFileSync(path.join(root, "extension/data/bundled.json"));
const remoteManifest = JSON.parse(
  fs.readFileSync(path.join(root, "extension/data/remote-manifest.json"), "utf8"),
);
const translationSource = JSON.parse(
  fs.readFileSync(path.join(root, "sources/translations.zh-TW.json"), "utf8"),
);

for (const relativePath of ["scripts/build-data.mjs", "extension/page/ajax-hooker.js"]) {
  assert.doesNotMatch(
    fs.readFileSync(path.join(root, relativePath), "utf8"),
    /trade\.js/i,
    `${relativePath} 不得依赖历史参考脚本`,
  );
}
const bridgeSource = fs.readFileSync(path.join(root, "extension/content/bridge.js"), "utf8");
assert.match(bridgeSource, /knownRenderedTranslations\.has\(en\)/);

assert.equal(dataset.schemaVersion, 1);
assert.equal(remoteManifest.datasetVersion, dataset.datasetVersion);
assert.equal(remoteManifest.sha256, crypto.createHash("sha256").update(bundledRaw).digest("hex"));
assert.equal(
  remoteManifest.dataUrl,
  "https://raw.githubusercontent.com/a17750/exile-trade-lens/main/extension/data/bundled.json",
);
assert.equal(dataset.source, "project-owned translation pipeline");
assert.ok(dataset.sources.includes("sources/translations.zh-TW.json"));
assert.equal(translationSource.provenance.kind, "one-time-legacy-migration");
assert.match(translationSource.provenance.referenceSha256, /^[a-f0-9]{64}$/);
assert.ok(Object.keys(dataset.items).length > 2_000);
assert.ok(Object.keys(dataset.stats.entries).length > 5_000);
assert.ok(Object.keys(dataset.exact).length > 5_000);
assert.equal(dataset.exact["Item Category"], "道具分類");
assert.equal(dataset.ui.Weapons, "武器");
assert.equal(dataset.ui["Waystone Packsize"], "換界石怪群規模");
assert.equal(dataset.ui["Waystone IIR"], "換界石物品稀有度");
assert.equal(dataset.items["Abyssal Flail"], "深淵鏈錘");
assert.equal(dataset.stats.entries["explicit.stat_3146310524"].text, "擊中時造成目眩");

const listeners = {};
const emitted = [];
const sharedConfig = { textContent: "" };
let hook;
let protectedHook = false;
const context = vm.createContext({
  console,
  setTimeout,
  CustomEvent: class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  },
  document: {
    documentElement: { dataset: {} },
    getElementById(id) {
      return id === "poe2zh-shared-config" ? sharedConfig : null;
    },
    addEventListener(name, callback) {
      listeners[name] = callback;
    },
    dispatchEvent(event) {
      emitted.push(event);
    },
  },
  ajaxHooker: {
    hook(callback) {
      hook = callback;
    },
    protect() {
      protectedHook = true;
    },
  },
});
vm.runInContext(
  fs.readFileSync(path.join(root, "extension/page/trade-hook.js"), "utf8"),
  context,
  { filename: "trade-hook.js" },
);

sharedConfig.textContent = JSON.stringify({
  dataset,
  enabled: true,
  mode: "bilingual",
});
listeners["poe2zh:configure"]();
assert.equal(protectedHook, true);

const [statId, statTranslation] = Object.entries(dataset.stats.entries).find(
  ([, value]) => value.text,
);
const statRequest = { url: "https://www.pathofexile.com/api/trade2/data/stats" };
hook(statRequest);
const statResponse = {
  responseText: JSON.stringify({
    result: [{ id: "test", label: "Test", entries: [{ id: statId, text: "English stat" }] }],
  }),
};
await statRequest.response(statResponse);
assert.match(JSON.parse(statResponse.responseText).result[0].entries[0].text, /English stat/);
assert.match(
  JSON.parse(statResponse.responseText).result[0].entries[0].text,
  new RegExp(statTranslation.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
);

const [itemEn, itemZh] = Object.entries(dataset.items)[0];
const itemRequest = { url: "https://www.pathofexile.com/api/trade2/data/items" };
hook(itemRequest);
const itemResponse = {
  responseText: JSON.stringify({
    result: [{ id: "test", entries: [{ type: itemEn, text: itemEn }] }],
  }),
};
await itemRequest.response(itemResponse);
assert.match(JSON.parse(itemResponse.responseText).result[0].entries[0].text, new RegExp(itemZh));

const missingRequest = { url: "https://www.pathofexile.com/api/trade2/data/stats" };
hook(missingRequest);
const missingResponse = {
  responseText: JSON.stringify({
    result: [{ id: "Explicit", label: "Explicit", entries: [{ id: "explicit.stat_missing_test", text: "#% Test Damage" }] }],
  }),
};
await missingRequest.response(missingResponse);
assert.equal(emitted.at(-1).type, "poe2zh:missing");
assert.equal(emitted.at(-1).detail.key, "explicit.stat_missing_test");

console.log("smoke-test: ok");
