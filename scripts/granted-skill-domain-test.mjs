import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { compileGrantedSkillDomain } from "./domains/granted-skill.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policy = JSON.parse(fs.readFileSync(path.join(root, "data/domain-policies.json"), "utf8"));
const ggpk = JSON.parse(fs.readFileSync(path.join(root, "data/ggpk.json"), "utf8"));
const compilation = compileGrantedSkillDomain(
  policy.domains.grantedSkill,
  ggpk.clientStrings,
  ggpk.baseItems,
);

assert.deepEqual(
  compilation.domain.rules.map((rule) => rule.variant),
  ["levelled", "unlevelled"],
);
assert.equal(compilation.domain.skillNameSource, "baseItems");
assert.throws(
  () => compileGrantedSkillDomain(
    policy.domains.grantedSkill,
    { ...ggpk.clientStrings, byId: {
      ...ggpk.clientStrings.byId,
      ItemDisplayGrantedSkillNoScaling: {
        ...ggpk.clientStrings.byId.ItemDisplayGrantedSkillNoScaling,
        zhTW: "未审核的新模板 {0}",
      },
    } },
    ggpk.baseItems,
  ),
  /审核断言不一致/,
);

const context = vm.createContext({});
vm.runInContext(
  fs.readFileSync(path.join(root, "extension/page/domains/granted-skill.js"), "utf8"),
  context,
);
const renderer = vm.runInContext("globalThis.POE2ZHGrantedSkillDomain", context);
const format = (translated, original) => `${translated} (${original})`;
const reports = [];
const options = {
  domain: compilation.domain,
  skillNames: ggpk.baseItems.byEnglish,
  format,
  onMissing: (english, detail) => reports.push({ english, detail }),
};

const spearThrow = { name: "Grants Skill: Spear Throw", values: [] };
assert.equal(renderer.translate(spearThrow, options).status, "translated");
assert.equal(spearThrow.name, "賦予技能: 長矛投擲 (Grants Skill: Spear Throw)");

const levelled = { name: "Grants Skill: Level 8 Fireball", values: [] };
renderer.translate(levelled, options);
assert.equal(levelled.name, "賦予技能: 8 級 火球 (Grants Skill: Level 8 Fireball)");

const structured = {
  name: "Grants Skill: {0}",
  values: [["Spear Throw", 4]],
};
renderer.translate(structured, options);
assert.equal(structured.name, "賦予技能: {0}");
assert.equal(structured.values[0][0], "長矛投擲 (Spear Throw)");

const splitSolarOrb = {
  name: "Grants Skill",
  values: [["Level 20 Solar Orb", 4]],
  type: "skill.solar_orb",
};
renderer.translate(splitSolarOrb, options);
assert.equal(splitSolarOrb.name, "賦予技能");
assert.equal(
  splitSolarOrb.values[0][0],
  "20 級 日耀球 (Grants Skill: Level 20 Solar Orb)",
);

const unknown = { name: "Grants Skill: Unverified Skill", values: [] };
renderer.translate(unknown, options);
assert.equal(unknown.name, "Grants Skill: Unverified Skill");
assert.equal(reports.at(-1).detail.reason, "missing-skill-name");
assert.equal(reports.at(-1).detail.skillEnglish, "Unverified Skill");

const changedShape = { name: "Grants Skill :: Spear Throw", values: [] };
assert.equal(renderer.translate(changedShape, options).handled, true);
assert.equal(changedShape.name, "Grants Skill :: Spear Throw");
assert.equal(reports.at(-1).detail.reason, "template-shape-drift");

const domainShapeDrift = { name: "Grants Skill: Level Eight Fireball", values: [] };
renderer.translate(domainShapeDrift, options);
assert.equal(domainShapeDrift.name, "Grants Skill: Level Eight Fireball");
assert.equal(reports.at(-1).detail.reason, "missing-skill-name");

const unrelated = { name: "Staff", values: [] };
assert.equal(renderer.translate(unrelated, options).handled, false);
assert.equal(unrelated.name, "Staff");

console.log("granted-skill-domain-test: ok");
