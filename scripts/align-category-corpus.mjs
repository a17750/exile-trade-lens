import path from "node:path";
import { dataPath, extensionPath, readJson, reportsPath, writeJsonAtomic } from "./lib/project.mjs";

const enCorpus = readJson(path.join(dataPath, "corpus", "category-pages.en.json"));
const twCorpus = readJson(path.join(dataPath, "corpus", "category-pages.zh-TW.json"));
const dataset = readJson(path.join(extensionPath, "data", "bundled.json"));

const clean = (value) => String(value ?? "")
  .replace(/\[([^|\]]+)\|([^\]]+)\]/g, "$2")
  .replace(/[\[\]]/g, "")
  .replace(/\s+/g, " ")
  .trim();
const template = (value) => clean(value)
  .replace(/[+\-−]?(?:\d*\.\d+|\d[\d,.]*)/g, "#")
  .replace(/\s+/g, " ")
  .trim();
const statId = (hash) => String(hash ?? "").replace(/^stat\./, "");
const MOD_COLLECTIONS = [
  "implicitMods", "explicitMods", "enchantMods", "runeMods", "fracturedMods",
  "craftedMods", "desecratedMods", "ultimatumMods",
];

function addObservation(index, identity, text, categoryId, { templated = false, example = "" } = {}) {
  const normalized = templated ? template(text) : clean(text);
  if (!identity || !normalized) return;
  const record = index.get(identity) ?? { values: new Map(), categories: new Set(), examples: new Set() };
  record.values.set(normalized, (record.values.get(normalized) ?? 0) + 1);
  record.categories.add(categoryId);
  if (example && record.examples.size < 3) record.examples.add(example);
  index.set(identity, record);
}

function buildIndex(corpus) {
  const index = new Map();
  let capturedItems = 0;
  for (const [categoryId, task] of Object.entries(corpus.tasks ?? {})) {
    for (const sample of task.samples ?? []) {
      capturedItems += 1;
      const item = sample.item ?? {};
      for (const [collection, properties] of [
        ["property", item.properties],
        ["additionalProperty", item.additionalProperties],
        ["requirement", item.requirements],
        ["weaponRequirement", item.weaponRequirements],
      ]) {
        for (const property of properties ?? []) {
          const identity = `${collection}:type=${property.type ?? ""}:mode=${property.displayMode ?? ""}`;
          addObservation(index, identity, property.name, categoryId, { example: item.typeLine });
        }
      }
      for (const collection of MOD_COLLECTIONS) {
        for (const mod of item[collection] ?? []) {
          const id = statId(mod.hash);
          if (id) addObservation(index, `stat:${id}`, mod.description, categoryId, {
            templated: true,
            example: item.typeLine,
          });
        }
      }
      for (const skill of item.grantedSkills ?? []) {
        const id = statId(skill.hash);
        if (id) addObservation(index, `grantedSkill:${id}`, skill.values?.[0]?.[0], categoryId, {
          templated: true,
          example: item.typeLine,
        });
      }
    }
  }
  return { index, capturedItems };
}

function dominant(record) {
  if (!record?.values?.size) return null;
  const sorted = [...record.values.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    value: sorted[0][0],
    count: sorted[0][1],
    variants: sorted.map(([value, count]) => ({ value, count })),
    unambiguous: sorted.length === 1,
  };
}

function compiledFor(identity, english) {
  if (identity.startsWith("stat:") || identity.startsWith("grantedSkill:")) {
    const id = identity.slice(identity.indexOf(":") + 1);
    return dataset.stats?.entries?.[id]?.text ?? "";
  }
  return dataset.itemPropertyIndex?.[english]?.text ?? "";
}

const english = buildIndex(enCorpus);
const zhTW = buildIndex(twCorpus);
const records = [];
for (const [identity, enRecord] of english.index) {
  const twRecord = zhTW.index.get(identity);
  if (!twRecord) continue;
  const en = dominant(enRecord);
  const tw = dominant(twRecord);
  if (!en || !tw || en.value === tw.value) continue;
  const compiled = compiledFor(identity, en.value);
  const templated = identity.startsWith("stat:") || identity.startsWith("grantedSkill:");
  const normalizedCompiled = templated ? template(compiled) : clean(compiled);
  records.push({
    identity,
    domain: identity.slice(0, identity.indexOf(":")),
    english: en.value,
    zhTW: tw.value,
    englishCount: en.count,
    zhTWCount: tw.count,
    englishVariants: en.variants,
    zhTWVariants: tw.variants,
    categories: [...new Set([...enRecord.categories, ...twRecord.categories])].sort(),
    examples: [...new Set([...enRecord.examples, ...twRecord.examples])].slice(0, 5),
    sampleConsistency: en.unambiguous && tw.unambiguous ? "consistent" : "ambiguous",
    promotionEligible: false,
    compiled,
    status: !compiled ? "missing" : normalizedCompiled === tw.value ? "exact" : "mismatch",
  });
}
records.sort((a, b) => a.status.localeCompare(b.status) || a.sampleConsistency.localeCompare(b.sampleConsistency) ||
  (b.englishCount + b.zhTWCount) - (a.englishCount + a.zhTWCount) || a.identity.localeCompare(b.identity));

const report = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  method: "Candidate comparison by stable domain IDs across independent EN and zh-TW market samples",
  policy: "Independent markets cannot prove that alternate renderings correspond. This report is diagnostic only and never feeds runtime data automatically.",
  sources: ["data/corpus/category-pages.en.json", "data/corpus/category-pages.zh-TW.json"],
  summary: {
    englishCapturedItems: english.capturedItems,
    zhTWCapturedItems: zhTW.capturedItems,
    englishStableSignatures: english.index.size,
    zhTWStableSignatures: zhTW.index.size,
    alignedEvidence: records.length,
    sampleConsistent: records.filter((record) => record.sampleConsistency === "consistent").length,
    exact: records.filter((record) => record.status === "exact").length,
    missing: records.filter((record) => record.status === "missing").length,
    mismatch: records.filter((record) => record.status === "mismatch").length,
  },
  missing: records.filter((record) => record.status === "missing"),
  mismatch: records.filter((record) => record.status === "mismatch"),
  exact: records.filter((record) => record.status === "exact"),
};
writeJsonAtomic(path.join(reportsPath, "category-corpus-alignment.json"), report);
console.log(JSON.stringify(report.summary, null, 2));
for (const record of [...report.missing, ...report.mismatch].slice(0, 30)) {
  console.log(`- [${record.status}/${record.sampleConsistency}] ${record.identity}: ${record.english} -> ${record.zhTW}`);
}
