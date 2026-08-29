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
const extensionManifest = JSON.parse(
  fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"),
);

for (const relativePath of ["scripts/build-data.mjs", "extension/page/ajax-hooker.js"]) {
  assert.doesNotMatch(
    fs.readFileSync(path.join(root, relativePath), "utf8"),
    /trade\.js/i,
    `${relativePath} 不得依赖历史参考脚本`,
  );
}
const bridgeSource = fs.readFileSync(path.join(root, "extension/content/bridge.js"), "utf8");
assert.match(bridgeSource, /knownRenderedTranslations\.has\(text\)/);
assert.match(bridgeSource, /exactConflicts/);
assert.match(bridgeSource, /missingPolicy\.createDomGuard/);
assert.equal(extensionManifest.version, "0.5.8");
const mainScript = extensionManifest.content_scripts.find((entry) => entry.world === "MAIN");
const isolatedScript = extensionManifest.content_scripts.find((entry) => entry.world !== "MAIN");
assert.ok(mainScript?.js.includes("page/trade-hook.js"), "MAIN 环境必须加载交易拦截器");
assert.ok(isolatedScript?.js.includes("shared/missing-report-policy.js"), "隔离环境必须先加载漏译采集策略");
assert.ok(isolatedScript?.js.includes("content/bridge.js"), "隔离环境必须加载 bridge");

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
assert.ok(Object.keys(dataset.affixNames.prefixes).length > 500);
assert.ok(Object.keys(dataset.affixNames.suffixes).length > 400);
assert.ok(Object.keys(dataset.stats.entries).length > 5_000);
assert.ok(Object.keys(dataset.exact).length > 5_000);
assert.equal(dataset.exact["Item Category"], "道具分類");
assert.equal(dataset.properties["Bow"], "弓");
assert.equal(dataset.properties["Cold Damage"], "冰冷傷害");
assert.equal(dataset.properties.Dex, "敏捷");
assert.equal(dataset.properties["One Hand Mace"], "單手錘");
assert.equal(dataset.properties["Two Hand Mace"], "雙手錘");
assert.equal(dataset.properties.Jewel, "珠寶");
assert.equal(dataset.properties["Item Level"], "物品等級");
assert.equal(dataset.properties.Requires, "需求");
assert.equal(dataset.ui["Log Out"], "登出");
assert.equal(dataset.ui["Weighted Sum v2"], "加權總和 v2");
assert.equal(dataset.ui["Dismiss News"], "關閉公告");
assert.equal(dataset.ui["No matches."], "沒有符合項目。");
assert.equal(dataset.ui["PoE2 - Runes of Aldur"], "PoE2 - 阿德爾的符文");
assert.equal(dataset.ui["Mercenary Skill Group"], "傭兵技能群組");
assert.equal(dataset.ui.Weapons, "武器");
assert.equal(dataset.ui["Waystone Packsize"], "換界石怪群規模");
assert.equal(dataset.ui["Waystone IIR"], "換界石物品稀有度");
assert.equal(dataset.items["Abyssal Flail"], "深淵鏈錘");
assert.equal(dataset.baseItems["Slim Mace"], "纖細之錘");
assert.equal(dataset.wordComponents.Golem, "魔像");
assert.equal(dataset.wordComponents[" Crack"], " 裂骨錘");
assert.equal(dataset.affixNames.prefixes.Frosted, "結霜的");
assert.equal(dataset.affixNames.suffixes["of the Fletcher"], "製箭者之");
assert.equal(dataset.affixNames.suffixes["of Osmosis"], "逆滲透之");
assert.deepEqual(dataset.itemDisplayTemplates.quality, {
  sourceId: "QualityItem",
  english: "Superior {0}",
  text: "精良的 {0}",
});
assert.equal(dataset.stats.entries["explicit.stat_3146310524"].text, "擊中時造成目眩");
assert.equal(
  dataset.stats.entries["explicit.stat_2162097452"].english,
  "# to Level of all Minion Skills",
);
assert.equal(dataset.stats.entries["explicit.stat_3984865854"].english, "#% increased Spirit");
assert.equal(
  dataset.stats.entries["explicit.stat_3885634897"].english,
  "#% chance to Poison on Hit with this weapon",
);
assert.deepEqual(dataset.stats.entries["explicit.stat_3885634897"].renderings, [{
  english: "Always Poison on Hit with this weapon",
  text: "用此武器擊中時會造成中毒",
  source: "official-trade-fetch-pair",
}]);
assert.equal(dataset.exact["Always Poison on Hit with this weapon"], undefined);

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
  fs.readFileSync(path.join(root, "extension/shared/missing-report-policy.js"), "utf8"),
  context,
  { filename: "missing-report-policy.js" },
);
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

