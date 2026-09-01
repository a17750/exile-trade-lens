import assert from "node:assert/strict";
import path from "node:path";
import { dataPath, readJson, rootPath } from "./lib/project.mjs";
import { diffSnapshots } from "./lib/audit.mjs";
import { countPlaceholders } from "./lib/translation-engine.mjs";
import { createOfficialTwOverlay } from "./lib/official-tw.mjs";

const ggpkSource = readJson(path.join(rootPath, "data", "ggpk.json"));
const tradeApiSource = readJson(path.join(rootPath, "data", "trade-api.json"));
const ggpkManifest = ggpkSource.manifest;
const ggpkBaseItems = ggpkSource.baseItems;
const ggpkWords = ggpkSource.words;
const ggpkAffixes = ggpkSource.affixes;
const ggpkClientStrings = ggpkSource.clientStrings;
const ggpkPassiveSkills = ggpkSource.passiveSkills;
const ggpkStatDescriptions = ggpkSource.statDescriptions;
const verifiedStatRenderings = readJson(
  path.join(dataPath, "verified-stat-renderings.zh-TW.json"),
);

assert.equal(ggpkManifest.safety.fileAccess, "Read");
assert.equal(tradeApiSource.schemaVersion, 1);
assert.equal(tradeApiSource.locale, "zh-TW");
assert.equal(tradeApiSource.source, "official-trade-api-pair");
assert.ok(tradeApiSource.english.sections.stats.entries);
assert.ok(tradeApiSource.zhTW.sections.stats.entries);
assert.ok(tradeApiSource.overlay.sections.stats.entries);
assert.equal(
  tradeApiSource.overlay.report.source,
  tradeApiSource.endpoints.zhTW,
);
assert.equal(ggpkManifest.safety.rawTablesWritten, false);
assert.equal(ggpkManifest.safety.gameDirectoryWritten, false);
assert.ok(ggpkManifest.coverage.combinedUsablePercent >= 80);
assert.equal(ggpkBaseItems.byEnglish["Slim Mace"], "纖細之錘");
assert.equal(ggpkWords.byEnglish.Golem, "魔像");
assert.equal(ggpkAffixes.schema.includedDomain, "ITEM");
assert.equal(ggpkAffixes.schema.rowSize, 677);
assert.equal(ggpkAffixes.prefixes.Frosted, "結霜的");
assert.equal(ggpkAffixes.suffixes["of the Fletcher"], "製箭者之");
assert.equal(ggpkAffixes.suffixes["of Osmosis"], "逆滲透之");
assert.equal(ggpkClientStrings.byId.QualityItem.english, "Superior {0}");
assert.equal(ggpkClientStrings.byId.QualityItem.zhTW, "精良的 {0}");
assert.equal(ggpkClientStrings.byId.ExceptionalItem.english, "Exceptional {}");
assert.equal(ggpkClientStrings.byId.ExceptionalItem.zhTW, "卓越 {}");
assert.equal(
  ggpkClientStrings.byId.ItemDisplayGrantedSkill.english,
  "Grants Skill: <underline>{{Level {1} {0}}}",
);
assert.equal(
  ggpkClientStrings.byId.ItemDisplayGrantedSkillNoScaling.zhTW,
  "賦予技能: <underline>{{{0}}}",
);
assert.equal(ggpkBaseItems.byEnglish["Spear Throw"], "長矛投擲");
assert.equal(ggpkPassiveSkills.schema.nameOffset, 50);
assert.equal(ggpkPassiveSkills.byEnglish["Overwhelming Strike"], "鎮壓打擊");
assert.ok(Object.keys(ggpkStatDescriptions.byEnglish).length > 10000);
assert.equal(
  ggpkStatDescriptions.byEnglish["# to Strength and Dexterity"],
  "#點力量與敏捷",
);
assert.ok(Object.keys(ggpkStatDescriptions.signedVariants.byPositiveEnglish).length > 1000);
assert.deepEqual(
  ggpkStatDescriptions.signedVariants.byPositiveEnglish["#% increased Attribute Requirements"],
  {
    positiveEnglish: "#% increased Attribute Requirements",
    positiveZhTW: "增加#%能力值需求",
    negativeEnglish: "#% reduced Attribute Requirements",
    negativeZhTW: "減少#%能力值需求",
    source: "stat_descriptions.csd",
    positiveCondition: "1|#",
    negativeCondition: "#|-1",
    negate: true,
  },
);
assert.ok(ggpkAffixes.records.every((record) => record.domain === "item"));
const poisonRendering =
  verifiedStatRenderings.statsById["explicit.stat_3885634897"].variants[0];
