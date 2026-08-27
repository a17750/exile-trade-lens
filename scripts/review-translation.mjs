import path from "node:path";
import { readJson, reportsPath, sourcesPath, writeJson } from "./lib/project.mjs";

const [domain, key, text] = process.argv.slice(2);
if (!domain || !key || !text) {
  throw new Error(
    '用法：node scripts/review-translation.mjs <item|stat|static|filter|stat-option|filter-option> "键或ID" "繁中译文"',
  );
}
if (!["item", "stat", "static", "filter", "stat-option", "filter-option"].includes(domain)) {
  throw new Error(`不支持的领域：${domain}`);
}

const snapshot = readJson(path.join(reportsPath, "upstream-current.en.json"));
const overridesPath = path.join(sourcesPath, "manual-overrides.json");
const overrides = readJson(overridesPath);
const baseDomain = domain.replace(/-option$/, "");
const section = { item: "items", stat: "stats", static: "static", filter: "filters" }[baseDomain];
const [entryId, optionId] = domain.endsWith("-option") ? key.split(":") : [key, null];
const sourceEntry = snapshot.sections[section].entries[entryId];
if (!sourceEntry) throw new Error(`当前官方快照中找不到 ${domain}:${key}`);
const english = optionId ? sourceEntry.options?.[optionId] : sourceEntry.english;
if (!english) throw new Error(`当前官方快照中找不到选项 ${domain}:${key}`);
const record = {
  expectedEnglish: english,
  text,
  reviewedAt: new Date().toISOString(),
  reason: "人工审核 review-translation.mjs",
};

if (baseDomain === "item") {
  overrides.items ??= {};
  overrides.items[key] = record;
} else {
  const field = { stat: "statsById", static: "staticById", filter: "filtersById" }[baseDomain];
  overrides[field] ??= {};
  if (optionId) {
    overrides[field][entryId] ??= {};
    overrides[field][entryId].options ??= {};
    overrides[field][entryId].options[optionId] = record;
  } else {
    overrides[field][key] = { ...(overrides[field][key] ?? {}), ...record };
  }
}
overrides.version = Number(overrides.version ?? 0) + 1;
writeJson(overridesPath, overrides);
console.log(`已审核 ${domain}:${key} -> ${text}`);
console.log("请运行 node scripts/build-data.mjs 重新生成词库与报告");
