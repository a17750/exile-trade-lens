import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { compileSkillGemDomain } from "./domains/skill-gem.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policy = JSON.parse(fs.readFileSync(path.join(root, "data/domain-policies.json"), "utf8"));
const ggpk = JSON.parse(fs.readFileSync(path.join(root, "data/ggpk.json"), "utf8"));
const officialTags = JSON.parse(
  fs.readFileSync(path.join(root, "data/skill-tags.zh-TW.json"), "utf8"),
);
const compilation = compileSkillGemDomain(
  policy.domains.skillGem,
  ggpk.clientStrings,
  ggpk.linkedTerms,
  ggpk.skillGemTags,
  officialTags,
);

assert.equal(compilation.domain.tags.bySemanticId.Attack, "攻擊");
assert.equal(compilation.domain.tags.bySemanticId.AoESkill, "範圍效果");
assert.equal(compilation.domain.tags.bySemanticId.Payoff, "遣散");
assert.equal(compilation.domain.tags.bySemanticId.Merging, "融合");
assert.equal(compilation.domain.tags.bySemanticId.Chaining, "連鎖");
assert.equal(compilation.domain.tags.bySemanticId.Sustained, "持續性");
assert.equal(compilation.domain.tags.bySemanticId.DurationSkill, "持續時間");
assert.equal(compilation.domain.tags.bySemanticId.Channelling, "引導");
assert.equal(compilation.domain.tags.bySemanticId.Travel, "快行");
assert.equal(compilation.domain.tags.bySemanticId.Chain, "連鎖");
assert.equal(compilation.report.sourcesBySemanticId.Attack, "ggpk:GemTags");
assert.equal(compilation.report.sourcesBySemanticId.Chaining, "official-tw-trade-fallback");
assert.equal(compilation.report.summary.ggpkSemanticTags, 55);
assert.equal(compilation.domain.propertyLabels["Attack Time"], "攻擊時間");
assert.equal(compilation.domain.resources.Ward, "保護");
assert.throws(
  () => compileSkillGemDomain(
    policy.domains.skillGem,
    { ...ggpk.clientStrings, byId: {
      ...ggpk.clientStrings.byId,
      ItemDisplaySkillGemManaCost: { english: "Cost", zhTW: "未审核译文" },
    } },
    ggpk.linkedTerms,
    ggpk.skillGemTags,
    officialTags,
  ),
  /审核断言不一致/,
);

const conflictingTrade = structuredClone(officialTags);
conflictingTrade.records.find((record) => record.semanticId === "Attack").zhTW = "错误覆盖";
const precedence = compileSkillGemDomain(
  policy.domains.skillGem,
  ggpk.clientStrings,
  ggpk.linkedTerms,
  ggpk.skillGemTags,
  conflictingTrade,
);
assert.equal(precedence.domain.tags.bySemanticId.Attack, "攻擊");
assert.deepEqual(precedence.report.tradeConflicts[0], {
  semanticId: "Attack",
  ggpk: "攻擊",
  trade: "错误覆盖",
  evidence: "category-corpus.zh-TW:gem",
  resolution: "kept-ggpk",
});

const context = vm.createContext({});
vm.runInContext(
  fs.readFileSync(path.join(root, "extension/page/domains/skill-gem.js"), "utf8"),
  context,
);
const renderer = vm.runInContext("globalThis.POE2ZHSkillGemDomain", context);
const reports = [];
const options = {
  domain: compilation.domain,
  format: (translated, original) => `${translated} (${original})`,
  onMissing: (english, detail) => reports.push({ english, detail }),
};
const gem = {
  frameType: 4,
  frameTypeId: "Gem",
  properties: [
    { name: "[Attack], [AoESkill|AoE], [Ammunition], [Projectile], [Lightning], [Payoff]", values: [] },
    { name: "Level", values: [["20 (Max)", 0]] },
    { name: "Cost", values: [["108 Ward", 0]] },
    { name: "Attack Time", values: [["0.75s", 0]] },
    { name: "Attack Damage", values: [["62%", 0]] },
  ],
};
const result = renderer.translateItem(gem, options);
assert.equal(result.applicable, true);
assert.equal(
  gem.properties[0].name,
  "攻擊, 範圍效果, 彈藥, 投射物, 閃電, 遣散 (Attack, AoE, Ammunition, Projectile, Lightning, Payoff)",
);
assert.equal(gem.properties[1].values[0][0], "20（最高等級） (20 (Max))");
assert.equal(gem.properties[2].name, "消耗 (Cost)");
assert.equal(gem.properties[2].values[0][0], "108 保護 (108 Ward)");
assert.equal(gem.properties[3].name, "攻擊時間 (Attack Time)");
assert.equal(gem.properties[3].values[0][0], "0.75 秒 (0.75s)");
assert.equal(gem.properties[4].name, "攻擊傷害 (Attack Damage)");
assert.equal(gem.properties[4].values[0][0], "62%");
assert.equal(result.handled.has(gem.properties[0]), true);
assert.equal(result.handled.has(gem.properties[1]), false, "Level 标签仍交给通用稳定字段领域");
assert.equal(reports.length, 0);

const volcano = {
  frameType: 4,
  frameTypeId: "Gem",
  properties: [
    {
      name: "[Spell], [AoESkill|AoE], [Projectile], [Sustained], [Fire], [DurationSkill|Duration], [Channelling]",
      values: [],
    },
    { name: "Cost", values: [["15 Mana, 12.7 Mana per second", 0]] },
  ],
};
renderer.translateItem(volcano, options);
assert.equal(
  volcano.properties[0].name,
  "法術, 範圍效果, 投射物, 持續性, 火焰, 持續時間, 引導 (Spell, AoE, Projectile, Sustained, Fire, Duration, Channelling)",
);
assert.equal(
  volcano.properties[1].values[0][0],
  "15 魔力, 每秒 12.7 魔力 (15 Mana, 12.7 Mana per second)",
);

const singleTagGem = {
  frameType: 4,
  frameTypeId: "Gem",
  properties: [
    { name: "[SupportGem|Support]", values: [] },
    { name: "Reservation", values: [["100 [Spirit]", 0]] },
  ],
};
renderer.translateItem(singleTagGem, options);
assert.equal(singleTagGem.properties[0].name, "輔助 (Support)");
assert.equal(singleTagGem.properties[1].name, "保留 (Reservation)");
assert.equal(singleTagGem.properties[1].values[0][0], "100 精魂 (100 [Spirit])");

const unknownTag = {
  frameType: 4,
  properties: [{ name: "[Attack], [FutureTag]", values: [] }],
};
renderer.translateItem(unknownTag, options);
assert.equal(unknownTag.properties[0].name, "[Attack], [FutureTag]");
assert.equal(reports.at(-1).detail.reason, "unknown-skill-tag");
assert.equal(reports.at(-1).detail.semanticId, "FutureTag");

const weapon = {
  frameType: 0,
  frameTypeId: "Normal",
  properties: [{ name: "Cost", values: [["10 Mana", 0]] }],
};
assert.equal(renderer.translateItem(weapon, options).applicable, false);
assert.equal(weapon.properties[0].name, "Cost");

console.log("skill-gem-domain-test: ok");
