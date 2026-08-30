import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  clone,
  extensionPath,
  readJson,
  reportsPath,
  rootPath,
  dataPath,
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
import { countPlaceholders } from "./lib/translation-engine.mjs";
import {
  createCoverageReport,
  createQualityReport,
  createReviewQueue,
  diffSnapshots,
} from "./lib/audit.mjs";

const uiSource = readJson(path.join(rootPath, "data", "ui.zh-TW.json"));
const itemFieldSource = readJson(path.join(rootPath, "data", "item-fields.zh-TW.json"));
const itemPropertyType109Source = readJson(
  path.join(rootPath, "data", "item-property-type109.zh-TW.json"),
);
const verifiedLabels = readJson(path.join(dataPath, "verified-labels.zh-TW.json"));
const manualOverrides = readJson(path.join(dataPath, "manual-overrides.json"));
const verifiedStatRenderings = readJson(
  path.join(dataPath, "verified-stat-renderings.zh-TW.json"),
);
const ggpkSource = readJson(path.join(rootPath, "data", "ggpk.json"));
const ggpkManifest = ggpkSource.manifest;
const ggpkBaseItems = ggpkSource.baseItems;
const ggpkWords = ggpkSource.words;
const ggpkAffixes = ggpkSource.affixes;
const ggpkClientStrings = ggpkSource.clientStrings;
const ggpkPassiveSkills = ggpkSource.passiveSkills;
const ggpkStatDescriptions = ggpkSource.statDescriptions;
const tradeApiPath = path.join(rootPath, "data", "trade-api.json");
const cachedTradeApi = readJson(tradeApiPath, null);
const baseline = readJson(path.join(dataPath, "upstream-baseline.en.json"), null);