const typeOnlyCatalogRequest = { url: "https://www.pathofexile.com/api/trade2/data/items" };
hook(typeOnlyCatalogRequest);
const typeOnlyCatalogResponse = {
  responseText: JSON.stringify({
    result: [{ id: "weapon", entries: [
      { type: "Sinister Quarterstaff" },
      { type: "Vile Greataxe" },
    ] }],
  }),
};
await typeOnlyCatalogRequest.response(typeOnlyCatalogResponse);
const typeOnlyEntries = JSON.parse(typeOnlyCatalogResponse.responseText).result[0].entries;
assert.equal(typeOnlyEntries[0].text, "邪惡細杖 (Sinister Quarterstaff)");
assert.equal(typeOnlyEntries[1].text, "邪惡巨斧 (Vile Greataxe)");
assert.doesNotMatch(JSON.stringify(typeOnlyEntries), /undefined/i);

const partialCatalogRequest = { url: "https://www.pathofexile.com/api/trade2/data/items" };
hook(partialCatalogRequest);
const partialCatalogText = `Unverified Name ${itemEn}`;
const partialCatalogResponse = {
  responseText: JSON.stringify({
    result: [{
      id: "test",
      entries: [{ name: "Unverified Name", type: itemEn, text: partialCatalogText }],
    }],
  }),
};
await partialCatalogRequest.response(partialCatalogResponse);
assert.equal(
  JSON.parse(partialCatalogResponse.responseText).result[0].entries[0].text,
  partialCatalogText,
  "物品目录的名称和类型必须全部命中，不能输出残缺组合",
);

const magicFetchRequest = { url: "https://www.pathofexile.com/api/trade2/fetch/magic-test" };
hook(magicFetchRequest);
const magicTypeLine = `Unverified Prefix ${itemEn} of Unverified Suffix`;
const magicFetchResponse = {
  responseText: JSON.stringify({
    result: [
      { item: { frameType: 1, baseType: itemEn, typeLine: magicTypeLine, properties: [], requirements: [] } },
      { item: { frameType: 1, baseType: "Composite Bow", typeLine: "Frosted Composite Bow of Unverified Suffix", properties: [], requirements: [] } },
      { item: { frameType: 1, baseType: "Composite Bow", typeLine: "Unverified Prefix Composite Bow of the Fletcher", properties: [], requirements: [] } },
    ],
  }),
};
await magicFetchRequest.response(magicFetchResponse);
const untranslatedMagicResults = JSON.parse(magicFetchResponse.responseText).result;
const translatedMagicItem = untranslatedMagicResults[0].item;
assert.match(translatedMagicItem.baseType, new RegExp(itemZh));
assert.equal(
  translatedMagicItem.typeLine,
  magicTypeLine,
  "复合名称无法完整翻译时必须整段保留英文，不能只替换已知底材",
);
assert.doesNotMatch(translatedMagicItem.typeLine, new RegExp(itemZh));
assert.equal(
  untranslatedMagicResults[1].item.typeLine,
  "Frosted Composite Bow of Unverified Suffix",
  "已知前缀不能掩盖未知后缀",
);
assert.equal(
  untranslatedMagicResults[2].item.typeLine,
  "Unverified Prefix Composite Bow of the Fletcher",
  "已知后缀不能掩盖未知前缀",
);

const officialAffixRequest = { url: "https://www.pathofexile.com/api/trade2/fetch/official-affix-test" };
hook(officialAffixRequest);
const officialAffixResponse = {
  responseText: JSON.stringify({
    result: [{ item: {
      frameType: 1,
      baseType: "Composite Bow",
      typeLine: "Composite Bow of the Fletcher",
      properties: [],
      requirements: [],
    } }, { item: {
      frameType: 1,
      baseType: "Recurve Bow",
      typeLine: "Frosted Recurve Bow of Osmosis",
      properties: [],
      requirements: [],
    } }],
  }),
};
await officialAffixRequest.response(officialAffixResponse);
const translatedOfficialAffixes = JSON.parse(officialAffixResponse.responseText).result;
assert.equal(
  translatedOfficialAffixes[0].item.typeLine,
  "合成弓製箭者之 (Composite Bow of the Fletcher)",
);
assert.equal(
  translatedOfficialAffixes[1].item.typeLine,
  "結霜的反曲弓逆滲透之 (Frosted Recurve Bow of Osmosis)",
);

