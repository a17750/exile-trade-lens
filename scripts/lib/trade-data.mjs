const ENDPOINTS = ["items", "stats", "static", "filters"];
export const OFFICIAL_EN_BASE_URL = "https://www.pathofexile.com/api/trade2/data";
export const OFFICIAL_TW_BASE_URL = "https://pathofexile.tw/api/trade2/data";

export async function fetchTradeData({
  baseUrl = OFFICIAL_EN_BASE_URL,
  fetchImpl = fetch,
  userAgent = "poe2-trade-zh-dataset-builder/0.4",
} = {}) {
  const pairs = await Promise.all(
    ENDPOINTS.map(async (key) => {
      const response = await fetchImpl(`${baseUrl}/${key}`, {
        headers: {
          Accept: "application/json",
          "User-Agent": userAgent,
        },
      });
      if (!response.ok) throw new Error(`${baseUrl}/${key} 返回 HTTP ${response.status}`);
      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("json")) {
        throw new Error(`${baseUrl}/${key} 没有返回 JSON`);
      }
      return [key, await response.json()];
    }),
  );
  return Object.fromEntries(pairs);
}

export function fetchOfficialTradeData(options = {}) {
  return fetchTradeData({ baseUrl: OFFICIAL_EN_BASE_URL, ...options });
}

export function fetchOfficialTwTradeData(options = {}) {
  return fetchTradeData({
    baseUrl: OFFICIAL_TW_BASE_URL,
    userAgent: "poe2-trade-zh-dataset-builder/0.4 tw-sync",
    ...options,
  });
}

function addItem(target, english, groupId, kind) {
  english = String(english ?? "").trim();
  if (!english) return;
  target[english] ??= { english, contexts: [] };
  const context = `${groupId}:${kind}`;
  if (!target[english].contexts.includes(context)) target[english].contexts.push(context);
}

function normalizeGroups(data, { groupField, entryField = "entries", itemMode = false }) {
  const groups = {};
  const entries = {};
  for (const group of data?.result ?? []) {
    groups[group.id] = String(group[groupField] ?? "");
    for (const entry of group[entryField] ?? []) {
      if (itemMode) {
        addItem(entries, entry.type, group.id, "type");
        addItem(entries, entry.name, group.id, "name");
        continue;
      }
      entries[entry.id] = {
        english: String(entry.text ?? ""),
        groupId: group.id,
        options: Object.fromEntries(
          (entry.option?.options ?? []).map((option) => [
            String(option.id),
            String(option.text ?? ""),
          ]),
        ),
      };
    }
  }
  return { groups, entries };
}

export function canonicalizeOfficialData(
  raw,
  fetchedAt = new Date().toISOString(),
  source = `${OFFICIAL_EN_BASE_URL}/{items,stats,static,filters}`,
) {
  return {
    schemaVersion: 1,
    fetchedAt,
    source,
    sections: {
      items: normalizeGroups(raw.items, {
        groupField: "label",
        itemMode: true,
      }),
      stats: normalizeGroups(raw.stats, { groupField: "label" }),
      static: normalizeGroups(raw.static, { groupField: "label" }),
      filters: normalizeGroups(raw.filters, {
        groupField: "title",
        entryField: "filters",
      }),
    },
  };
}

export function groupsById(data) {
  return new Map((data?.result ?? []).map((group) => [group.id, group]));
}

export function entriesById(data, field = "entries") {
  const result = new Map();
  for (const group of data?.result ?? []) {
    for (const entry of group[field] ?? []) result.set(entry.id, entry);
  }
  return result;
}