if (uiSource.schemaVersion !== 1 || uiSource.locale !== "zh-TW") {
  throw new Error("data/ui.zh-TW.json 格式不兼容");
}
if (itemFieldSource.schemaVersion !== 1 || itemFieldSource.locale !== "zh-TW") {
  throw new Error("data/item-fields.zh-TW.json 格式不兼容");
}
if (
  itemPropertyType109Source.schemaVersion !== 1 ||
  itemPropertyType109Source.locale !== "zh-TW" ||
  itemPropertyType109Source.propertyType !== 109 ||
  itemPropertyType109Source.template !== "{qualifier}{class}"
) {
  throw new Error("data/item-property-type109.zh-TW.json 格式不兼容");
}
if (verifiedLabels.schemaVersion !== 1 || verifiedLabels.locale !== "zh-TW") {
  throw new Error("data/verified-labels.zh-TW.json 格式不兼容");
}
if (manualOverrides.schemaVersion !== 1) {
  throw new Error("data/manual-overrides.json 格式不兼容");
}
if (
  verifiedStatRenderings.schemaVersion !== 1 ||
  verifiedStatRenderings.locale !== "zh-TW"
) {
  throw new Error("data/verified-stat-renderings.zh-TW.json 格式不兼容");
}
if (
  ggpkManifest.schemaVersion !== 1 ||
  ggpkBaseItems.schemaVersion !== 1 ||
  ggpkWords.schemaVersion !== 1 ||
  ggpkAffixes.schemaVersion !== 1 ||
  ggpkClientStrings.schemaVersion !== 1 ||
  ggpkPassiveSkills?.schemaVersion !== 1 ||
  ggpkStatDescriptions?.schemaVersion !== 1 ||
  ggpkBaseItems.domain !== "base-item" ||
  ggpkWords.domain !== "word-component" ||
  ggpkAffixes.domain !== "affix-name" ||
  ggpkClientStrings.domain !== "client-string"
  || ggpkPassiveSkills.domain !== "passive-skill"
  || ggpkStatDescriptions.domain !== "stat-description"
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
const useCachedTradeApi = process.argv.includes("--cached-trade-api");
if (useCachedTradeApi) {
  if (!isUsableTradeApiCache(cachedTradeApi)) {
    throw new Error("--cached-trade-api 需要有效的 data/trade-api.json");
  }
  snapshot = cachedTradeApi.english;
  twSnapshot = cachedTradeApi.zhTW;
  officialTwOverlay = cachedTradeApi.overlay;
  englishSourceStatus = { fresh: false, error: "explicit cached Trade API build" };
  twSourceStatus = { fresh: false, error: "explicit cached Trade API build" };
} else try {
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

const items = {};
const stats = { groups: {}, entries: {} };
const staticData = { groups: {}, entries: {} };
const filters = { groups: {}, entries: {} };
const properties = clone(verifiedLabels.properties ?? {});
const allocates = {};
const ui = clone(uiSource.entries ?? {});
const exact = {};
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

const normalizeBoundLabel = (value) =>
  String(value ?? "")
    .replace(/\[([^|\]]+)\|([^\]]+)\]/g, "$2")
    .replace(/\[([^\]]+)\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

function resolveItemFieldBinding(targetEnglish, binding, resolvedProperties = properties) {
  let sourceEnglish;
  let text;
  if (binding.source === "ggpk-client") {
    sourceEnglish = normalizeBoundLabel(binding.key);
    text = normalizeBoundLabel(ggpkClientStrings.byEnglish?.[binding.key]);
  } else if (binding.source === "ggpk-word") {
    sourceEnglish = binding.key;
    text = ggpkWords.byEnglish?.[binding.key];
  } else if (binding.source === "ggpk-passive") {
    sourceEnglish = binding.key;
    text = ggpkPassiveSkills.byEnglish?.[binding.key];
  } else if (binding.source === "trade-filter") {
    sourceEnglish = snapshot.sections.filters.entries?.[binding.id]?.english;
    text = officialTwOverlay.sections.filters.entries?.[binding.id]?.text;
  } else if (binding.source === "reviewed-trade-stat-term") {
    sourceEnglish = targetEnglish;
    text = binding.text;
    if (!Array.isArray(binding.evidence) || !binding.evidence.length) {
      throw new Error(`已审核物品术语缺少官方证据：${targetEnglish}`);
    }
    for (const evidence of binding.evidence) {
      const currentEnglish = snapshot.sections.stats.entries?.[evidence.id]?.english;
      const currentText = officialTwOverlay.sections.stats.entries?.[evidence.id]?.text;
      if (
        currentEnglish !== evidence.expectedEnglish ||
        currentText !== evidence.expectedText
      ) {
        throw new Error(
          `已审核物品术语证据已变化：${targetEnglish}:${evidence.id} ` +
            `${JSON.stringify({ currentEnglish, currentText })}`,
        );
      }
    }
  } else if (binding.source === "property") {
    sourceEnglish = binding.key;
    text = resolvedProperties[binding.key];
  } else if (binding.source === "ui") {
    sourceEnglish = binding.key;
    text = uiSource.entries?.[binding.key];
  } else {
    throw new Error(`未知物品字段来源：${targetEnglish}:${binding.source}`);
  }
  sourceEnglish = normalizeBoundLabel(sourceEnglish);
  text = normalizeBoundLabel(text);
  if (!sourceEnglish || !text || sourceEnglish === text) {
    throw new Error(`物品字段来源缺失：${targetEnglish}:${binding.source}:${binding.key ?? binding.id}`);
  }
  if (sourceEnglish !== targetEnglish && !binding.reviewedAlias) {
    throw new Error(
      `物品字段英文不一致：目标 ${JSON.stringify(targetEnglish)}，` +
        `来源 ${JSON.stringify(sourceEnglish)}`,
    );
  }
  return {
    text,
    source: {
      kind: binding.source,
      key: binding.key ?? binding.id,
      english: sourceEnglish,
      ...(binding.source === "reviewed-trade-stat-term"
        ? { evidenceIds: binding.evidence.map((entry) => entry.id) }
        : {}),
      ...(binding.reviewedAlias ? { reviewedAlias: true } : {}),
    },
  };
}

const itemFields = { properties: {}, dom: {} };
const automaticItemFieldIds = [];
const automaticItemPropertyNames = [];

function setItemProperty(english, resolved, origin) {
  const previous = properties[english];
  if (previous && previous !== resolved.text) {
    throw new Error(
      `物品属性来源冲突：${english} 已有 ${JSON.stringify(previous)}，` +
        `${origin} 提供 ${JSON.stringify(resolved.text)}`,
    );
  }
  properties[english] = resolved.text;
  itemFields.properties[english] = resolved;
}

function addItemDomLabel(fieldId, english, resolved) {
  itemFields.dom[fieldId] ??= { labels: {} };
  const previous = itemFields.dom[fieldId].labels[english];
  if (previous?.text && previous.text !== resolved.text) {
    throw new Error(
      `物品 data-field 来源冲突：${fieldId}:${english} ` +
        `${JSON.stringify(previous.text)} / ${JSON.stringify(resolved.text)}`,
    );
  }
  itemFields.dom[fieldId].labels[english] = resolved;
}

// The official equipment filter registry is also the stable field registry used by
// result cards. Exact ID+English pairs are safe to import in bulk. If the same full
// English label exists in GGPK ClientStrings, use the client wording for /fetch
// properties while retaining the Trade API wording as the DOM fallback.
for (const [fieldId, entry] of Object.entries(snapshot.sections.filters.entries ?? {})) {
  if (entry?.groupId !== "equipment_filters") continue;
  const translated = officialTwOverlay.sections.filters.entries?.[fieldId]?.text;
  if (!entry.english || !translated) continue;
  addItemDomLabel(
    fieldId,
    entry.english,
    resolveItemFieldBinding(entry.english, { source: "trade-filter", id: fieldId }),
  );
  automaticItemFieldIds.push(fieldId);
  if (ggpkClientStrings.byEnglish?.[entry.english]) {
    const resolved = resolveItemFieldBinding(entry.english, {
      source: "ggpk-client",
      key: entry.english,
    });
    setItemProperty(entry.english, resolved, `equipment_filters:${fieldId}`);
    automaticItemPropertyNames.push(entry.english);
  }
}

for (const [english, binding] of Object.entries(itemFieldSource.propertyBindings ?? {})) {
  setItemProperty(
    english,
    resolveItemFieldBinding(english, binding),
    "data/item-fields.zh-TW.json",
  );
}

for (const [fieldId, field] of Object.entries(itemFieldSource.domFields ?? {})) {
  for (const [english, binding] of Object.entries(field.labels ?? {})) {
    addItemDomLabel(fieldId, english, resolveItemFieldBinding(english, binding));
  }
}

// Build one domain-scoped resolver for /fetch item.properties. Previously the
// runtime consulted only `properties`, so labels already translated in an
// official GGPK or Trade API index could still be reported as missing. These
// candidates are never added to the global exact/UI index.
const itemPropertyCandidates = new Map();
function addItemPropertyCandidate(english, text, source) {
  english = normalizeBoundLabel(english);
  text = normalizeBoundLabel(text);
  if (
    !english ||
    !text ||
    english === text ||
    english.length > 120 ||
    /[{}\r\n<>]/.test(english) ||
    !/[A-Za-z]/.test(english)
  ) return;
  const candidates = itemPropertyCandidates.get(english) ?? [];
  if (!candidates.some((candidate) =>
    candidate.text === text &&
    candidate.source.kind === source.kind &&
    candidate.source.key === source.key
  )) {
    candidates.push({ text, source });
  }
  itemPropertyCandidates.set(english, candidates);
}

for (const [english, text] of Object.entries(verifiedLabels.properties ?? {})) {
  addItemPropertyCandidate(english, text, { kind: "verified-property", key: english });
}
for (const [english, record] of Object.entries(itemFields.properties)) {
  addItemPropertyCandidate(english, record.text, record.source);
}
const tradePropertyLabels = new Set();
for (const [id, entry] of Object.entries(snapshot.sections.filters.entries ?? {})) {
  const translatedEntry = officialTwOverlay.sections.filters.entries?.[id];
  if (translatedEntry?.text) {
    tradePropertyLabels.add(normalizeBoundLabel(entry.english));
    addItemPropertyCandidate(entry.english, translatedEntry.text, {
      kind: "trade-filter",
      key: id,
    });
  }
  for (const [optionId, english] of Object.entries(entry.options ?? {})) {
    const text = translatedEntry?.options?.[optionId];
    if (!text) continue;
    tradePropertyLabels.add(normalizeBoundLabel(english));
    addItemPropertyCandidate(english, text, {
      kind: "trade-filter-option",
      key: `${id}:${optionId}`,
    });
  }
}
for (const [english, text] of Object.entries(ggpkClientStrings.byEnglish ?? {})) {
  const normalizedEnglish = normalizeBoundLabel(english);
  // Bracketed client strings carry a stable semantic token used by item
  // properties (for example `[ElementalDamage|Elemental] Damage`). Untagged
  // strings are admitted only when the Trade API independently exposes the
  // same complete label, such as `Staff`.
  if (!/\[[^\]]+\]/.test(english) && !tradePropertyLabels.has(normalizedEnglish)) continue;
  addItemPropertyCandidate(english, text, { kind: "ggpk-client", key: english });
}
for (const [english, text] of Object.entries(ggpkPassiveSkills.byEnglish ?? {})) {
  const normalizedEnglish = normalizeBoundLabel(english);
  // Cross-domain names may corroborate a property candidate but may never
  // create one on their own.
  if (!itemPropertyCandidates.has(normalizedEnglish)) continue;
  addItemPropertyCandidate(english, text, { kind: "ggpk-passive-exact", key: english });
}

