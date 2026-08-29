import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  clone,
  extensionPath,
  readJson,
  reportsPath,
  rootPath,
  sourcesPath,
  writeJson,
  writeJsonAtomic,
} from "./lib/project.mjs";
import {
  canonicalizeOfficialData,
  fetchOfficialTradeData,
  fetchOfficialTwTradeData,
  OFFICIAL_EN_BASE_URL,
  OFFICIAL_TW_BASE_URL,
} from "./lib/trade-data.mjs";
import { createOfficialTwOverlay } from "./lib/official-tw.mjs";
import { countPlaceholders, createCandidateEngine } from "./lib/translation-engine.mjs";
import {
  createCoverageReport,
  createQualityReport,
  createReviewQueue,
  diffSnapshots,
} from "./lib/audit.mjs";

const translations = readJson(path.join(sourcesPath, "translations.zh-TW.json"));
const uiSource = readJson(path.join(rootPath, "data", "ui.zh-TW.json"));
const verifiedLabels = readJson(path.join(sourcesPath, "verified-labels.zh-TW.json"));
const manualOverrides = readJson(path.join(sourcesPath, "manual-overrides.json"));
const verifiedStatRenderings = readJson(
  path.join(sourcesPath, "verified-stat-renderings.zh-TW.json"),
);
const glossary = readJson(path.join(sourcesPath, "glossary.zh-TW.json"));
const phraseExceptions = readJson(path.join(sourcesPath, "phrase-exceptions.zh-TW.json"));
const sourceLock = readJson(path.join(sourcesPath, "source-lock.json"));
const externalNames = readJson(
  path.join(sourcesPath, "external", "poe-game-data.names.tw.json"),
);
const ggpkSource = readJson(path.join(rootPath, "data", "ggpk.json"));
const ggpkManifest = ggpkSource.manifest;
const ggpkBaseItems = ggpkSource.baseItems;
const ggpkWords = ggpkSource.words;
const ggpkAffixes = ggpkSource.affixes;
const ggpkClientStrings = ggpkSource.clientStrings;
const tradeApiPath = path.join(rootPath, "data", "trade-api.json");
const cachedTradeApi = readJson(tradeApiPath, null);
const baseline = readJson(path.join(sourcesPath, "upstream-baseline.en.json"), null);

if (translations.schemaVersion !== 1 || translations.locale !== "zh-TW") {
  throw new Error("sources/translations.zh-TW.json 格式不兼容");
}
if (uiSource.schemaVersion !== 1 || uiSource.locale !== "zh-TW") {
  throw new Error("data/ui.zh-TW.json 格式不兼容");
}
if (verifiedLabels.schemaVersion !== 1 || verifiedLabels.locale !== "zh-TW") {
  throw new Error("sources/verified-labels.zh-TW.json 格式不兼容");
}
if (manualOverrides.schemaVersion !== 1) {
  throw new Error("sources/manual-overrides.json 格式不兼容");
}
if (
  verifiedStatRenderings.schemaVersion !== 1 ||
  verifiedStatRenderings.locale !== "zh-TW"
) {
  throw new Error("sources/verified-stat-renderings.zh-TW.json 格式不兼容");
}
if (
  ggpkManifest.schemaVersion !== 1 ||
  ggpkBaseItems.schemaVersion !== 1 ||
  ggpkWords.schemaVersion !== 1 ||
  ggpkAffixes.schemaVersion !== 1 ||
  ggpkClientStrings.schemaVersion !== 1 ||
  ggpkBaseItems.domain !== "base-item" ||
  ggpkWords.domain !== "word-component" ||
  ggpkAffixes.domain !== "affix-name" ||
  ggpkClientStrings.domain !== "client-string"
) {
  throw new Error("data/ggpk.json 格式不兼容，请重新运行 tools/ggpk/run.ps1");
}