assert.equal(poisonRendering.english, "Always Poison on Hit with this weapon");
assert.equal(poisonRendering.text, "用此武器擊中時會造成中毒");
assert.equal(poisonRendering.evidence.english.hash, poisonRendering.evidence.zhTW.hash);
assert.equal(poisonRendering.evidence.english.hash, "stat.explicit.stat_3885634897");
assert.match(poisonRendering.evidence.english.itemId, /^[a-f0-9]{64}$/);
assert.match(poisonRendering.evidence.zhTW.itemId, /^[a-f0-9]{64}$/);
for (const conflict of ggpkAffixes.conflicts.prefixes) {
  assert.equal(ggpkAffixes.prefixes[conflict.english], undefined);
}
for (const conflict of ggpkAffixes.conflicts.suffixes) {
  assert.equal(ggpkAffixes.suffixes[conflict.english], undefined);
}
assert.equal(ggpkBaseItems.byEnglish["Calamity Fragment"], undefined);

assert.equal(countPlaceholders("+#% to # Things"), 2);

const baseline = {
  fetchedAt: "before",
  sections: {
    stats: {
      groups: { explicit: "Explicit" },
      entries: { test: { english: "Old English", groupId: "explicit", options: {} } },
    },
  },
};
const current = {
  fetchedAt: "after",
  sections: {
    stats: {
      groups: { explicit: "Explicit" },
      entries: {
        test: { english: "New English", groupId: "explicit", options: {} },
        added: { english: "Added English", groupId: "explicit", options: {} },
      },
    },
  },
};
const diff = diffSnapshots(baseline, current);
assert.equal(diff.changed.length, 1);
assert.equal(diff.changed[0].previousEnglish, "Old English");
assert.equal(diff.added.length, 1);

const englishSnapshot = {
  fetchedAt: "english",
  source: "en",
  sections: {
    items: { groups: { weapon: "Weapons" }, entries: { "Abyssal Flail": { english: "Abyssal Flail", contexts: ["weapon:type"] } } },
    stats: { groups: { pseudo: "Pseudo" }, entries: { resistance: { english: "# total Elemental Resistances", groupId: "pseudo", options: {} } } },
    static: { groups: { Currency: "Currency" }, entries: { chaos: { english: "Chaos Orb", groupId: "Currency", options: {} } } },
    filters: { groups: { map_filters: "Endgame Filters" }, entries: { map_magic_monsters: { english: "Monster Effectiveness", groupId: "map_filters", options: { any: "Any" } } } },
  },
};
const translatedSnapshot = {
  fetchedAt: "translated",
  source: "tw",
  sections: {
    items: { groups: { weapon: "武器" }, entries: { 深淵鏈錘: { english: "深淵鏈錘", contexts: ["weapon:type"] } } },
    stats: { groups: { pseudo: "偽屬性" }, entries: { resistance: { english: "# 元素抗性", groupId: "pseudo", options: {} } } },
    static: { groups: { Currency: "通貨" }, entries: { chaos: { english: "混沌石", groupId: "Currency", options: {} } } },
    filters: { groups: { map_filters: "終局篩選器" }, entries: { map_magic_monsters: { english: "怪物效用", groupId: "map_filters", options: { any: "任何" } } } },
  },
};
const officialTw = createOfficialTwOverlay({
  englishSnapshot,
  translatedSnapshot,
  englishRaw: { items: { result: [{ id: "weapon", entries: [{ id: "abyssal-flail", type: "Abyssal Flail" }] }] } },
  translatedRaw: { items: { result: [{ id: "weapon", entries: [{ id: "abyssal-flail", type: "深淵鏈錘" }] }] } },
});
assert.equal(officialTw.sections.filters.entries.map_magic_monsters.text, "怪物效用");
assert.equal(officialTw.sections.stats.entries.resistance.text, "# 元素抗性");
assert.equal(officialTw.sections.filters.entries.map_magic_monsters.options.any, "任何");
assert.equal(officialTw.items["Abyssal Flail"], "深淵鏈錘");
assert.equal(officialTw.report.summary.rejected, 0);

const unsafeItems = createOfficialTwOverlay({
  englishSnapshot,
  translatedSnapshot,
  englishRaw: { items: { result: [{ id: "weapon", entries: [{ type: "Abyssal Flail" }, { type: "Iron Flail" }] }] } },
  translatedRaw: { items: { result: [{ id: "weapon", entries: [{ type: "深淵鏈錘" }] }] } },
});
assert.equal(Object.keys(unsafeItems.items).length, 0);
assert.equal(unsafeItems.report.itemAlignment.skippedGroups[0].reason, "entries-without-stable-key");

console.log("pipeline-test: ok");