const itemPropertyIndex = {};
const itemPropertyConflicts = [];
for (const [english, candidates] of [...itemPropertyCandidates.entries()].sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  const reviewed = itemFields.properties[english];
  const translations = new Map();
  for (const candidate of candidates) {
    const sources = translations.get(candidate.text) ?? [];
    sources.push(candidate.source);
    translations.set(candidate.text, sources);
  }
  if (reviewed) {
    itemPropertyIndex[english] = {
      text: reviewed.text,
      sources: [reviewed.source],
      reviewed: true,
    };
    if (translations.size > 1) {
      itemPropertyConflicts.push({
        english,
        status: "resolved-by-reviewed-binding",
        selected: reviewed.text,
        candidates: Object.fromEntries(translations),
      });
    }
    continue;
  }
  if (translations.size !== 1) {
    itemPropertyConflicts.push({
      english,
      status: "unresolved",
      candidates: Object.fromEntries(translations),
    });
    continue;
  }
  const [[text, sources]] = translations;
  itemPropertyIndex[english] = { text, sources: sources.slice(0, 8) };
}

const knownButUnrouted = [...itemPropertyCandidates.keys()].filter((english) => {
  const candidates = itemPropertyCandidates.get(english) ?? [];
  return new Set(candidates.map((candidate) => candidate.text)).size === 1 &&
    !itemPropertyIndex[english];
});
if (knownButUnrouted.length) {
  throw new Error(
    `物品属性存在已知但未接入的官方译文：${knownButUnrouted.slice(0, 20).join(", ")}`,
  );
}

