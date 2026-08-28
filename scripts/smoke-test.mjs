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
assert.match(bridgeSource, /exactConflicts/);

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
assert.ok(Object.keys(dataset.baseItems).length > 4_000);
assert.ok(Object.keys(dataset.wordComponents).length > 3_000);
assert.ok(Object.keys(dataset.stats.entries).length > 5_000);
assert.ok(Object.keys(dataset.exact).length > 5_000);
assert.equal(dataset.exact["Item Category"], "道具分類");
assert.equal(dataset.ui.Weapons, "武器");
assert.equal(dataset.ui["Waystone Packsize"], "換界石怪群規模");
assert.equal(dataset.ui["Waystone IIR"], "換界石物品稀有度");
assert.equal(dataset.items["Abyssal Flail"], "深淵鏈錘");
assert.equal(dataset.baseItems["Slim Mace"], "纖細之錘");
assert.equal(dataset.wordComponents.Golem, "魔像");
assert.equal(dataset.wordComponents[" Crack"], " 裂骨錘");
assert.equal(dataset.stats.entries["explicit.stat_3146310524"].text, "擊中時造成目眩");
assert.equal(
  dataset.stats.entries["explicit.stat_2162097452"].english,
  "# to Level of all Minion Skills",
);
assert.equal(dataset.stats.entries["explicit.stat_3984865854"].english, "#% increased Spirit");

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

const magicFetchRequest = { url: "https://www.pathofexile.com/api/trade2/fetch/magic-test" };
hook(magicFetchRequest);
const magicTypeLine = `Shining ${itemEn} of the Crystal`;
const magicFetchResponse = {
  responseText: JSON.stringify({
    result: [{ item: { frameType: 1, baseType: itemEn, typeLine: magicTypeLine, properties: [], requirements: [] } }],
  }),
};
await magicFetchRequest.response(magicFetchResponse);
const translatedMagicItem = JSON.parse(magicFetchResponse.responseText).result[0].item;
assert.match(translatedMagicItem.baseType, new RegExp(itemZh));
assert.match(translatedMagicItem.typeLine, new RegExp(itemZh));
assert.match(translatedMagicItem.typeLine, /Shining/);
assert.match(translatedMagicItem.typeLine, /of the Crystal/);

// Hash order is not a safe association key. The fixture intentionally assigns
// the two stat IDs to the opposite mod indexes; matching the concrete English
// line must still produce the correct translation and value.
const swappedModsRequest = { url: "https://www.pathofexile.com/api/trade2/fetch/swapped-mods" };
hook(swappedModsRequest);
const swappedModsResponse = {
  responseText: JSON.stringify({
    result: [{
      item: {
        frameType: 2,
        explicitMods: ["36% increased Spirit", "+1 to Level of all Minion Skills"],
        extended: {
          hashes: {
            explicit: [
              ["explicit.stat_2162097452", [0]],
              ["explicit.stat_3984865854", [1]],
            ],
          },
        },
      },
    }],
  }),
};
await swappedModsRequest.response(swappedModsResponse);
const translatedSwappedMods = JSON.parse(swappedModsResponse.responseText).result[0].item;
assert.match(translatedSwappedMods.explicitMods[0], /^增加36%精魂 \(36% increased Spirit\)$/);
assert.match(
  translatedSwappedMods.explicitMods[1],
  /^全部召喚物技能等級\+1 \(\+1 to Level of all Minion Skills\)$/,
);

const rareFetchRequest = { url: "https://www.pathofexile.com/api/trade2/fetch/rare-test" };
hook(rareFetchRequest);
const rareFetchResponse = {
  responseText: JSON.stringify({
    result: [{ item: {
      frameType: 2,
      name: "Golem Crack",
      baseType: "Slim Mace",
      typeLine: "Slim Mace",
      properties: [],
      requirements: [],
    } }],
  }),
};
await rareFetchRequest.response(rareFetchResponse);
const translatedRareItem = JSON.parse(rareFetchResponse.responseText).result[0].item;
assert.match(translatedRareItem.name, /魔像 裂骨錘/);
assert.match(translatedRareItem.name, /Golem Crack/);
assert.doesNotMatch(translatedRareItem.name, /纖細之錘/);
assert.match(translatedRareItem.baseType, /纖細之錘/);

const missingRequest = { url: "https://www.pathofexile.com/api/trade2/data/stats" };
hook(missingRequest);
const emittedBeforeCatalog = emitted.length;
const missingResponse = {
  responseText: JSON.stringify({
    result: [{ id: "Explicit", label: "Explicit", entries: [{ id: "explicit.stat_missing_test", text: "#% Test Damage" }] }],
  }),
};
await missingRequest.response(missingResponse);
assert.equal(emitted.length, emittedBeforeCatalog);

const fetchRequest = { url: "https://www.pathofexile.com/api/trade2/fetch/test" };
hook(fetchRequest);
const fetchResponse = {
  responseText: JSON.stringify({
    result: [{ item: { baseType: "Untranslated Fetch Base", properties: [], requirements: [] } }],
  }),
};
await fetchRequest.response(fetchResponse);
assert.equal(emitted.at(-1).type, "poe2zh:missing");
assert.equal(emitted.at(-1).detail.key, "Untranslated Fetch Base");
assert.equal(emitted.at(-1).detail.context, "fetch:baseType");

console.log("smoke-test: ok");