function isUsableTradeApiCache(value) {
  return (
    value?.schemaVersion === 1 &&
    value?.locale === "zh-TW" &&
    value?.english?.sections &&
    value?.zhTW?.sections &&
    value?.overlay?.sections &&
    value?.overlay?.report
  );
}

let snapshot;
let twSnapshot;
let officialTwOverlay;
let pendingTradeApiSnapshot = null;
let englishSourceStatus = { fresh: true, error: null };
let twSourceStatus = { fresh: true, error: null };
try {
  const fetchedAt = new Date().toISOString();
  const [official, officialTw] = await Promise.all([
    fetchOfficialTradeData(),
    fetchOfficialTwTradeData(),
  ]);
  snapshot = canonicalizeOfficialData(
    official,
    fetchedAt,
    `${OFFICIAL_EN_BASE_URL}/{items,stats,static,filters}`,
  );
  twSnapshot = canonicalizeOfficialData(
    officialTw,
    fetchedAt,
    `${OFFICIAL_TW_BASE_URL}/{items,stats,static,filters}`,
  );
  officialTwOverlay = createOfficialTwOverlay({
    englishSnapshot: snapshot,
    translatedSnapshot: twSnapshot,
    englishRaw: official,
    translatedRaw: officialTw,
  });
  pendingTradeApiSnapshot = {
    schemaVersion: 1,
    locale: "zh-TW",
    generatedAt: fetchedAt,
    source: "official-trade-api-pair",
    endpoints: {
      english: snapshot.source,
      zhTW: twSnapshot.source,
    },
    english: snapshot,
    zhTW: twSnapshot,
    overlay: officialTwOverlay,
  };
} catch (error) {
  if (!isUsableTradeApiCache(cachedTradeApi)) throw error;
  snapshot = cachedTradeApi.english;
  twSnapshot = cachedTradeApi.zhTW;
  officialTwOverlay = cachedTradeApi.overlay;
  const message = String(error?.message ?? error);
  englishSourceStatus = { fresh: false, error: message };
  twSourceStatus = { fresh: false, error: message };
  console.warn(`official Trade API pair unavailable; using data/trade-api.json: ${message}`);
}
const suggest = createCandidateEngine(glossary, phraseExceptions);

const items = clone(translations.items ?? {});
const stats = clone(translations.stats ?? { groups: {}, entries: {} });
const staticData = clone(translations.static ?? { groups: {}, entries: {} });
const filters = clone(translations.filters ?? { groups: {}, entries: {} });
const properties = {
  ...clone(translations.properties ?? {}),
  ...clone(verifiedLabels.properties ?? {}),
};
const allocates = clone(translations.allocates ?? {});
const ui = {
  ...clone(uiSource.entries ?? {}),
  ...clone(verifiedLabels.ui ?? {}),
};
const exact = clone(translations.exact ?? {});
const baseItems = clone(ggpkBaseItems.byEnglish ?? {});
const fixedNames = clone(ggpkWords.byEnglish ?? {});
const wordComponents = clone(ggpkWords.byEnglish ?? {});
const affixNames = {
  prefixes: clone(ggpkAffixes.prefixes ?? {}),
  suffixes: clone(ggpkAffixes.suffixes ?? {}),
};
const qualityItemClientString = ggpkClientStrings.byId?.QualityItem;
if (
  qualityItemClientString?.english !== "Superior {0}" ||
  !qualityItemClientString?.zhTW?.includes("{0}")
) {
  throw new Error("GGPK ClientStrings.QualityItem 格式已变化，请重新审查普通品质物品标题");
}
const itemDisplayTemplates = {
  quality: {
    sourceId: "QualityItem",
    english: qualityItemClientString.english,
    text: qualityItemClientString.zhTW,
  },
};
const normalizeExternalName = (value) =>
  String(value ?? "").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