function type109EvidenceText(evidence) {
  if (evidence.source === "ggpk-base-item") return ggpkBaseItems.byEnglish?.[evidence.key];
  if (evidence.source === "ggpk-word") return ggpkWords.byEnglish?.[evidence.key];
  if (evidence.source === "ggpk-passive") return ggpkPassiveSkills.byEnglish?.[evidence.key];
  throw new Error(`未知 type 109 前缀证据来源：${evidence.source}`);
}

const itemPropertyType109 = {
  propertyType: 109,
  template: itemPropertyType109Source.template,
  qualifiers: {},
  classes: {},
};
for (const [english, qualifier] of Object.entries(itemPropertyType109Source.qualifiers ?? {})) {
  const text = normalizeBoundLabel(qualifier.text);
  if (!english || !text || !Array.isArray(qualifier.evidence) || qualifier.evidence.length < 2) {
    throw new Error(`type 109 前缀缺少双重官方证据：${english}`);
  }
  for (const evidence of qualifier.evidence) {
    const currentText = type109EvidenceText(evidence);
    if (currentText !== evidence.expectedText || !currentText.includes(text)) {
      throw new Error(
        `type 109 前缀证据已变化：${english}:${evidence.source}:${evidence.key}`,
      );
    }
  }
  itemPropertyType109.qualifiers[english] = {
    text,
    source: "reviewed-official-term",
    evidence: qualifier.evidence,
  };
}

