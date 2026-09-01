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
const uiSource = JSON.parse(
  fs.readFileSync(path.join(root, "data/ui.zh-TW.json"), "utf8"),
);
const verifiedLabels = JSON.parse(
  fs.readFileSync(path.join(root, "data/verified-labels.zh-TW.json"), "utf8"),
);
const extensionManifest = JSON.parse(
  fs.readFileSync(path.join(root, "extension/manifest.json"), "utf8"),
);
const itemFieldCoverage = JSON.parse(
  fs.readFileSync(path.join(root, "reports/item-field-coverage.json"), "utf8"),
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
assert.doesNotMatch(bridgeSource, /UI_FALLBACK_TRANSLATIONS/);
assert.equal(extensionManifest.version, "0.5.28");
const mainScript = extensionManifest.content_scripts.find((entry) => entry.world === "MAIN");
const isolatedScript = extensionManifest.content_scripts.find((entry) => entry.world !== "MAIN");
assert.ok(mainScript?.js.includes("page/trade-hook.js"), "MAIN 环境必须加载交易拦截器");
assert.deepEqual(
  mainScript?.js,
  ["page/ajax-hooker.js", "page/hover-originals.js", "page/domains/item-name.js", "page/domains/granted-skill.js", "page/item-property-rendering.js", "page/stat-rendering.js", "page/trade-hook.js"],
  "MAIN 环境必须先加载 item-name、property 和 stat 领域模块，再加载交易拦截器",
);
assert.match(bridgeSource, /POE2ZHOriginalTooltip\?\.annotate/);
assert.match(bridgeSource, /applyHoverOriginalsWithin/);
assert.ok(isolatedScript?.js.includes("shared/missing-report-policy.js"), "隔离环境必须先加载漏译采集策略");
assert.ok(isolatedScript?.js.includes("content/bridge.js"), "隔离环境必须加载 bridge");
assert.deepEqual(
  isolatedScript?.js,
  ["shared/missing-report-policy.js", "shared/result-label-policy.js", "content/original-tooltip.js", "page/domains/granted-skill.js", "content/granted-skill-fields.js", "content/item-card-fields.js", "content/bridge.js"],
  "隔离环境必须先加载漏译与结果标签策略，再加载 bridge",
);
assert.deepEqual(isolatedScript?.css, ["content/original-tooltip.css"]);

assert.equal(dataset.schemaVersion, 1);
assert.equal(remoteManifest.datasetVersion, dataset.datasetVersion);
assert.equal(remoteManifest.sha256, crypto.createHash("sha256").update(bundledRaw).digest("hex"));
assert.equal(
  remoteManifest.dataUrl,
  "https://raw.githubusercontent.com/a17750/exile-trade-lens/main/extension/data/bundled.json",
);
assert.equal(dataset.source, "project-owned translation pipeline");
assert.ok(dataset.sources.includes("data/trade-api.json"));
assert.ok(dataset.sources.includes("data/domain-policies.json"));
assert.ok(dataset.sources.includes("data/item-fields.zh-TW.json"));
assert.ok(dataset.sources.includes("data/item-property-type109.zh-TW.json"));
assert.ok(!dataset.sources.includes("data/translations.zh-TW.json"));
assert.equal(verifiedLabels.ui, undefined, "人工标签文件不得继续保存 UI 翻译");
assert.deepEqual(dataset.ui, uiSource.entries, "运行 UI 词库必须完全来自 data/ui.zh-TW.json");
assert.ok(
  new Set([
    ...Object.keys(dataset.items),
    ...Object.keys(dataset.baseItems),
    ...Object.keys(dataset.fixedNames),
  ]).size > 6_000,
  "GGPK 底材和固定名称的合并覆盖不得下降",
);
assert.ok(Object.keys(dataset.baseItems).length > 4_000);
assert.ok(Object.keys(dataset.wordComponents).length > 3_000);
assert.ok(Object.keys(dataset.affixNames.prefixes).length > 500);
assert.ok(Object.keys(dataset.affixNames.suffixes).length > 400);
assert.ok(Object.keys(dataset.stats.entries).length > 5_000);
assert.ok(Object.keys(dataset.allocates).length > 2_000);
assert.equal(dataset.properties["Evasion Rating"], "閃避值");
assert.equal(dataset.properties.Str, "力量");
assert.equal(dataset.properties["Block chance"], "格擋機率");
assert.equal(dataset.properties.Quality, "品質");
assert.equal(dataset.properties["Reload Time"], "重新裝填時間");
assert.equal(dataset.itemPropertyIndex.Staff.text, "長杖");
assert.ok(
  dataset.itemPropertyIndex.Staff.sources.some((source) => source.kind === "ggpk-client"),
);
assert.ok(
  dataset.itemPropertyIndex.Staff.sources.some((source) => source.kind === "trade-filter-option"),
);
assert.equal(dataset.itemPropertyIndex["Elemental Damage"].text, "元素傷害");
assert.ok(
  dataset.itemPropertyIndex["Elemental Damage"].sources.some(
    (source) => source.kind === "ggpk-passive-exact",
  ),
);
assert.equal(dataset.itemPropertyType109.qualifiers.Ezomyte.text, "艾茲麥");
assert.equal(dataset.itemPropertyType109.qualifiers.Vaal.text, "瓦爾");
assert.equal(dataset.itemPropertyType109.classes.Staff.text, "長杖");
assert.equal(dataset.itemPropertyType109.classes.Helmet.text, "頭盔");
assert.equal(dataset.itemFields.dom.ar.labels.Armour.text, "護甲");
assert.equal(dataset.itemFields.dom.ar.labels.Armour.source.kind, "trade-filter");
assert.deepEqual(
  dataset.itemFields.properties["Block chance"].source.evidenceIds,
  ["explicit.stat_4147897060", "explicit.stat_480796730"],
);
assert.equal(dataset.itemFields.dom.block.labels["Block chance"].source.kind, "property");
assert.equal(dataset.itemFields.dom.reload_time.labels["Reload Time"].text, "重新載入時間");
assert.equal(
  dataset.itemFields.dom.reload_time.labels["Reload Time"].source.kind,
  "trade-filter",
);
assert.ok(itemFieldCoverage.registry.automaticDomFields.includes("reload_time"));
assert.ok(itemFieldCoverage.registry.automaticProperties.includes("Reload Time"));
assert.ok(itemFieldCoverage.summary.automaticDomFieldCount > 10);
assert.equal(dataset.allocates["Overwhelming Strike"], "鎮壓打擊");
assert.equal(dataset.exact["Allocates Overwhelming Strike"], "配置 鎮壓打擊");
assert.ok(
  Object.keys(dataset.exact).length > 4_000,
  "官方 stable-ID、验证属性和 UI 生成的精确索引不得异常为空",
);
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
assert.equal(
  dataset.baseItems["Abyssal Flail"] ||
    dataset.fixedNames["Abyssal Flail"] ||
    dataset.items["Abyssal Flail"],
  "深淵鏈錘",
);
assert.equal(dataset.baseItems["Slim Mace"], "纖細之錘");
assert.equal(dataset.wordComponents.Golem, "魔像");
assert.equal(dataset.wordComponents[" Crack"], " 裂骨錘");
assert.equal(dataset.affixNames.prefixes.Frosted, "結霜的");
assert.equal(dataset.affixNames.suffixes["of the Fletcher"], "製箭者之");
assert.equal(dataset.affixNames.suffixes["of Osmosis"], "逆滲透之");
assert.equal(dataset.domains.itemName.schemaVersion, 1);
assert.deepEqual(
  dataset.domains.itemName.normalDisplayRules.map((rule) => rule.ruleId),
  ["client-string:QualityItem", "client-string:ExceptionalItem"],
);
assert.deepEqual(dataset.domains.itemName.normalDisplayRules[0].sourcePattern, {
  placeholder: "{0}",
  before: "Superior ",
  after: "",
});
assert.deepEqual(dataset.domains.itemName.normalDisplayRules[1].targetPattern, {
  placeholder: "{}",
  before: "卓越 ",
  after: "",
});
assert.equal(dataset.domains.grantedSkill.schemaVersion, 1);
assert.equal(dataset.domains.grantedSkill.skillNameSource, "baseItems");
assert.deepEqual(
  dataset.domains.grantedSkill.rules.map((rule) => rule.ruleId),
  [
    "client-string:ItemDisplayGrantedSkill",
    "client-string:ItemDisplayGrantedSkillNoScaling",
  ],
);
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
assert.deepEqual(dataset.stats.entries["explicit.stat_3639275092"].renderings, [{
  english: "#% reduced Attribute Requirements",
  text: "減少#%能力值需求",
  source: "ggpk-csd-signed-variant",
}]);

const listeners = {};
const emitted = [];
const sharedConfig = { textContent: "" };
let hook;
let protectedHook = false;
const context = vm.createContext({
  console,
  setTimeout,
  window: {},
  localStorage: {
    removed: [],
    values: new Map(
      ["items", "stats", "data", "filters"].flatMap((key) => [
        [`lscache-trade2${key}`, `stale-${key}`],
        [`lscache-trade2${key}-cacheexpiration`, `stale-${key}-expiry`],
      ]),
    ),
    getItem(key) {
      return this.values.get(key) ?? null;
    },
    setItem(key, value) {
      this.values.set(key, value);
    },
    removeItem(key) {
      this.removed.push(key);
      this.values.delete(key);
    },
  },
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
  fs.readFileSync(path.join(root, "extension/page/domains/item-name.js"), "utf8"),
  context,
  { filename: "item-name.js" },
);
vm.runInContext(
  fs.readFileSync(path.join(root, "extension/page/domains/granted-skill.js"), "utf8"),
  context,
  { filename: "granted-skill.js" },
);
vm.runInContext(
  fs.readFileSync(path.join(root, "extension/page/item-property-rendering.js"), "utf8"),
  context,
  { filename: "item-property-rendering.js" },
);
vm.runInContext(
  fs.readFileSync(path.join(root, "extension/page/stat-rendering.js"), "utf8"),
  context,
  { filename: "stat-rendering.js" },
);
vm.runInContext(
  fs.readFileSync(path.join(root, "extension/page/trade-hook.js"), "utf8"),
  context,
  { filename: "trade-hook.js" },
);

assert.equal(
  context.localStorage.getItem("poe2zh-trade2-catalog-schema"),
  "translated-api-v1",
  "翻译目录结构变化时必须写入精确版本标记",
);
for (const key of ["items", "stats", "data", "filters"]) {
  assert.equal(
    context.localStorage.getItem(`lscache-trade2${key}`),
    null,
    `必须清除官网旧 ${key} 目录`,
  );
  assert.equal(
    context.localStorage.getItem(`lscache-trade2${key}-cacheexpiration`),
    null,
    `必须清除官网旧 ${key} 目录过期键`,
  );
}
assert.deepEqual(
  context.localStorage.removed,
  ["items", "stats", "data", "filters"].flatMap((key) => [
    `lscache-trade2${key}`,
    `lscache-trade2${key}-cacheexpiration`,
  ]),
  "只能清除扩展实际翻译的四类官网目录缓存",
);

const removedAfterFirstLoad = context.localStorage.removed.length;
vm.runInContext(
  fs.readFileSync(path.join(root, "extension/page/trade-hook.js"), "utf8"),
  context,
  { filename: "trade-hook-second-load.js" },
);
assert.equal(
  context.localStorage.removed.length,
  removedAfterFirstLoad,
  "同一目录结构版本再次加载时不得重复清除官网缓存",
);

sharedConfig.textContent = JSON.stringify({
  dataset,
  enabled: true,
  mode: "bilingual",
});
listeners["poe2zh:configure"]();
assert.equal(protectedHook, true);

const coldAlias = `${dataset.baseItems["Sinister Quarterstaff"]} (Sinister Quarterstaff)`;
const coldSearchRequest = {
  url: "https://www.pathofexile.com/api/trade2/search/poe2/Runes%20of%20Aldur",
  data: JSON.stringify({ query: { type: coldAlias } }),
};
hook(coldSearchRequest);
assert.equal(
  JSON.parse(coldSearchRequest.data).query.type,
  "Sinister Quarterstaff",
  "即使官网物品目录来自缓存，也必须用正式词库还原中文搜索别名",
);
const forgedAlias = "非正式翻译 (Sinister Quarterstaff)";
const forgedSearchRequest = {
  url: coldSearchRequest.url,
  data: JSON.stringify({ query: { type: forgedAlias } }),
};
hook(forgedSearchRequest);
assert.equal(
  JSON.parse(forgedSearchRequest.data).query.type,
  forgedAlias,
  "不在正式词库中的括号文本不得被猜测还原",
);

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

const [itemEn, itemZh] = Object.entries(dataset.baseItems)[0];
const itemRequest = { url: "https://www.pathofexile.com/api/trade2/data/items" };
hook(itemRequest);
const itemResponse = {
  responseText: JSON.stringify({
    result: [{ id: "test", entries: [{ type: itemEn, text: itemEn }] }],
  }),
};
await itemRequest.response(itemResponse);
const searchableItem = JSON.parse(itemResponse.responseText).result[0].entries[0];
assert.match(searchableItem.text, new RegExp(itemZh));
assert.equal(
  searchableItem.type,
  `${itemZh} (${itemEn})`,
  "物品目录的 type 必须提供可逆的中文搜索别名",
);

const searchBody = {
  query: {
    name: "未改动的官方名称",
    type: searchableItem.type,
    stats: [{ type: "and", filters: [] }],
  },
  sort: { price: "asc" },
};
const searchRequest = {
  url: "https://www.pathofexile.com/api/trade2/search/poe2/Runes%20of%20Aldur",
  data: JSON.stringify(searchBody),
};
hook(searchRequest);
const restoredSearchBody = JSON.parse(searchRequest.data);
assert.equal(restoredSearchBody.query.type, itemEn, "发往官网的 type 必须还原为精确英文");
assert.equal(restoredSearchBody.query.name, searchBody.query.name, "非别名字段不得被改写");
assert.deepEqual(restoredSearchBody.query.stats, searchBody.query.stats, "筛选条件不得被改写");
assert.deepEqual(restoredSearchBody.sort, searchBody.sort, "排序条件不得被改写");

const malformedSearchRequest = {
  url: "https://www.pathofexile.com/api/trade2/search/poe2/test",
  data: "not-json",
};
hook(malformedSearchRequest);
assert.equal(malformedSearchRequest.data, "not-json", "未知请求格式必须原样放行");

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

const exceptionalNormalRequest = {
  url: "https://www.pathofexile.com/api/trade2/fetch/exceptional-normal-test",
};
hook(exceptionalNormalRequest);
const exceptionalNormalResponse = {
  responseText: JSON.stringify({
    result: [{ item: {
      frameType: 0,
      baseType: "Reaping Staff",
      typeLine: "Exceptional Reaping Staff",
      properties: [],
      requirements: [],
    } }],
  }),
};
await exceptionalNormalRequest.response(exceptionalNormalResponse);
const translatedExceptionalNormal =
  JSON.parse(exceptionalNormalResponse.responseText).result[0].item;
assert.equal(translatedExceptionalNormal.baseType, "死神長杖 (Reaping Staff)");
assert.equal(
  translatedExceptionalNormal.typeLine,
  "卓越 死神長杖 (Exceptional Reaping Staff)",
);

const knownPropertyRequest = {
  url: "https://www.pathofexile.com/api/trade2/fetch/known-property-routing-test",
};
hook(knownPropertyRequest);
const emittedBeforeKnownProperties = emitted.length;
const knownPropertyResponse = {
  responseText: JSON.stringify({
    result: [{ item: {
      frameType: 3,
      properties: [
        { name: "Staff", values: [], type: 109 },
        { name: "[ElementalDamage|Elemental] Damage", values: [["1-10", 1]], type: 11 },
        { name: "Ezomyte Staff", values: [], type: 109 },
        { name: "Vaal Helmet", values: [], type: 109 },
      ],
      requirements: [],
    } }],
  }),
};
await knownPropertyRequest.response(knownPropertyResponse);
const translatedKnownProperties =
  JSON.parse(knownPropertyResponse.responseText).result[0].item.properties;
assert.equal(translatedKnownProperties[0].name, "長杖 (Staff)");
assert.equal(
  translatedKnownProperties[1].name,
  "元素傷害 (Elemental Damage)",
);
assert.equal(translatedKnownProperties[2].name, "艾茲麥長杖 (Ezomyte Staff)");
assert.equal(translatedKnownProperties[3].name, "瓦爾頭盔 (Vaal Helmet)");
assert.equal(
  emitted.length,
  emittedBeforeKnownProperties,
  "官方属性索引已经解析的标签不得再触发漏译上报",
);

const grantedSkillRequest = {
  url: "https://www.pathofexile.com/api/trade2/fetch/granted-skill-routing-test",
};
hook(grantedSkillRequest);
const emittedBeforeGrantedSkill = emitted.length;
const grantedSkillResponse = {
  responseText: JSON.stringify({
    result: [{ item: {
      frameType: 3,
      properties: [
        { name: "Grants Skill: Spear Throw", values: [] },
        { name: "Grants Skill: Level 8 Fireball", values: [] },
      ],
      grantedSkills: [
        { name: "Grants Skill", values: [["Level 20 Solar Orb", 4]], type: "skill.solar_orb" },
      ],
      requirements: [],
    } }],
  }),
};
await grantedSkillRequest.response(grantedSkillResponse);
const translatedGrantedSkills =
  JSON.parse(grantedSkillResponse.responseText).result[0].item.properties;
const translatedGrantedSkillEntries =
  JSON.parse(grantedSkillResponse.responseText).result[0].item.grantedSkills;
assert.equal(
  translatedGrantedSkills[0].name,
  "賦予技能: 長矛投擲 (Grants Skill: Spear Throw)",
);
assert.equal(
  translatedGrantedSkills[1].name,
  "賦予技能: 8 級 火球 (Grants Skill: Level 8 Fireball)",
);
assert.equal(translatedGrantedSkillEntries[0].name, "賦予技能");
assert.equal(
  translatedGrantedSkillEntries[0].values[0][0],
  "20 級 日耀球 (Grants Skill: Level 20 Solar Orb)",
  "官网拆分的 Grants Skill 名称和值必须通过同一官方模板重组",
);
assert.equal(
  emitted.length,
  emittedBeforeGrantedSkill,
  "GGPK 官方模板和技能名称均命中时不得触发漏译上报",
);

const unknownGrantedSkillRequest = {
  url: "https://www.pathofexile.com/api/trade2/fetch/unknown-granted-skill-test",
};
hook(unknownGrantedSkillRequest);
const emittedBeforeUnknownGrantedSkill = emitted.length;
const unknownGrantedSkillResponse = {
  responseText: JSON.stringify({
    result: [{ item: {
      frameType: 3,
      properties: [{ name: "Grants Skill: Unverified Skill", values: [] }],
      requirements: [],
    } }],
  }),
};
await unknownGrantedSkillRequest.response(unknownGrantedSkillResponse);
assert.equal(
  JSON.parse(unknownGrantedSkillResponse.responseText).result[0].item.properties[0].name,
  "Grants Skill: Unverified Skill",
  "未知技能必须整行保留英文",
);
assert.equal(emitted.length, emittedBeforeUnknownGrantedSkill + 1);
assert.equal(emitted.at(-1).detail.key, "Unverified Skill");
assert.equal(emitted.at(-1).detail.domain, "item-skill.granted");
assert.equal(emitted.at(-1).detail.reason, "missing-skill-name");

const unknownType109Request = {
  url: "https://www.pathofexile.com/api/trade2/fetch/unknown-type109-test",
};
hook(unknownType109Request);
const emittedBeforeUnknownType109 = emitted.length;
const unknownType109Response = {
  responseText: JSON.stringify({
    result: [{ item: {
      frameType: 3,
      properties: [{ name: "Unknown Culture Helmet", values: [], type: 109 }],
      requirements: [],
    } }],
  }),
};
await unknownType109Request.response(unknownType109Response);
assert.equal(
  JSON.parse(unknownType109Response.responseText).result[0].item.properties[0].name,
  "Unknown Culture Helmet",
);
assert.equal(emitted.length, emittedBeforeUnknownType109 + 1);
assert.equal(emitted.at(-1).detail.key, "Unknown Culture Helmet");
assert.equal(emitted.at(-1).detail.context, "item-property:type-109");

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

const inlineHashRequest = {
  url: "https://www.pathofexile.com/api/trade2/fetch/inline-hash",
};
hook(inlineHashRequest);
const inlineHashResponse = {
  responseText: JSON.stringify({
    result: [{ item: {
      explicitMods: [{
        description: "40% reduced [Attributes|Attribute] Requirements",
        domain: "explicit",
        hash: "stat.explicit.stat_3639275092",
      }],
      extended: {
        hashes: { explicit: [["explicit.stat_3639275092", [4]]] },
      },
    } }],
  }),
};
await inlineHashRequest.response(inlineHashResponse);
assert.equal(
  JSON.parse(inlineHashResponse.responseText).result[0].item.explicitMods[0].description,
  "減少40%能力值需求 (40% reduced [Attributes|Attribute] Requirements)",
  "mod 对象自身的稳定 hash 必须优先于 extended.hashes 中非数组位置的数字",
);

const conflictingInlineHashRequest = {
  url: "https://www.pathofexile.com/api/trade2/fetch/conflicting-inline-hash",
};
hook(conflictingInlineHashRequest);
const conflictingInlineHashResponse = {
  responseText: JSON.stringify({
    result: [{ item: {
      explicitMods: [{
        description: "40% reduced [Attributes|Attribute] Requirements",
        domain: "explicit",
        hash: "stat.explicit.stat_2923486259",
      }],
      extended: { hashes: { explicit: [] } },
    } }],
  }),
};
await conflictingInlineHashRequest.response(conflictingInlineHashResponse);
assert.equal(
  JSON.parse(conflictingInlineHashResponse.responseText).result[0].item.explicitMods[0].description,
  "40% reduced [Attributes|Attribute] Requirements",
  "inline hash 与句式不符时必须保留英文，不能借用其他 stat ID 的 signed rendering",
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

const signedRenderingRequest = {
  url: "https://www.pathofexile.com/api/trade2/fetch/signed-rendering",
};
hook(signedRenderingRequest);
const emittedBeforeSignedRendering = emitted.length;
const signedRenderingResponse = {
  responseText: JSON.stringify({
    result: [{ item: {
      explicitMods: [
        "40% reduced Attribute Requirements",
        "40% increased Attribute Requirements",
        "40% diminished Attribute Requirements",
      ],
      extended: { hashes: { explicit: [["explicit.stat_3639275092", [0, 1, 2]]] } },
    } }],
  }),
};
await signedRenderingRequest.response(signedRenderingResponse);
const signedMods = JSON.parse(signedRenderingResponse.responseText).result[0].item.explicitMods;
assert.equal(
  signedMods[0],
  "減少40%能力值需求 (40% reduced Attribute Requirements)",
  "同一 stat ID 的 reduced 变体必须采用 GGPK 同描述块官方译文",
);
assert.equal(
  signedMods[1],
  "增加40%能力值需求 (40% increased Attribute Requirements)",
  "正数目录模板必须继续正常渲染",
);
assert.equal(
  signedMods[2],
  "40% diminished Attribute Requirements",
  "没有官方声明的形态必须保留英文，不能猜测增减语义",
);
assert.equal(emitted.length, emittedBeforeSignedRendering + 1);
assert.equal(emitted.at(-1).detail.context, "fetch:explicit:association-mismatch");

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
