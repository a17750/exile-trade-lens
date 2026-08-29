import { countPlaceholders } from "./translation-engine.mjs";

function translatedText(dataset, domain, key) {
  if (domain === "item") {
    return dataset.baseItems?.[key] || dataset.fixedNames?.[key] || dataset.items?.[key];
  }
  if (domain === "stat") return dataset.stats?.entries?.[key]?.text;
  if (domain === "static") return dataset.static?.entries?.[key];
  if (domain === "filter") return dataset.filters?.entries?.[key]?.text;
  return null;
}

function translatedGroup(dataset, section, key, english) {
  if (section === "items") return dataset.exact?.[english] || dataset.ui?.[english];
  return dataset[section]?.groups?.[key];
}

function translatedOption(dataset, section, entryId, optionId) {
  return dataset[section]?.entries?.[entryId]?.options?.[optionId];
}

const percent = (translated, total) => (total ? Number(((translated / total) * 100).toFixed(2)) : 100);

export function createCoverageReport(snapshot, dataset) {
  const sections = {};
  for (const [section, source] of Object.entries(snapshot.sections)) {
    const domain = domainForSection(section);
    const entryKeys = Object.keys(source.entries).filter((key) =>
      String(source.entries[key]?.english ?? "").trim(),
    );
    const translatedEntries = entryKeys.filter((key) => translatedText(dataset, domain, key)).length;
    const groupKeys = Object.keys(source.groups).filter((key) =>
      String(source.groups[key] ?? "").trim(),
    );
    const translatedGroups = groupKeys.filter((key) =>
      translatedGroup(dataset, section, key, source.groups[key]),
    ).length;
    let optionsTotal = 0;
    let optionsTranslated = 0;
    if (section !== "items") {
      for (const [entryId, entry] of Object.entries(source.entries)) {
        for (const optionId of Object.keys(entry.options ?? {})) {
          optionsTotal += 1;
          if (translatedOption(dataset, section, entryId, optionId)) optionsTranslated += 1;
        }
      }
    }
    sections[section] = {
      entries: {
        total: entryKeys.length,
        translated: translatedEntries,
        missing: entryKeys.length - translatedEntries,
        percent: percent(translatedEntries, entryKeys.length),
      },
      groups: {
        total: groupKeys.length,
        translated: translatedGroups,
        missing: groupKeys.length - translatedGroups,
        percent: percent(translatedGroups, groupKeys.length),
      },
      options: {
        total: optionsTotal,
        translated: optionsTranslated,
        missing: optionsTotal - optionsTranslated,
        percent: percent(optionsTranslated, optionsTotal),
      },
    };
  }
  return { schemaVersion: 1, generatedAt: snapshot.fetchedAt, datasetVersion: dataset.datasetVersion, sections };
}

function flattenSnapshot(snapshot) {
  const rows = new Map();
  for (const [section, data] of Object.entries(snapshot?.sections ?? {})) {
    for (const [id, english] of Object.entries(data.groups ?? {})) {
      rows.set(`${section}:group:${id}`, { section, kind: "group", id, english });
    }
    for (const [id, entry] of Object.entries(data.entries ?? {})) {
      rows.set(`${section}:entry:${id}`, {
        section,
        kind: "entry",
        id,
        english: entry.english,
        contexts: entry.contexts ?? [entry.groupId].filter(Boolean),
      });
      for (const [optionId, english] of Object.entries(entry.options ?? {})) {
        rows.set(`${section}:option:${id}:${optionId}`, {
          section,
          kind: "option",
          id,
          optionId,
          english,
          contexts: [entry.groupId].filter(Boolean),
        });
      }
    }
  }
  return rows;
}

export function diffSnapshots(baseline, current) {
  if (!baseline) {
    return { schemaVersion: 1, baseline: null, current: current.fetchedAt, added: [], removed: [], changed: [] };
  }
  const before = flattenSnapshot(baseline);
  const after = flattenSnapshot(current);
  const added = [];
  const removed = [];
  const changed = [];
  for (const [key, row] of after) {
    if (!before.has(key)) added.push({ key, ...row });
    else if (before.get(key).english !== row.english) {
      changed.push({ key, ...row, previousEnglish: before.get(key).english });
    }
  }
  for (const [key, row] of before) {
    if (!after.has(key)) removed.push({ key, ...row });
  }
  return {
    schemaVersion: 1,
    baseline: baseline.fetchedAt,
    current: current.fetchedAt,
    added,
    removed,
    changed,
  };
}

function domainForSection(section) {
  if (section === "items") return "item";
  if (section === "stats") return "stat";
  if (section === "static") return "static";
  return "filter";
}

export function createQualityReport(snapshot, dataset, diff) {
  const placeholderErrors = [];
  for (const [section, data] of Object.entries(snapshot.sections)) {
    if (section === "items") continue;
    const domain = domainForSection(section);
    for (const [id, entry] of Object.entries(data.entries)) {
      if (!String(entry.english ?? "").trim()) continue;
      const translation = translatedText(dataset, domain, id);
      if (translation && countPlaceholders(entry.english) !== countPlaceholders(translation)) {
        placeholderErrors.push({ domain, key: id, english: entry.english, translation });
      }
    }
  }
  const semanticChanges = diff.changed.filter((entry) => entry.kind !== "group");
  return {
    schemaVersion: 1,
    generatedAt: snapshot.fetchedAt,
    blocking: {
      placeholderErrors,
      semanticChanges,
      count: placeholderErrors.length + semanticChanges.length,
    },
  };
}

export function createReviewQueue(snapshot, dataset, diff) {
  const records = [];
  for (const [section, data] of Object.entries(snapshot.sections)) {
    const domain = domainForSection(section);
    for (const [key, entry] of Object.entries(data.entries)) {
      if (!String(entry.english ?? "").trim()) continue;
      if (translatedText(dataset, domain, key)) continue;
      records.push({
        id: `${domain}:${key}`,
        domain,
        key,
        english: entry.english,
        context: entry.contexts ?? [entry.groupId].filter(Boolean),
        reason: "missing-translation",
        suggestions: [],
      });
    }
  }
  for (const change of diff.changed) {
    if (change.kind !== "entry") continue;
    const domain = domainForSection(change.section);
    const currentTranslation = translatedText(dataset, domain, change.id);
    if (!currentTranslation) continue;
    records.push({
      id: `${domain}:${change.id}:semantic-change`,
      domain,
      key: change.id,
      english: change.english,
      previousEnglish: change.previousEnglish,
      currentTranslation,
      context: change.contexts ?? [],
      reason: "source-text-changed",
      suggestions: [],
    });
  }
  records.sort((a, b) => a.domain.localeCompare(b.domain) || a.english.localeCompare(b.english));
  return {
    schemaVersion: 1,
    generatedAt: snapshot.fetchedAt,
    datasetVersion: dataset.datasetVersion,
    count: records.length,
    records,
  };
}
