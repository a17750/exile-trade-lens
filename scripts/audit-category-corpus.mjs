import path from "node:path";
import { dataPath, extensionPath, readJson, reportsPath, writeJsonAtomic } from "./lib/project.mjs";

const locale = process.argv.includes("--locale")
  ? process.argv[process.argv.indexOf("--locale") + 1]
  : "en";
const strict = process.argv.includes("--strict");
const corpus = readJson(path.join(dataPath, "corpus", `category-pages.${locale}.json`));
const taskCatalog = readJson(path.join(dataPath, "corpus", "category-tasks.json"));
const dataset = readJson(path.join(extensionPath, "data", "bundled.json"));

const clean = (value) => String(value ?? "")
  .replace(/\[([^|\]]+)\|([^\]]+)\]/g, "$2")
  .replace(/[\[\]]/g, "")
  .replace(/\s+/g, " ")
  .trim();
const MOD_COLLECTIONS = [
  "implicitMods", "explicitMods", "enchantMods", "runeMods", "fracturedMods",
  "craftedMods", "desecratedMods", "ultimatumMods",
];
const statId = (hash) => String(hash ?? "").replace(/^stat\./, "");
const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const templateRegex = (value) => {
  const parts = clean(value).split("#");
  const number = "[+-]?(?:\\d*\\.\\d+|\\d+)";
  return new RegExp(`^${parts.map((part) => escapeRegex(part).replace(/\\ /g, "\\\\s+")).join(number)}$`, "i");
};
const bucketKey = (value) => clean(value)
  .replace(/[+-]?(?:\d*\.\d+|\d+)|#/g, " ")
  .match(/[A-Za-z]{2,}/)?.[0]
  ?.toLocaleLowerCase("en-US") ?? "";
const statTemplates = new Map();
function addStatTemplate(english, translated) {
  const key = bucketKey(english);
  const records = statTemplates.get(key) ?? [];
  records.push({ english, translated, pattern: templateRegex(english) });
  statTemplates.set(key, records);
}
for (const [english, translated] of Object.entries(
  dataset.domains?.statDescriptionExact?.entries ?? {},
)) {
  if (!english || !translated) continue;
  addStatTemplate(english, translated);
}
for (const record of Object.values(dataset.stats?.entries ?? {})) {
  for (const candidate of [
    record?.english ? { english: record.english, text: record.text } : null,
    ...(record?.renderings ?? []),
  ].filter(Boolean)) {
    if (!candidate.english || !candidate.text) continue;
    addStatTemplate(candidate.english, candidate.text);
  }
}

const occurrences = new Map();
function observe(domain, key, translated, categoryId, example, source = "") {
  const normalizedKey = clean(key);
  if (!normalizedKey) return;
  const id = `${domain}\u0000${normalizedKey}`;
  const previous = occurrences.get(id) ?? {
    domain,
    key: normalizedKey,
    translated: translated ?? "",
    covered: Boolean(translated && translated !== normalizedKey),
    source,
    count: 0,
    categories: new Set(),
    examples: new Set(),
  };
  if (translated && translated !== normalizedKey) {
    previous.translated = translated;
    previous.covered = true;
    if (source) previous.source = source;
  }
  previous.count += 1;
  previous.categories.add(categoryId);
  if (example && previous.examples.size < 3) previous.examples.add(example);
  occurrences.set(id, previous);
}

function itemNameCoverage(item, categoryId) {
  const baseType = clean(item.baseType);
  const baseText = dataset.baseItems?.[baseType];
  observe("item.baseType", baseType, baseText, categoryId, item.typeLine, "baseItems");

  const typeLine = clean(item.typeLine);
  let typeText = dataset.baseItems?.[typeLine];
  let typeSource = "baseItems";
  if (!typeText && baseText && typeLine.includes(baseType)) {
    typeText = baseText;
    typeSource = item.frameType === 1 ? "itemName.magicAffixRule" : "itemName.normalDisplayRules";
  }
  observe("item.typeLine", typeLine, typeText, categoryId, item.name || typeLine, typeSource);

  const name = clean(item.name);
  if (!name || name === "INCOMPLETE") return;
  let nameText = dataset.fixedNames?.[name] ?? dataset.baseItems?.[name];
  let nameSource = dataset.fixedNames?.[name] ? "fixedNames" : "baseItems";
  if (!nameText && item.frameType === 2 && dataset.domains?.itemName?.magicAffixRule) {
    // Rare names are constructed from the client word-component domain. The
    // individual token audit remains a separate item-name-domain regression.
    nameText = "<domain-resolved>";
    nameSource = "itemName.wordComponents";
  }
  observe("item.name", name, nameText, categoryId, typeLine, nameSource);
}

function auditItem(item, categoryId) {
  itemNameCoverage(item, categoryId);
  if (Number.isFinite(item.ilvl)) {
    observe("card.wrapper", "Item Level", dataset.itemPropertyIndex?.["Item Level"]?.text,
      categoryId, item.typeLine, "itemPropertyIndex");
  }
  if (item.requirements?.length) {
    observe("card.wrapper", "Requires", dataset.itemPropertyIndex?.Requires?.text,
      categoryId, item.typeLine, "itemPropertyIndex");
  }
  for (const collection of ["properties", "additionalProperties", "requirements", "weaponRequirements"]) {
    for (const property of item[collection] ?? []) {
      const key = clean(property.name);
      const record = dataset.itemPropertyIndex?.[key];
      const structuredType109 = Number(property.type) === Number(dataset.itemPropertyType109?.propertyType) &&
        Object.keys(dataset.itemPropertyType109?.classes ?? {}).some((itemClass) =>
          key === itemClass || key.endsWith(` ${itemClass}`));
      observe(`item.${collection}`, key, record?.text ?? (structuredType109 ? "<domain-resolved>" : ""),
        categoryId, item.typeLine, structuredType109 ? "itemPropertyType109" :
          record?.sources?.map((entry) => entry.kind).join(",") ?? "");
    }
  }
  for (const collection of MOD_COLLECTIONS) {
    for (const mod of item[collection] ?? []) {
      const record = dataset.stats?.entries?.[statId(mod.hash)];
      const hashCandidates = [record?.english, ...(record?.renderings ?? []).map((entry) => entry.english)]
        .filter(Boolean);
      const hashMatches = hashCandidates.some((candidate) => templateRegex(candidate).test(clean(mod.description)));
      const globalTranslations = new Set(
        (statTemplates.get(bucketKey(mod.description)) ?? [])
          .filter((candidate) => candidate.pattern.test(clean(mod.description)))
          .map((candidate) => candidate.translated),
      );
      const translated = hashMatches
        ? record.text
        : globalTranslations.size === 1 ? [...globalTranslations][0] : "";
      observe(`item.${collection}`, mod.description, translated, categoryId,
        `${item.typeLine} :: ${mod.hash}`, hashMatches ? "statsById+shape" :
          translated ? "unique-stat-template" : "");
    }
  }
  for (const skill of item.grantedSkills ?? []) {
    const rendered = clean(skill.values?.[0]?.[0] ?? skill.name ?? skill.description);
    const skillEnglish = rendered.replace(/^Level\s+\d+\s+/i, "");
    const skillText = dataset.baseItems?.[skillEnglish];
    observe("item.grantedSkills", rendered, skillText, categoryId, item.typeLine,
      skillText ? "grantedSkillDomain+baseItems" : "");
  }
}

const categories = [];
for (const [categoryId, task] of Object.entries(corpus.tasks ?? {})) {
  const before = new Map([...occurrences].map(([key, value]) => [key, value.count]));
  for (const sample of task.samples ?? []) auditItem(sample.item ?? {}, categoryId);
  let observations = 0;
  let uncovered = 0;
  for (const [key, value] of occurrences) {
    const delta = value.count - (before.get(key) ?? 0);
    if (!delta) continue;
    observations += delta;
    if (!value.covered) uncovered += delta;
  }
  categories.push({
    categoryId,
    label: task.englishLabel,
    status: task.status,
    captured: task.captured ?? 0,
    observations,
    uncovered,
  });
}

const records = [...occurrences.values()].map((record) => ({
  ...record,
  categories: [...record.categories].sort(),
  examples: [...record.examples],
})).sort((a, b) => Number(a.covered) - Number(b.covered) || b.count - a.count || a.key.localeCompare(b.key));
const total = records.reduce((sum, record) => sum + record.count, 0);
const covered = records.filter((record) => record.covered).reduce((sum, record) => sum + record.count, 0);
const completeTasks = categories.filter((category) => category.status === "complete").length;
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  locale,
  corpus: path.relative(dataPath, path.join(dataPath, "corpus", `category-pages.${locale}.json`)),
  summary: {
    expectedTasks: taskCatalog.tasks?.length ?? 0,
    tasks: categories.length,
    completeTasks,
    capturedItems: categories.reduce((sum, category) => sum + category.captured, 0),
    uniqueSignatures: records.length,
    observations: total,
    coveredObservations: covered,
    coverage: total ? Number((covered / total).toFixed(4)) : 0,
    unresolvedSignatures: records.filter((record) => !record.covered).length,
  },
  categories,
  unresolved: records.filter((record) => !record.covered),
  resolved: records.filter((record) => record.covered),
};
writeJsonAtomic(path.join(reportsPath, `category-corpus-coverage.${locale}.json`), report);
console.log(JSON.stringify(report.summary, null, 2));
if (report.unresolved.length) {
  console.log("\nTop unresolved signatures:");
  for (const entry of report.unresolved.slice(0, 20)) {
    console.log(`- [${entry.domain}] ${entry.key} (${entry.count})`);
  }
}
if (strict && completeTasks !== report.summary.expectedTasks) {
  throw new Error(`分类语料不完整：${completeTasks}/${report.summary.expectedTasks}`);
}
if (strict && report.summary.coverage < 0.8) {
  throw new Error(`分类语料翻译覆盖率低于 80%：${(report.summary.coverage * 100).toFixed(2)}%`);
}
