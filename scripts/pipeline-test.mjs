import assert from "node:assert/strict";
import path from "node:path";
import { readJson, sourcesPath } from "./lib/project.mjs";
import { diffSnapshots } from "./lib/audit.mjs";
import { countPlaceholders, createCandidateEngine } from "./lib/translation-engine.mjs";
import { createOfficialTwOverlay } from "./lib/official-tw.mjs";

const ggpkManifest = readJson(path.join(sourcesPath, "generated", "ggpk", "manifest.json"));
const ggpkBaseItems = readJson(path.join(sourcesPath, "generated", "ggpk", "base-items.zh-TW.json"));
const ggpkWords = readJson(path.join(sourcesPath, "generated", "ggpk", "words.zh-TW.json"));
const ggpkAffixes = readJson(path.join(sourcesPath, "generated", "ggpk", "affixes.zh-TW.json"));
const ggpkClientStrings = readJson(
  path.join(sourcesPath, "generated", "ggpk", "client-strings.zh-TW.json"),
);
const verifiedStatRenderings = readJson(
  path.join(sourcesPath, "verified-stat-renderings.zh-TW.json"),
);

assert.equal(ggpkManifest.safety.fileAccess, "Read");
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

const glossary = readJson(path.join(sourcesPath, "glossary.zh-TW.json"));
const phrases = readJson(path.join(sourcesPath, "phrase-exceptions.zh-TW.json"));
const suggest = createCandidateEngine(glossary, phrases);

const composed = suggest("Abyssal Flail", "item");
assert.equal(composed.text, "深淵鏈錘");
assert.equal(composed.method, "glossary-composition");
assert.equal(composed.status, "needs-review");
assert.ok(composed.confidence < 0.9);

const exception = suggest("Abyssal Signet", "item");
assert.equal(exception.text, "深淵之記");
assert.equal(exception.method, "phrase-exception");
assert.equal(exception.confidence, 1);
assert.equal(suggest("Unknown Unmapped Thing", "item"), null);
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