const externalApplied = [];
const externalConflicts = [];
for (const english of Object.keys(snapshot.sections.items.entries)) {
  const external = externalNames[normalizeExternalName(english)];
  if (!external || external === english) continue;
  if (!items[english]) {
    items[english] = external;
    externalApplied.push({ english, zhTW: external });
  } else if (items[english] !== external && !manualOverrides.items?.[english]) {
    externalConflicts.push({ english, project: items[english], external });
  }
}

const officialTwItemApplied = [];
const officialTwItemOverrides = [];
for (const [english, translated] of Object.entries(officialTwOverlay.items)) {
  if (!snapshot.sections.items.entries[english] || !translated || translated === english) continue;
  const previous = items[english];
  items[english] = translated;
  officialTwItemApplied.push({ english, zhTW: translated });
  if (previous && previous !== translated) {
    officialTwItemOverrides.push({ english, previous, official: translated });
  }
}

function applyOfficialStableSection(target, overlay, sectionName) {
  Object.assign(target.groups, overlay.groups ?? {});
  for (const [id, entry] of Object.entries(overlay.entries ?? {})) {
    if (sectionName === "static") {
      if (entry.text) target.entries[id] = entry.text;
      continue;
    }
    target.entries[id] = {
      ...(typeof target.entries[id] === "object" ? target.entries[id] : {}),
    };
    if (entry.text) target.entries[id].text = entry.text;
    if (Object.keys(entry.options ?? {}).length) {
      target.entries[id].options = {
        ...(target.entries[id].options ?? {}),
        ...entry.options,
      };
    }
  }
}

applyOfficialStableSection(stats, officialTwOverlay.sections.stats, "stats");
applyOfficialStableSection(staticData, officialTwOverlay.sections.static, "static");
applyOfficialStableSection(filters, officialTwOverlay.sections.filters, "filters");

const addExact = (en, translated) => {
  en = String(en ?? "").trim();
  translated = String(translated ?? "").trim();
  if (en && translated && en !== translated) exact[en] = translated;
};

function addStableIdExact(sourceSection, translatedSection) {
  for (const [id, translated] of Object.entries(translatedSection.groups ?? {})) {
    addExact(sourceSection.groups?.[id], translated);
  }
  for (const [id, translatedEntry] of Object.entries(translatedSection.entries ?? {})) {
    const enEntry = sourceSection.entries?.[id];
    const translatedText =
      typeof translatedEntry === "string" ? translatedEntry : translatedEntry?.text;
    addExact(enEntry?.english, translatedText);
    const translatedOptions =
      typeof translatedEntry === "object" ? translatedEntry?.options ?? {} : {};
    for (const [optionId, optionText] of Object.entries(translatedOptions)) {
      addExact(enEntry?.options?.[String(optionId)], optionText);
    }
  }
}

addStableIdExact(snapshot.sections.stats, stats);
addStableIdExact(snapshot.sections.static, staticData);
addStableIdExact(snapshot.sections.filters, filters);

for (const [en, translated] of Object.entries(items)) addExact(en, translated);
for (const [en, translated] of Object.entries(properties)) addExact(en, translated);
for (const [en, translated] of Object.entries(ui)) addExact(en, translated);

function overrideText(value) {
  return typeof value === "string" ? value : value?.text;
}

function assertExpectedEnglish(record, currentEnglish, label) {
  if (record?.expectedEnglish && record.expectedEnglish !== currentEnglish) {
    throw new Error(
      `人工校正已过期：${label} 当前英文为 ${JSON.stringify(currentEnglish)}，` +
        `记录的是 ${JSON.stringify(record.expectedEnglish)}`,
    );
  }
}

for (const [english, record] of Object.entries(manualOverrides.items ?? {})) {
  assertExpectedEnglish(record, english, `item:${english}`);
  const text = overrideText(record);
  if (text) {
    items[english] = text;
    addExact(english, text);
  }
}

