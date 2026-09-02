import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const corpus = JSON.parse(
  fs.readFileSync(path.join(root, "data/corpus/category-pages.en.json"), "utf8"),
);
const dataset = JSON.parse(
  fs.readFileSync(path.join(root, "extension/data/bundled.json"), "utf8"),
);
const context = vm.createContext({});
vm.runInContext(
  fs.readFileSync(path.join(root, "extension/page/domains/skill-gem.js"), "utf8"),
  context,
);
const renderer = vm.runInContext("globalThis.POE2ZHSkillGemDomain", context);

const unresolved = [];
let items = 0;
let tagGroups = 0;
let tagTokens = 0;
let compoundCosts = 0;

for (const task of Object.values(corpus.tasks ?? {})) {
  for (const sample of task.samples ?? []) {
    const sourceItem = sample.item ?? {};
    if (sourceItem.frameType !== 4 && sourceItem.frameTypeId !== "Gem") continue;
    items += 1;
    const item = structuredClone(sourceItem);
    const originalProperties = structuredClone(item.properties ?? []);
    const reports = [];
    renderer.translateItem(item, {
      domain: dataset.domains.skillGem,
      format: (translated) => translated,
      onMissing: (english, detail) => reports.push({ english, ...detail }),
    });
    for (let index = 0; index < originalProperties.length; index += 1) {
      const before = originalProperties[index];
      const after = item.properties[index];
      if (!before.values?.length && /\[[^\]]+\]/.test(before.name ?? "")) {
        tagGroups += 1;
        tagTokens += [...String(before.name).matchAll(/\[([^\]]+)\]/g)].length;
        if (after.name === before.name || /\[[^\]]+\]/.test(after.name ?? "")) {
          unresolved.push({
            categoryId: task.categoryId,
            typeLine: sourceItem.typeLine,
            field: "tags",
            english: before.name,
          });
        }
      }
      if (["Cost", "Reservation"].includes(before.name) && /,/.test(before.values?.[0]?.[0] ?? "")) {
        compoundCosts += 1;
        if (after.values?.[0]?.[0] === before.values?.[0]?.[0]) {
          unresolved.push({
            categoryId: task.categoryId,
            typeLine: sourceItem.typeLine,
            field: "compound-cost",
            english: before.values[0][0],
          });
        }
      }
    }
    for (const report of reports) {
      if (["unknown-skill-tag", "unknown-cost-component"].includes(report.reason)) {
        unresolved.push({
          categoryId: task.categoryId,
          typeLine: sourceItem.typeLine,
          field: report.reason,
          semanticId: report.semanticId,
          english: report.english,
        });
      }
    }
  }
}

const report = {
  schemaVersion: 1,
  domain: "item-skill-gem",
  source: "data/corpus/category-pages.en.json",
  summary: { items, tagGroups, tagTokens, compoundCosts, unresolved: unresolved.length },
  unresolved,
};
fs.mkdirSync(path.join(root, "reports"), { recursive: true });
fs.writeFileSync(
  path.join(root, "reports/skill-gem-corpus-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report.summary, null, 2));
assert.equal(unresolved.length, 0, "技能宝石真实首屏仍有无法解析的标签或复合消耗");
console.log("skill-gem-corpus-audit: ok");