const superiorNormalRequest = {
  url: "https://www.pathofexile.com/api/trade2/fetch/superior-normal-test",
};
hook(superiorNormalRequest);
const superiorNormalResponse = {
  responseText: JSON.stringify({
    result: [{ item: {
      frameType: 0,
      baseType: "Bombard Crossbow",
      typeLine: "Superior Bombard Crossbow",
      properties: [],
      requirements: [],
    } }],
  }),
};
await superiorNormalRequest.response(superiorNormalResponse);
const translatedSuperiorNormal = JSON.parse(superiorNormalResponse.responseText).result[0].item;
assert.equal(translatedSuperiorNormal.baseType, "轟擊十字弓 (Bombard Crossbow)");
assert.equal(
  translatedSuperiorNormal.typeLine,
  "精良的 轟擊十字弓 (Superior Bombard Crossbow)",
);

const unknownNormalDisplayRequest = {
  url: "https://www.pathofexile.com/api/trade2/fetch/unknown-normal-display-test",
};
hook(unknownNormalDisplayRequest);
const emittedBeforeUnknownNormal = emitted.length;
const unknownNormalDisplayResponse = {
  responseText: JSON.stringify({
    result: [{ item: {
      frameType: 0,
      baseType: "Bombard Crossbow",
      typeLine: "Unverified Bombard Crossbow",
      properties: [],
      requirements: [],
    } }],
  }),
};
await unknownNormalDisplayRequest.response(unknownNormalDisplayResponse);
assert.equal(
  JSON.parse(unknownNormalDisplayResponse.responseText).result[0].item.typeLine,
  "Unverified Bombard Crossbow",
);
assert.equal(emitted.length, emittedBeforeUnknownNormal + 1);
assert.equal(emitted.at(-1).detail.key, "Unverified Bombard Crossbow");
assert.equal(emitted.at(-1).detail.context, "fetch:typeLine:normal-display-unresolved");

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

const alternateRenderingRequest = {
  url: "https://www.pathofexile.com/api/trade2/fetch/alternate-rendering",
};
hook(alternateRenderingRequest);
const alternateRenderingResponse = {
  responseText: JSON.stringify({
    result: [{
      item: {
        frameType: 3,
        explicitMods: [{
          description: "Always [Poison] on [HitDamage|Hit] with this weapon",
          hash: "stat.explicit.stat_3885634897",
        }],
        extended: {
          hashes: { explicit: [["explicit.stat_3885634897", [0]]] },
        },
      },
    }],
  }),
};
await alternateRenderingRequest.response(alternateRenderingResponse);
const translatedAlternate = JSON.parse(alternateRenderingResponse.responseText).result[0].item;
assert.equal(
  translatedAlternate.explicitMods[0].description,
  "用此武器擊中時會造成中毒 (Always [Poison] on [HitDamage|Hit] with this weapon)",
);

const wrongRenderingIdRequest = {
  url: "https://www.pathofexile.com/api/trade2/fetch/wrong-rendering-id",
};
hook(wrongRenderingIdRequest);
const wrongRenderingIdResponse = {
  responseText: JSON.stringify({
    result: [{ item: {
      explicitMods: ["Always Poison on Hit with this weapon"],
      extended: { hashes: { explicit: [["explicit.stat_3146310524", [0]]] } },
    } }],
  }),
};
await wrongRenderingIdRequest.response(wrongRenderingIdResponse);
assert.equal(
  JSON.parse(wrongRenderingIdResponse.responseText).result[0].item.explicitMods[0],
  "Always Poison on Hit with this weapon",
  "alternate rendering must never escape its verified stable stat ID",
);

const isolatedFailureRequest = {
  url: "https://www.pathofexile.com/api/trade2/fetch/isolated-failure",
};
hook(isolatedFailureRequest);
const isolatedFailureResponse = {
  responseText: JSON.stringify({
    result: [
      {
        item: {
          frameType: 0,
          baseType: "Slim Mace",
          typeLine: "Slim Mace",
          properties: { name: "malformed optional field" },
          requirements: [],
        },
      },
      {
        item: {
          frameType: 0,
          baseType: "Bombard Crossbow",
          typeLine: "Superior Bombard Crossbow",
          properties: [],
          requirements: [],
        },
      },
    ],
  }),
};
await isolatedFailureRequest.response(isolatedFailureResponse);
const isolatedResults = JSON.parse(isolatedFailureResponse.responseText).result;
assert.equal(isolatedResults[0].item.baseType, "纖細之錘 (Slim Mace)");
assert.equal(isolatedResults[0].item.typeLine, "纖細之錘 (Slim Mace)");
assert.equal(
  isolatedResults[1].item.baseType,
  "轟擊十字弓 (Bombard Crossbow)",
  "one malformed listing must not cancel translation for the remaining batch",
);
assert.equal(
  isolatedResults[1].item.typeLine,
  "精良的 轟擊十字弓 (Superior Bombard Crossbow)",
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
assert.match(translatedRareItem.typeLine, /纖細之錘/);

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
