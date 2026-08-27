import { countPlaceholders } from "./translation-engine.mjs";

const STABLE_SECTIONS = ["stats", "static", "filters"];

function usableTranslation(english, translated) {
  english = String(english ?? "").trim();
  translated = String(translated ?? "").trim();
  if (!english || !translated || english === translated) return false;
  return countPlaceholders(english) === countPlaceholders(translated);
}

function stableSectionOverlay(english, translated, section) {
  const groups = {};
  const entries = {};
  const rejected = [];
  const missingIds = [];

  for (const [id, englishText] of Object.entries(english.groups ?? {})) {
    const translatedText = translated.groups?.[id];
    if (usableTranslation(englishText, translatedText)) groups[id] = translatedText.trim();
  }

  for (const [id, englishEntry] of Object.entries(english.entries ?? {})) {
    const translatedEntry = translated.entries?.[id];
    if (!translatedEntry) {
      missingIds.push(id);
      continue;
    }
    const result = { options: {} };
    if (usableTranslation(englishEntry.english, translatedEntry.english)) {
      result.text = translatedEntry.english.trim();
    } else if (
      translatedEntry.english &&
      englishEntry.english !== translatedEntry.english &&
      countPlaceholders(englishEntry.english) !== countPlaceholders(translatedEntry.english)
    ) {
      rejected.push({
        section,
        kind: "entry",
        id,
        english: englishEntry.english,
        translated: translatedEntry.english,
        reason: "placeholder-mismatch",
      });
    }
    for (const [optionId, englishOption] of Object.entries(englishEntry.options ?? {})) {
      const translatedOption = translatedEntry.options?.[optionId];
      if (usableTranslation(englishOption, translatedOption)) {
        result.options[optionId] = translatedOption.trim();
      } else if (
        translatedOption &&
        englishOption !== translatedOption &&
        countPlaceholders(englishOption) !== countPlaceholders(translatedOption)
      ) {
        rejected.push({
          section,
          kind: "option",
          id,
          optionId,
          english: englishOption,
          translated: translatedOption,
          reason: "placeholder-mismatch",
        });
      }
    }
    if (result.text || Object.keys(result.options).length) entries[id] = result;
  }

  return { groups, entries, rejected, missingIds };
}

function invariantItemShape(entry) {
  const flags = Object.fromEntries(Object.entries(entry?.flags ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify({
    disc: entry?.disc ?? "",
    flags,
    hasType: Boolean(entry?.type),
    hasName: Boolean(entry?.name),
    hasText: Boolean(entry?.text),
    image: entry?.image ?? "",
  });
}

function stableItemKey(entry) {
  if (entry?.id) return `id:${entry.id}`;
  if (entry?.image) return `image:${entry.image}`;
  return null;
}

function itemOverlay(englishRaw, translatedRaw) {
  const items = {};
  const conflicts = [];
  const alignedGroups = [];
  const skippedGroups = [];
  if (!englishRaw?.result || !translatedRaw?.result) {
    return {
      items,
      conflicts,
      alignedGroups,
      skippedGroups: [{ id: "*", reason: "english-raw-unavailable" }],
    };
  }

  const translatedGroups = new Map(translatedRaw.result.map((group) => [group.id, group]));
  for (const englishGroup of englishRaw.result) {
    const translatedGroup = translatedGroups.get(englishGroup.id);
    if (!translatedGroup) {
      skippedGroups.push({ id: englishGroup.id, reason: "group-missing" });
      continue;
    }
    const englishEntries = englishGroup.entries ?? [];
    const translatedEntries = translatedGroup.entries ?? [];
    const translatedByKey = new Map();
    for (const entry of translatedEntries) {
      const key = stableItemKey(entry);
      if (!key) continue;
      if (translatedByKey.has(key)) translatedByKey.set(key, null);
      else translatedByKey.set(key, entry);
    }
    let matched = 0;
    for (let index = 0; index < englishEntries.length; index += 1) {
      const englishEntry = englishEntries[index];
      const key = stableItemKey(englishEntry);
      const translatedEntry = key ? translatedByKey.get(key) : null;
      if (!translatedEntry || invariantItemShape(englishEntry) !== invariantItemShape(translatedEntry)) {
        continue;
      }
      matched += 1;
      for (const field of ["type", "name"]) {
        const englishText = String(englishEntry[field] ?? "").trim();
        const translatedText = String(translatedEntry[field] ?? "").trim();
        if (!usableTranslation(englishText, translatedText)) continue;
        if (items[englishText] && items[englishText] !== translatedText) {
          conflicts.push({
            groupId: englishGroup.id,
            index,
            field,
            english: englishText,
            first: items[englishText],
            second: translatedText,
          });
          delete items[englishText];
        } else if (!conflicts.some((entry) => entry.english === englishText)) {
          items[englishText] = translatedText;
        }
      }
    }
    if (matched) alignedGroups.push({ id: englishGroup.id, entries: matched });
    if (matched < englishEntries.length) {
      skippedGroups.push({
        id: englishGroup.id,
        reason: "entries-without-stable-key",
        matched,
        englishCount: englishEntries.length,
        translatedCount: translatedEntries.length,
      });
    }
  }
  return { items, conflicts, alignedGroups, skippedGroups };
}

export function createOfficialTwOverlay({ englishSnapshot, translatedSnapshot, englishRaw, translatedRaw }) {
  const sections = {};
  const rejected = [];
  const missingIds = {};
  for (const section of STABLE_SECTIONS) {
    const result = stableSectionOverlay(
      englishSnapshot.sections[section],
      translatedSnapshot.sections[section],
      section,
    );
    sections[section] = { groups: result.groups, entries: result.entries };
    rejected.push(...result.rejected);
    missingIds[section] = result.missingIds;
  }
  const itemResult = itemOverlay(englishRaw?.items, translatedRaw?.items);
  return {
    sections,
    items: itemResult.items,
    report: {
      schemaVersion: 1,
      generatedAt: translatedSnapshot.fetchedAt,
      source: translatedSnapshot.source,
      summary: {
        groupsApplied: Object.values(sections).reduce(
          (sum, value) => sum + Object.keys(value.groups).length,
          0,
        ),
        entriesApplied: Object.values(sections).reduce(
          (sum, value) => sum + Object.keys(value.entries).length,
          0,
        ),
        itemsApplied: Object.keys(itemResult.items).length,
        rejected: rejected.length,
        itemConflicts: itemResult.conflicts.length,
      },
      stableIdMissing: missingIds,
      rejected,
      itemAlignment: {
        alignedGroups: itemResult.alignedGroups,
        skippedGroups: itemResult.skippedGroups,
        conflicts: itemResult.conflicts,
      },
    },
  };
}