const categoryEntry = snapshot.sections.filters.entries?.category;
const translatedCategory = officialTwOverlay.sections.filters.entries?.category;
for (const [optionId, english] of Object.entries(categoryEntry?.options ?? {})) {
  if (
    !itemPropertyType109Source.classOptionPrefixes.some((prefix) => optionId.startsWith(prefix)) ||
    /^Any\b/.test(english)
  ) continue;
  const text = normalizeBoundLabel(translatedCategory?.options?.[optionId]);
  if (!english || !text || english === text) continue;
  const previous = itemPropertyType109.classes[english];
  if (previous && previous.text !== text) {
    throw new Error(`type 109 装备类别冲突：${english}:${previous.text}/${text}`);
  }
  itemPropertyType109.classes[english] = {
    text,
    source: { kind: "trade-filter-option", key: `category:${optionId}` },
  };
}
if (!itemPropertyType109.classes.Staff || !itemPropertyType109.classes.Helmet) {
  throw new Error("type 109 核心装备类别未从 Trade API 生成");
}

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

// Passive node names are joined only as complete, official GGPK pairs. This
// deliberately avoids word-level composition: an allocation is valid only
// when the whole node name exists in the localized PassiveSkills table.
for (const [english, translated] of Object.entries(ggpkPassiveSkills.byEnglish ?? {})) {
  if (!english || !translated || english === translated) continue;
  allocates[english] = translated;
  addExact(`Allocates ${english}`, `配置 ${translated}`);
}

// GGPK CSD descriptions are a conservative fallback for catalog stats that
// the official TW Trade API has not localized. The stable-ID overlay ran first.
let ggpkStatDescriptionsApplied = 0;
for (const [english, translated] of Object.entries(ggpkStatDescriptions.byEnglish ?? {})) {
  const normalizedEnglish = normalizeTradeDescription(english);
  const normalizedTranslated = normalizeTradeDescription(translated);
  if (!normalizedEnglish || !normalizedTranslated || normalizedEnglish === normalizedTranslated) continue;
  for (const [id, sourceEntry] of Object.entries(snapshot.sections.stats.entries ?? {})) {
    if (normalizeTradeDescription(sourceEntry?.english) !== normalizedEnglish) continue;
    const targetEntry = stats.entries[id] ?? {};
    if (!targetEntry.text) {
      stats.entries[id] = { ...targetEntry, text: normalizedTranslated, source: "ggpk-stat-description" };
      ggpkStatDescriptionsApplied += 1;
    }
    addExact(normalizedEnglish, normalizedTranslated);
  }
}

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