function applyStableOverrides(records, sectionName, targetSection) {
  const currentEntries = snapshot.sections[sectionName].entries;
  for (const [id, record] of Object.entries(records ?? {})) {
    const currentEnglish = currentEntries[id]?.english;
    assertExpectedEnglish(record, currentEnglish, `${sectionName}:${id}`);
    const text = overrideText(record);
    if (text) {
      if (sectionName === "static") targetSection.entries[id] = text;
      else {
        targetSection.entries[id] = {
          ...(typeof targetSection.entries[id] === "object" ? targetSection.entries[id] : {}),
          text,
        };
      }
      addExact(currentEnglish, text);
    }
    for (const [optionId, optionRecord] of Object.entries(record.options ?? {})) {
      const currentOptionEnglish = currentEntries[id]?.options?.[optionId];
      assertExpectedEnglish(
        optionRecord,
        currentOptionEnglish,
        `${sectionName}:${id}:option:${optionId}`,
      );
      const optionText = overrideText(optionRecord);
      if (!optionText || sectionName === "static") continue;
      targetSection.entries[id] = {
        ...(typeof targetSection.entries[id] === "object" ? targetSection.entries[id] : {}),
      };
      targetSection.entries[id].options ??= {};
      targetSection.entries[id].options[optionId] = optionText;
      addExact(currentOptionEnglish, optionText);
    }
  }
}

applyStableOverrides(manualOverrides.statsById, "stats", stats);
applyStableOverrides(manualOverrides.staticById, "static", staticData);
applyStableOverrides(manualOverrides.filtersById, "filters", filters);

// Ship the current English stat template beside each stable ID. Runtime /fetch
// responses contain concrete values while the catalog uses placeholders. Keeping
// both lets the extension validate hash-to-mod associations instead of trusting
// array position alone.
for (const [id, entry] of Object.entries(snapshot.sections.stats.entries ?? {})) {
  if (!stats.entries[id] || typeof stats.entries[id] !== "object") continue;
  stats.entries[id].english = entry.english;
}

