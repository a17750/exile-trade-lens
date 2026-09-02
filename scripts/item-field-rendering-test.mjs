import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataset = JSON.parse(fs.readFileSync(path.join(root, "extension/data/bundled.json"), "utf8"));

const propertyContext = vm.createContext({});
vm.runInContext(
  fs.readFileSync(path.join(root, "extension/page/item-property-rendering.js"), "utf8"),
  propertyContext,
);
const propertyRenderer = vm.runInContext("globalThis.POE2ZHItemPropertyRendering", propertyContext);
for (const [english, translated] of Object.entries({
  Armour: "護甲",
  "Evasion Rating": "閃避值",
  Level: "等級",
  Str: "力量",
  Int: "智慧",
  "Physical Damage": "物理傷害",
  "Critical Hit Chance": "暴擊機率",
  "Block chance": "格擋機率",
  Quality: "品質",
  "Reload Time": "重新裝填時間",
})) {
  const property = { name: english };
  let formattedEnglish = null;
  propertyRenderer.translate(property, {
    translations: dataset.itemPropertyIndex,
    fallbackTranslations: dataset.properties,
    format: (text, original) => {
      formattedEnglish = original;
      return text;
    },
  });
  assert.equal(property.name, translated, `/fetch 属性 ${english} 应使用已绑定官方来源`);
  assert.equal(formattedEnglish, english, "Tooltip 原文必须是清理后的显示英文，而不是 GGPK 标记");
}

const taggedDexterity = { name: "[Dexterity|Dex]" };
let taggedOriginal = null;
propertyRenderer.translate(taggedDexterity, {
  translations: dataset.itemPropertyIndex,
  fallbackTranslations: dataset.properties,
  format: (text, original) => {
    taggedOriginal = original;
    return text;
  },
});
assert.equal(taggedDexterity.name, "敏捷");
assert.equal(taggedOriginal, "Dex");
const unknown = { name: "Unknown Property" };
let missing = null;
propertyRenderer.translate(unknown, {
  translations: dataset.itemPropertyIndex,
  fallbackTranslations: dataset.properties,
  format: (text) => text,
  onMissing: (english) => { missing = english; },
});
assert.equal(unknown.name, "Unknown Property");
assert.equal(missing, "Unknown Property");

for (const [english, expected] of Object.entries({
  Staff: "長杖",
  "Elemental Damage": "元素傷害",
})) {
  const property = { name: english };
  let reported = null;
  propertyRenderer.translate(property, {
    translations: dataset.itemPropertyIndex,
    fallbackTranslations: {},
    format: (text) => text,
    onMissing: (value) => { reported = value; },
  });
  assert.equal(property.name, expected, `${english} 应由统一物品属性索引解析`);
  assert.equal(reported, null, `${english} 已有官方来源时不得上报`);
}

for (const [english, expected] of Object.entries({
  "Ezomyte Staff": "艾茲麥長杖",
  "Vaal Helmet": "瓦爾頭盔",
  "Ezomyte Body Armour": "艾茲麥胸甲",
  "One Hand Sword": "單手劍",
  "Two Hand Axe": "雙手斧",
  "Ezomyte One Hand Sword": "艾茲麥單手劍",
})) {
  const property = { name: english, values: [], type: 109 };
  let reported = null;
  propertyRenderer.translate(property, {
    translations: dataset.itemPropertyIndex,
    fallbackTranslations: dataset.properties,
    type109: dataset.itemPropertyType109,
    format: (text) => text,
    onMissing: (value, detail) => { reported = { value, detail }; },
  });
  assert.equal(property.name, expected, `${english} 应按 type 109 结构化渲染`);
  assert.equal(reported, null);
}

const unknownType109 = { name: "Unknown Culture Helmet", values: [], type: 109 };
let unknownType109Report = null;
propertyRenderer.translate(unknownType109, {
  translations: dataset.itemPropertyIndex,
  fallbackTranslations: dataset.properties,
  type109: dataset.itemPropertyType109,
  format: (text) => text,
  onMissing: (value, detail) => { unknownType109Report = { value, detail }; },
});
assert.equal(unknownType109.name, "Unknown Culture Helmet");
assert.equal(unknownType109Report.value, "Unknown Culture Helmet");
assert.equal(unknownType109Report.detail.kind, "type-109");
assert.equal(unknownType109Report.detail.qualifier, "Unknown Culture");
assert.equal(unknownType109Report.detail.itemClass, "Helmet");