const bundledDataPath = path.join(extensionPath, "data", "bundled.json");
const previousDataset = readJson(bundledDataPath, null);
const datasetContent = {
  locale: "zh-TW",
  source: "project-owned translation pipeline",
  sources: [
    "data/ui.zh-TW.json",
    "data/item-fields.zh-TW.json",
    "data/item-property-type109.zh-TW.json",
    "data/verified-labels.zh-TW.json",
    "data/manual-overrides.json",
    "data/verified-stat-renderings.zh-TW.json",
    "data/ggpk.json",
    "data/trade-api.json",
  ],
  items,
  baseItems,
  fixedNames,
  wordComponents,
  affixNames,
  itemDisplayTemplates,
  itemFields,
  itemPropertyIndex,
  itemPropertyType109,
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
  `project-zhTW.labels-${verifiedLabels.version ?? 0}` +
  `.manual-${manualOverrides.version ?? 0}` +
  `.renderings-${verifiedStatRenderings.version ?? 0}` +
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
const reviewQueue = createReviewQueue(snapshot, dataset, unresolvedDiff);
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
const bulkBacklogRecords = reviewQueue.records.filter(
  (record) =>
    record.reason === "missing-translation" && /^Allocates\s+/i.test(record.english ?? ""),
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
  },
  records: bulkBacklogRecords,
});
const automaticDomFieldSet = new Set(automaticItemFieldIds);
const automaticPropertySet = new Set(automaticItemPropertyNames);
writeJson(path.join(reportsPath, "item-field-coverage.json"), {
  schemaVersion: 1,
  generatedAt: snapshot.fetchedAt,
  datasetVersion: dataset.datasetVersion,
  registry: {
    source: `${OFFICIAL_EN_BASE_URL}/filters#equipment_filters`,
    automaticDomFields: [...automaticDomFieldSet].sort(),
    automaticProperties: [...automaticPropertySet].sort(),
    reviewedPropertyExceptions: Object.keys(itemFieldSource.propertyBindings ?? {}).sort(),
    reviewedDomExceptions: Object.keys(itemFieldSource.domFields ?? {}).sort(),
  },
  summary: {
    automaticDomFieldCount: automaticDomFieldSet.size,
    automaticPropertyCount: automaticPropertySet.size,
    totalDomFieldCount: Object.keys(itemFields.dom).length,
    totalPropertyCount: Object.keys(itemFields.properties).length,
  },
});
writeJson(path.join(reportsPath, "item-property-resolution.json"), {
  schemaVersion: 1,
  generatedAt: snapshot.fetchedAt,
  datasetVersion: dataset.datasetVersion,
  summary: {
    candidates: itemPropertyCandidates.size,
    resolved: Object.keys(itemPropertyIndex).length,
    knownButUnrouted: knownButUnrouted.length,
    conflicts: itemPropertyConflicts.length,
    unresolvedConflicts: itemPropertyConflicts.filter((entry) => entry.status === "unresolved").length,
    type109Qualifiers: Object.keys(itemPropertyType109.qualifiers).length,
    type109Classes: Object.keys(itemPropertyType109.classes).length,
  },
  knownButUnrouted,
  conflicts: itemPropertyConflicts,
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
  officialTwItemOverrides: officialTwItemOverrides.length,
  officialTwItemConflicts: officialTwOverlay.report.summary.itemConflicts,
  officialTwRejected: officialTwOverlay.report.summary.rejected,
};

writeJson(path.join(reportsPath, "upstream-current.en.json"), snapshot);
writeJson(path.join(reportsPath, "upstream-diff.json"), diff);
writeJson(path.join(reportsPath, "coverage-report.json"), coverage);
writeJson(path.join(reportsPath, "quality-report.json"), quality);
writeJson(path.join(reportsPath, "review-queue.json"), reviewQueue);
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
    passiveSkills: ggpkPassiveSkills.conflicts,
    statDescriptions: ggpkStatDescriptions.conflicts,
  },
  applied: { ggpkStatDescriptions: ggpkStatDescriptionsApplied },
});

if (pendingTradeApiSnapshot && quality.blocking.count === 0) {
  writeJsonAtomic(tradeApiPath, pendingTradeApiSnapshot);
}

writeJson(bundledDataPath, dataset, { compact: true });
const compact = fs.readFileSync(bundledDataPath);
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
console.log(`official tw stable entries: ${officialTwOverlay.report.summary.entriesApplied}`);
console.log(`official tw items applied: ${officialTwItemApplied.length}`);
console.log(`official tw item groups skipped: ${officialTwOverlay.report.itemAlignment.skippedGroups.length}`);
console.log(`blocking quality issues: ${quality.blocking.count}`);
console.log(`sha256: ${sha256}`);