const normalizeTradeDescription = (value) =>
  String(value ?? "")
    .replace(/\[([^|\]]+)\|([^\]]+)\]/g, "$2")
    .replace(/\[([^\]]+)\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

for (const [id, record] of Object.entries(verifiedStatRenderings.statsById ?? {})) {
  const catalogEnglish = snapshot.sections.stats.entries?.[id]?.english;
  if (!catalogEnglish) {
    throw new Error(`已验证的词缀渲染找不到稳定 ID：${id}`);
  }
  if (record.expectedCatalogEnglish !== catalogEnglish) {
    throw new Error(
      `已验证的词缀渲染已过期：stats:${id} 当前英文为 ${JSON.stringify(catalogEnglish)}，` +
        `记录的是 ${JSON.stringify(record.expectedCatalogEnglish)}`,
    );
  }
  const seenEnglish = new Map();
  const renderings = [];
  for (const variant of record.variants ?? []) {
    const english = String(variant?.english ?? "").trim();
    const text = String(variant?.text ?? "").trim();
    if (!english || !text || variant?.source !== "official-trade-fetch-pair") {
      throw new Error(`已验证的词缀渲染缺少官方双端证据：stats:${id}`);
    }
    if (
      variant.evidence?.english?.hash !== `stat.${id}` ||
      variant.evidence?.zhTW?.hash !== `stat.${id}`
    ) {
      throw new Error(`已验证的词缀渲染 hash 与稳定 ID 不一致：stats:${id}`);
    }
    if (
      normalizeTradeDescription(variant.evidence.english.description) !== english ||
      normalizeTradeDescription(variant.evidence.zhTW.description) !== text ||
      !/^[A-Za-z0-9]+$/.test(variant.evidence.english.queryId ?? "") ||
      !/^[A-Za-z0-9]+$/.test(variant.evidence.zhTW.queryId ?? "") ||
      !/^[a-f0-9]{64}$/.test(variant.evidence.english.itemId ?? "") ||
      !/^[a-f0-9]{64}$/.test(variant.evidence.zhTW.itemId ?? "")
    ) {
      throw new Error(`已验证的词缀渲染证据与正式文本不一致：stats:${id}:${english}`);
    }
    if (countPlaceholders(english) !== countPlaceholders(text)) {
      throw new Error(`已验证的词缀渲染占位符数量不一致：stats:${id}:${english}`);
    }
    const previous = seenEnglish.get(english.toLocaleLowerCase("en-US"));
    if (previous && previous !== text) {
      throw new Error(`已验证的词缀渲染存在冲突：stats:${id}:${english}`);
    }
    seenEnglish.set(english.toLocaleLowerCase("en-US"), text);
    renderings.push({ english, text, source: variant.source });
  }
  if (!renderings.length) throw new Error(`已验证的词缀渲染为空：stats:${id}`);
  stats.entries[id] = { ...stats.entries[id], renderings };
}

for (const [en, translated] of Object.entries(manualOverrides.exact ?? {})) {
  addExact(en, translated);
}

const dataPath = path.join(extensionPath, "data", "bundled.json");
const previousDataset = readJson(dataPath, null);
const datasetContent = {
  locale: "zh-TW",
  source: "project-owned translation pipeline",
  sources: [
    "sources/translations.zh-TW.json",
    "data/ui.zh-TW.json",
    "sources/verified-labels.zh-TW.json",
    "sources/manual-overrides.json",
    "sources/verified-stat-renderings.zh-TW.json",
    "sources/glossary.zh-TW.json",
    "sources/phrase-exceptions.zh-TW.json",
    "data/ggpk.json",
    "data/trade-api.json",
    `poe-game-data@${sourceLock.sources.poeGameDataNamesTw.ref}`,
  ],
  items,
  baseItems,
  fixedNames,
  wordComponents,
  affixNames,
  itemDisplayTemplates,
  stats,
  static: staticData,
  filters,
  properties,
  allocates,
  exact,
  ui,
};
const contentHash = crypto
  .createHash("sha256")
  .update(JSON.stringify(datasetContent))
  .digest("hex")
  .slice(0, 8);
const datasetVersion =
  `project-zhTW-${translations.version}` +
  `.labels-${verifiedLabels.version ?? 0}` +
  `.manual-${manualOverrides.version ?? 0}` +
  `.renderings-${verifiedStatRenderings.version ?? 0}` +
  `.terms-${glossary.version ?? 0}` +
  `.names-${sourceLock.sources.poeGameDataNamesTw.ref.slice(0, 7)}` +
  `.ggpk-${crypto.createHash("sha256").update(JSON.stringify(ggpkManifest.tables)).digest("hex").slice(0, 8)}` +
  `.tw-${crypto.createHash("sha256").update(JSON.stringify(twSnapshot.sections)).digest("hex").slice(0, 8)}` +
  `.data-${contentHash}`;
const dataset = {
  schemaVersion: 1,
  datasetVersion,
  generatedAt:
    previousDataset?.datasetVersion === datasetVersion
      ? previousDataset.generatedAt
      : snapshot.fetchedAt,
  ...datasetContent,
};

const diff = diffSnapshots(baseline, snapshot);
function reviewedChange(change) {
  if (change.section === "items") return Boolean(manualOverrides.items?.[change.id]);
  const field = {
    stats: "statsById",
    static: "staticById",
    filters: "filtersById",
  }[change.section];
  const record = manualOverrides[field]?.[change.id];
  if (change.kind === "entry") {
    return Boolean(record?.text && record.expectedEnglish === change.english);
  }
  if (change.kind === "option") {
    const option = record?.options?.[change.optionId];
    return Boolean(option?.text && option.expectedEnglish === change.english);
  }
  return false;
}
diff.changed = diff.changed.map((change) => ({
  ...change,
  reviewStatus: reviewedChange(change) ? "reviewed" : "needs-review",
}));
const unresolvedDiff = {
  ...diff,
  changed: diff.changed.filter((change) => change.reviewStatus !== "reviewed"),
};
const coverage = createCoverageReport(snapshot, dataset);
coverage.ggpk = ggpkManifest.coverage;
const quality = createQualityReport(snapshot, dataset, unresolvedDiff);
const reviewQueue = createReviewQueue(snapshot, dataset, unresolvedDiff, suggest);
for (const conflict of externalConflicts) {
  reviewQueue.records.push({
    id: `item:${conflict.english}:source-conflict`,
    domain: "item",
    key: conflict.english,
    english: conflict.english,
    currentTranslation: conflict.project,
    reason: "external-source-conflict",
    suggestions: [
      {
        text: conflict.external,
        confidence: 0.99,
        method: "poe-game-data-locked-exact",
        status: "needs-review",
        evidence: [
          {
            source: `poe-game-data@${sourceLock.sources.poeGameDataNamesTw.ref}`,
            match: "normalized-exact-english",
          },
        ],
      },
    ],
  });
}
for (const rejected of officialTwOverlay.report.rejected) {
  const domain = rejected.section === "stats" ? "stat" : rejected.section === "static" ? "static" : "filter";
  const key = rejected.optionId ? `${rejected.id}:${rejected.optionId}` : rejected.id;
  reviewQueue.records.push({
    id: `${domain}:${key}:official-tw-rejected`,
    domain,
    key,
    english: rejected.english,
    reason: `official-tw-${rejected.reason}`,
    suggestions: [
      {
        text: rejected.translated,
        confidence: 1,
        method: "official-tw-stable-id-rejected",
        status: "needs-review",
        evidence: [
          {
            source: `${OFFICIAL_TW_BASE_URL}/${rejected.section}`,
            match: rejected.optionId ? "stable-entry-and-option-id" : "stable-entry-id",
          },
        ],
      },
    ],
  });
}
reviewQueue.records.sort(
  (a, b) => a.domain.localeCompare(b.domain) || a.english.localeCompare(b.english),
);
const bulkBacklogRecords = reviewQueue.records.filter((record) =>
  record.reason === "external-source-conflict" ||
  (record.reason === "missing-translation" && /^Allocates\s+/i.test(record.english ?? "")),
);
reviewQueue.records = reviewQueue.records.filter((record) => !bulkBacklogRecords.includes(record));
reviewQueue.count = reviewQueue.records.length;
const allocationBacklog = bulkBacklogRecords.filter((record) => /^Allocates\s+/i.test(record.english ?? ""));
writeJson(path.join(reportsPath, "bulk-backlog.json"), {
  schemaVersion: 1,
  generatedAt: snapshot.fetchedAt,
  datasetVersion: dataset.datasetVersion,
  summary: {
    total: bulkBacklogRecords.length,
    allocationRows: allocationBacklog.length,
    uniqueAllocations: new Set(allocationBacklog.map((record) => record.english.replace(/^Allocates\s+/i, ""))).size,
    externalConflicts: bulkBacklogRecords.filter((record) => record.reason === "external-source-conflict").length,
  },
  records: bulkBacklogRecords,
});
quality.sources = {
  officialEnglish: englishSourceStatus,
  officialTw: {
    ...twSourceStatus,
    fetchedAt: twSnapshot.fetchedAt,
    rejected: officialTwOverlay.report.summary.rejected,
  },
  ggpk: {
    fresh: true,
    generatedAt: ggpkManifest.generatedAt,
    combinedUsablePercent: ggpkManifest.coverage.combinedUsablePercent,
    tables: ggpkManifest.tables.length,
  },
};
quality.review = {
  externalNameConflicts: externalConflicts.length,
  officialTwItemOverrides: officialTwItemOverrides.length,
  officialTwItemConflicts: officialTwOverlay.report.summary.itemConflicts,
  officialTwRejected: officialTwOverlay.report.summary.rejected,
};

writeJson(path.join(reportsPath, "upstream-current.en.json"), snapshot);
writeJson(path.join(reportsPath, "upstream-diff.json"), diff);
writeJson(path.join(reportsPath, "coverage-report.json"), coverage);
writeJson(path.join(reportsPath, "quality-report.json"), quality);
writeJson(path.join(reportsPath, "review-queue.json"), reviewQueue);
writeJson(path.join(reportsPath, "external-source-report.json"), {
  schemaVersion: 1,
  generatedAt: snapshot.fetchedAt,
  source: sourceLock.sources.poeGameDataNamesTw,
  applied: externalApplied,
  conflicts: externalConflicts,
  summary: {
    applied: externalApplied.length,
    conflicts: externalConflicts.length,
  },
});
writeJson(path.join(reportsPath, "official-tw-current.json"), twSnapshot);
writeJson(path.join(reportsPath, "official-tw-source-report.json"), {
  ...officialTwOverlay.report,
  englishSource: englishSourceStatus,
  itemApplied: officialTwItemApplied,
  itemOverrides: officialTwItemOverrides,
});
writeJson(path.join(reportsPath, "ggpk-source-report.json"), {
  schemaVersion: 1,
  generatedAt: ggpkManifest.generatedAt,
  source: ggpkManifest.source,
  safety: ggpkManifest.safety,
  tables: ggpkManifest.tables,
  coverage: ggpkManifest.coverage,
  conflicts: {
    baseItems: ggpkBaseItems.conflicts,
    words: ggpkWords.conflicts,
    affixPrefixes: ggpkAffixes.conflicts.prefixes,
    affixSuffixes: ggpkAffixes.conflicts.suffixes,
    clientStrings: ggpkClientStrings.conflicts,
  },
});

if (pendingTradeApiSnapshot && quality.blocking.count === 0) {
  writeJsonAtomic(tradeApiPath, pendingTradeApiSnapshot);
}

writeJson(dataPath, dataset, { compact: true });
const compact = fs.readFileSync(dataPath);
const sha256 = crypto.createHash("sha256").update(compact).digest("hex");
writeJson(path.join(extensionPath, "data", "bundled-manifest.json"), {
  schemaVersion: 1,
  datasetVersion: dataset.datasetVersion,
  generatedAt: dataset.generatedAt,
  sha256,
  bytes: compact.byteLength,
});
writeJson(path.join(extensionPath, "data", "remote-manifest.json"), {
  schemaVersion: 1,
  datasetVersion: dataset.datasetVersion,
  generatedAt: dataset.generatedAt,
  dataUrl:
    "https://raw.githubusercontent.com/a17750/exile-trade-lens/main/extension/data/bundled.json",
  sha256,
  bytes: compact.byteLength,
});

const missing = Object.values(coverage.sections).reduce(
  (sum, section) => sum + section.entries.missing + section.groups.missing + section.options.missing,
  0,
);
console.log(`dataset: ${compact.byteLength} bytes`);
console.log(`version: ${dataset.datasetVersion}`);
console.log(`stats: ${Object.keys(stats.entries).length}`);
console.log(`items: ${Object.keys(items).length}`);
console.log(`exact: ${Object.keys(exact).length}`);
console.log(`coverage missing: ${missing}`);
console.log(`review queue: ${reviewQueue.count}`);
console.log(`external names applied: ${externalApplied.length}`);
console.log(`external name conflicts: ${externalConflicts.length}`);
console.log(`official tw stable entries: ${officialTwOverlay.report.summary.entriesApplied}`);
console.log(`official tw items applied: ${officialTwItemApplied.length}`);
console.log(`official tw item groups skipped: ${officialTwOverlay.report.itemAlignment.skippedGroups.length}`);
console.log(`blocking quality issues: ${quality.blocking.count}`);
console.log(`sha256: ${sha256}`);