const wrongDomain = { name: "Ezomyte Staff", values: [], type: 0 };
propertyRenderer.translate(wrongDomain, {
  translations: dataset.itemPropertyIndex,
  fallbackTranslations: dataset.properties,
  type109: dataset.itemPropertyType109,
  format: (text) => text,
});
assert.equal(wrongDomain.name, "Ezomyte Staff", "type 109 规则不得跨属性类型生效");

const annotations = [];
const missingEvents = [];
const document = {
  createTreeWalker(element) {
    let index = 0;
    return { nextNode: () => element.textNodes[index++] ?? null };
  },
  dispatchEvent(event) { missingEvents.push(event); },
};
const contentContext = vm.createContext({
  document,
  CustomEvent: class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init?.detail; }
  },
  Node: { ELEMENT_NODE: 1 },
  NodeFilter: { SHOW_TEXT: 4 },
});
contentContext.annotations = annotations;
contentContext.POE2ZHOriginalTooltip = {
  annotate(element, original) { annotations.push({ element, original }); },
};
vm.runInContext(
  fs.readFileSync(path.join(root, "extension/content/item-card-fields.js"), "utf8"),
  contentContext,
);
const cardRenderer = vm.runInContext("globalThis.POE2ZHItemCardFields", contentContext);

function fieldElement(field, text) {
  return {
    nodeType: 1,
    textNodes: [{ nodeValue: text }],
    getAttribute(name) { return name === "data-field" ? field : null; },
    closest() { return this; },
    matches(selector) { return selector === "[data-field]"; },
    querySelectorAll() { return []; },
  };
}

cardRenderer.configure({ enabled: true, mode: "translated", fields: dataset.itemFields.dom });
const armour = fieldElement("ar", "Armour");
cardRenderer.translateRoot(armour);
assert.equal(armour.textNodes[0].nodeValue, "護甲");
assert.equal(annotations.at(-1).original, "Armour");

cardRenderer.configure({ enabled: true, mode: "bilingual", fields: dataset.itemFields.dom });
const pdps = fieldElement("pdps", "Physical DPS");
cardRenderer.translateRoot(pdps);
assert.equal(pdps.textNodes[0].nodeValue, "物理傷害 (Physical DPS)");
assert.equal(annotations.length, 1, "双语模式不应重复挂载英文 Tooltip");

cardRenderer.configure({ enabled: true, mode: "translated", fields: dataset.itemFields.dom });
const block = fieldElement("block", "Block chance");
cardRenderer.translateRoot(block);
assert.equal(block.textNodes[0].nodeValue, "格擋機率");
assert.equal(annotations.at(-1).original, "Block chance");
const quality = fieldElement("quality", "Quality");
cardRenderer.translateRoot(quality);
assert.equal(quality.textNodes[0].nodeValue, "品質");
assert.equal(annotations.at(-1).original, "Quality");
const reloadTime = fieldElement("reload_time", "Reload Time");
cardRenderer.translateRoot(reloadTime);
assert.equal(reloadTime.textNodes[0].nodeValue, "重新載入時間");
assert.equal(annotations.at(-1).original, "Reload Time");

const unrelated = fieldElement("price", "Exact Price");
cardRenderer.translateRoot(unrelated);
assert.equal(unrelated.textNodes[0].nodeValue, "Exact Price", "未声明字段必须保持原文");
assert.deepEqual(
  JSON.parse(JSON.stringify(missingEvents.at(-1)?.detail)),
  {
    type: "property",
    key: "data-field:price",
    en: "Exact Price",
    context: "item-card:data-field",
    region: "result-card",
    source: "item-card-field",
  },
  "未知 data-field 只能上报稳定字段名和纯英文标签",
);

const valueOnly = fieldElement("unknown_value", "0.75");
cardRenderer.translateRoot(valueOnly);
assert.equal(missingEvents.length, 1, "纯数值不得作为未知物品字段上报");

const changedOfficialLabel = fieldElement("reload_time", "Weapon Reload Time");
cardRenderer.translateRoot(changedOfficialLabel);
assert.equal(missingEvents.length, 2, "已知 ID 出现新英文标签时也必须进入自检");
assert.equal(missingEvents.at(-1).detail.key, "data-field:reload_time");
assert.equal(missingEvents.at(-1).detail.en, "Weapon Reload Time");

console.log("item field rendering test passed");
