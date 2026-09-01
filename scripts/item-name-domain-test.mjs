import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { compileItemNameDomain } from "./domains/item-name.mjs";
import { readJson, rootPath } from "./lib/project.mjs";

const policy = readJson(path.join(rootPath, "data/domain-policies.json"));
const ggpk = readJson(path.join(rootPath, "data/ggpk.json"));
const compilation = compileItemNameDomain(
  policy.domains.itemName,
  ggpk.clientStrings,
);

assert.deepEqual(
  compilation.domain.normalDisplayRules.map((rule) => rule.ruleId),
  ["client-string:QualityItem", "client-string:ExceptionalItem"],
);
assert.deepEqual(
  compilation.report.candidates
    .filter((candidate) => candidate.status === "review")
    .map((candidate) => candidate.sourceId),
  ["SynthesisedItem"],
);

const alteredClientStrings = structuredClone(ggpk.clientStrings);
alteredClientStrings.byId.ExceptionalItem.zhTW = "已变化 {}";
assert.throws(
  () => compileItemNameDomain(policy.domains.itemName, alteredClientStrings),
  /ClientStrings\.ExceptionalItem\.zhTW/,
);

const context = vm.createContext({ console });
vm.runInContext(
  fs.readFileSync(path.join(rootPath, "extension/page/domains/item-name.js"), "utf8"),
  context,
  { filename: "item-name.js" },
);
const resolver = context.POE2ZHItemNameDomain;
const dataset = {
  datasetVersion: "item-name-domain-test",
  domains: { itemName: compilation.domain },
  items: {},
  baseItems: {
    "Reaping Staff": "死神長杖",
    "Bombard Crossbow": "轟擊十字弓",
    "Composite Bow": "複合弓",
  },
  fixedNames: {},
  wordComponents: {},
  affixNames: {
    prefixes: { Frosted: "結霜的" },
    suffixes: { "of the Fletcher": "製箭者之" },
  },
};

const exceptional = resolver.resolve(
  {
    frameType: 0,
    baseType: "Reaping Staff",
    typeLine: "Exceptional Reaping Staff",
  },
  dataset,
);
assert.equal(exceptional.typeLine.status, "translated");
assert.equal(exceptional.typeLine.text, "卓越 死神長杖");
assert.equal(exceptional.typeLine.ruleId, "client-string:ExceptionalItem");

const superior = resolver.resolve(
  {
    frameType: 0,
    baseType: "Bombard Crossbow",
    typeLine: "Superior Bombard Crossbow",
  },
  dataset,
);
assert.equal(superior.typeLine.text, "精良的 轟擊十字弓");

const unknown = resolver.resolve(
  {
    frameType: 0,
    baseType: "Reaping Staff",
    typeLine: "Unreviewed Reaping Staff",
  },
  dataset,
);
assert.equal(unknown.typeLine.status, "unresolved");
assert.equal(unknown.typeLine.original, "Unreviewed Reaping Staff");
assert.deepEqual(
  JSON.parse(JSON.stringify(unknown.reports)),
  [{
    type: "item",
    key: "Unreviewed Reaping Staff",
    en: "Unreviewed Reaping Staff",
    context: "fetch:typeLine:normal-display-unresolved",
    domain: "item-name.normal-display",
    reason: "unknown-display-template",
  }],
);

const wrongFrame = resolver.resolve(
  {
    frameType: 1,
    baseType: "Reaping Staff",
    typeLine: "Exceptional Reaping Staff",
  },
  dataset,
);
assert.equal(wrongFrame.typeLine.status, "unresolved");

const magic = resolver.resolve(
  {
    frameType: 1,
    baseType: "Composite Bow",
    typeLine: "Frosted Composite Bow of the Fletcher",
  },
  dataset,
);
assert.equal(magic.typeLine.text, "結霜的複合弓製箭者之");

console.log("item-name-domain-test: ok");
