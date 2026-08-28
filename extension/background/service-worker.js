const ALARM_NAME = "poe2zh-data-update";
const MAX_MISSING_RECORDS = 2_000;
const ALLOWED_MISSING_TYPES = new Set(["stat", "item", "static", "filter", "property", "ui"]);
const DEFAULT_SETTINGS = {
  enabled: true,
  mode: "bilingual",
  autoUpdate: true,
  remoteManifestUrl:
    "https://raw.githubusercontent.com/a17750/exile-trade-lens/main/extension/data/remote-manifest.json",
};

async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(await chrome.storage.sync.get(DEFAULT_SETTINGS)) };
}

async function loadBundledDataset() {
  const response = await fetch(chrome.runtime.getURL("data/bundled.json"));
  if (!response.ok) throw new Error(`内置词库读取失败：${response.status}`);
  return response.json();
}

function mergeDatasets(base, extra) {
  if (!extra) return base;
  base.datasetVersion = extra.datasetVersion || base.datasetVersion;
  base.generatedAt = extra.generatedAt || base.generatedAt;
  base.items = { ...base.items, ...extra.items };
  base.baseItems = { ...base.baseItems, ...extra.baseItems };
  base.fixedNames = { ...base.fixedNames, ...extra.fixedNames };
  base.wordComponents = { ...base.wordComponents, ...extra.wordComponents };
  base.properties = { ...base.properties, ...extra.properties };
  base.allocates = { ...base.allocates, ...extra.allocates };
  base.ui = { ...base.ui, ...extra.ui };
  base.exact = { ...base.exact, ...extra.exact };
  for (const section of ["stats", "static", "filters"]) {
    base[section] ??= { groups: {}, entries: {} };
    base[section].groups = { ...base[section].groups, ...extra[section]?.groups };
    base[section].entries = { ...base[section].entries, ...extra[section]?.entries };
  }
  return base;
}

function overrideText(value) {
  return typeof value === "string" ? value : value?.text;
}

function applyLocalOverrides(dataset, overrides = {}) {
  for (const [key, value] of Object.entries(overrides.item ?? {})) {
    const text = overrideText(value);
    if (text) dataset.items[key] = text;
  }
  for (const [key, value] of Object.entries(overrides.property ?? {})) {
    const text = overrideText(value);
    if (text) dataset.properties[key] = text;
  }
  for (const [key, value] of Object.entries(overrides.ui ?? {})) {
    const text = overrideText(value);
    if (text) {
      dataset.ui[key] = text;
      dataset.exact[key] = text;
    }
  }
  for (const [key, value] of Object.entries(overrides.stat ?? {})) {
    const text = overrideText(value);
    if (text) {
      dataset.stats.entries[key] = { ...(dataset.stats.entries[key] ?? {}), text };
    }
  }
  for (const [key, value] of Object.entries(overrides.static ?? {})) {
    const text = overrideText(value);
    if (text) dataset.static.entries[key] = text;
  }
  for (const [key, value] of Object.entries(overrides.filter ?? {})) {
    const text = overrideText(value);
    if (text) {
      dataset.filters.entries[key] = { ...(dataset.filters.entries[key] ?? {}), text };
    }
  }
  return dataset;
}

async function getDataset() {
  const bundled = await loadBundledDataset();
  const { remoteDataset, localOverrides } = await chrome.storage.local.get([
    "remoteDataset",
    "localOverrides",
  ]);
  return applyLocalOverrides(mergeDatasets(bundled, remoteDataset), localOverrides);
}

function assertManifestUrl(url) {
  const parsed = new URL(url);
  const allowed =
    parsed.protocol === "https:" &&
    ["raw.githubusercontent.com", "cdn.jsdelivr.net"].includes(parsed.hostname);
  if (!allowed) throw new Error("更新地址仅允许 GitHub Raw 或 jsDelivr HTTPS 地址");
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function validateDataset(dataset) {
  if (
    !dataset ||
    dataset.schemaVersion !== 1 ||
    !dataset.datasetVersion ||
    !dataset.items ||
    !dataset.stats?.entries
  ) {
    throw new Error("远程词库格式不兼容");
  }
}

function normalizeUiText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

const UI_FALLBACK_TRANSLATIONS = {
  "Clear Filter Group": "清除篩選群組",
  Count: "數量",
  "Activate Live Search": "啟用即時搜尋",
  "Back to Top": "返回頂部",
  And: "且",
  If: "如果",
  Not: "非",
  "Select option": "選擇選項",
  "Searching...": "搜尋中……",
  "Stat Filters": "屬性篩選",
  "Stat Groups": "屬性群組",
  "Weighted Sum": "加權總和",
  "Custom Search": "自訂搜尋",
};

function knownRenderedUiTexts(dataset) {
  const values = new Set();
  for (const [english, translated] of Object.entries(dataset.exact ?? {})) {
    if (typeof translated !== "string" || !translated) continue;
    values.add(normalizeUiText(translated));
    values.add(normalizeUiText(`${translated} (${english})`));
  }
  return values;
}

function isBilingualUiArtifact(record) {
  if (record?.type !== "ui") return false;
  const key = normalizeUiText(record.key);
  return /[^\x00-\x7f]/.test(key) &&
    (/\([A-Za-z][^)]*\)/.test(key) || /\(\s*undefined\s*\)$/i.test(key));
}

function lookupTranslation(dataset, type, key, renderedUiTexts = null) {
  if (type === "stat") return dataset.stats?.entries?.[key]?.text;
  if (type === "item") {
    return dataset.baseItems?.[key] || dataset.fixedNames?.[key] || dataset.items?.[key];
  }
  if (type === "static") return dataset.static?.entries?.[key];
  if (type === "filter") return dataset.filters?.entries?.[key]?.text;
  if (type === "property") return dataset.properties?.[key];
  if (type === "ui") {
    return (
      dataset.exact?.[key] ||
      dataset.ui?.[key] ||
      UI_FALLBACK_TRANSLATIONS[key] ||
      renderedUiTexts?.has(normalizeUiText(key))
    );
  }
  return null;
}

async function updateBadge(records) {
  if (!records) {
    ({ missingRecords: records = {} } = await chrome.storage.local.get("missingRecords"));
  }
  const count = Object.values(records).filter((record) => !record.ignored).length;
  await chrome.action.setBadgeBackgroundColor({ color: count ? "#b7791f" : "#39734a" });
  await chrome.action.setBadgeText({ text: count ? (count > 999 ? "999+" : String(count)) : "" });
  await chrome.action.setTitle({
    title: count ? `流亡译镜：${count} 条待处理漏译` : "流亡译镜 — PoE2 市集中文助手",
  });
}

function sanitizeReport(report) {
  const type = String(report?.type ?? "");
  const key = String(report?.key ?? "").trim().slice(0, 300);
  const en = String(report?.en ?? "").trim().slice(0, 800);
  const context = String(report?.context ?? "").trim().slice(0, 200);
  if (!ALLOWED_MISSING_TYPES.has(type) || !key || !en) return null;
  return { type, key, en, context };
}

async function recordMissing(reports) {
  const { missingRecords = {} } = await chrome.storage.local.get("missingRecords");
  const now = new Date().toISOString();
  const dataset = await getDataset();
  const renderedUiTexts = knownRenderedUiTexts(dataset);
  for (const raw of Array.isArray(reports) ? reports : [reports]) {
    const report = sanitizeReport(raw);
    if (!report || lookupTranslation(dataset, report.type, report.key, renderedUiTexts)) continue;
    const id = `${report.type}:${report.key}`;
    const previous = missingRecords[id];
    missingRecords[id] = {
      ...report,
      id,
      firstSeen: previous?.firstSeen ?? now,
      lastSeen: now,
      seenCount: (previous?.seenCount ?? 0) + 1,
      ignored: previous?.ignored ?? false,
      datasetVersion: dataset.datasetVersion,
    };
  }
  const entries = Object.entries(missingRecords);
  if (entries.length > MAX_MISSING_RECORDS) {
    entries
      .sort(([, a], [, b]) => String(b.lastSeen).localeCompare(String(a.lastSeen)))
      .slice(MAX_MISSING_RECORDS)
      .forEach(([id]) => delete missingRecords[id]);
  }
  await chrome.storage.local.set({ missingRecords });
  await updateBadge(missingRecords);
  return { ok: true, count: Object.keys(missingRecords).length };
}

async function reconcileMissing() {
  const { missingRecords = {} } = await chrome.storage.local.get("missingRecords");
  const dataset = await getDataset();
  const renderedUiTexts = knownRenderedUiTexts(dataset);
  let resolved = 0;
  for (const [id, record] of Object.entries(missingRecords)) {
    const catalogOnly =
      ["stat", "item", "static", "filter"].includes(record.type) &&
      !String(record.context ?? "").startsWith("fetch:");
    if (catalogOnly || isBilingualUiArtifact(record) || lookupTranslation(dataset, record.type, record.key, renderedUiTexts)) {
      delete missingRecords[id];
      resolved += 1;
    }
  }
  await chrome.storage.local.set({ missingRecords });
  await updateBadge(missingRecords);
  return resolved;
}

function countToken(text, token) {
  return String(text).split(token).length - 1;
}

function validateManualTranslation(en, translation) {
  if (!translation.trim()) return "译文不能为空";
  if (countToken(en, "#") !== countToken(translation, "#")) {
    return "译文中的 # 数值占位符数量与英文不一致";
  }
  if (translation.length > 1_000) return "译文过长";
  return null;
}

async function saveOverride(payload) {
  const report = sanitizeReport(payload);
  const translation = String(payload?.translation ?? "").trim();
  if (!report) return { ok: false, message: "修正项目格式不正确" };
  const error = validateManualTranslation(report.en, translation);
  if (error) return { ok: false, message: error };

  const { localOverrides = {}, missingRecords = {} } = await chrome.storage.local.get([
    "localOverrides",
    "missingRecords",
  ]);
  localOverrides[report.type] ??= {};
  localOverrides[report.type][report.key] = {
    text: translation,
    source: "manual",
    reviewed: true,
    updatedAt: new Date().toISOString(),
  };
  delete missingRecords[`${report.type}:${report.key}`];
  await chrome.storage.local.set({ localOverrides, missingRecords });
  await updateBadge(missingRecords);
  return { ok: true, message: "修正已保存，打开的交易站页面会自动刷新" };
}

async function setMissingIgnored(id, ignored) {
  const { missingRecords = {} } = await chrome.storage.local.get("missingRecords");
  if (missingRecords[id]) missingRecords[id].ignored = Boolean(ignored);
  await chrome.storage.local.set({ missingRecords });
  await updateBadge(missingRecords);
  return { ok: true };
}

async function deleteMissing(id) {
  const { missingRecords = {} } = await chrome.storage.local.get("missingRecords");
  delete missingRecords[id];
  await chrome.storage.local.set({ missingRecords });
  await updateBadge(missingRecords);
  return { ok: true };
}

async function getHealth() {
  const { missingRecords = {}, localOverrides = {}, updateStatus = null } =
    await chrome.storage.local.get(["missingRecords", "localOverrides", "updateStatus"]);
  const records = Object.values(missingRecords).sort((a, b) =>
    String(b.lastSeen).localeCompare(String(a.lastSeen)),
  );
  const overrideCount = Object.values(localOverrides).reduce(
    (sum, group) => sum + Object.keys(group ?? {}).length,
    0,
  );
  return { ok: true, records, overrideCount, updateStatus };
}

async function checkForUpdates(force = false) {
  const settings = await getSettings();
  if (!settings.remoteManifestUrl) {
    const result = {
      ok: false,
      skipped: true,
      message: "尚未配置远程词库地址",
      checkedAt: new Date().toISOString(),
    };
    await chrome.storage.local.set({ updateStatus: result });
    return result;
  }
  if (!force && !settings.autoUpdate) {
    return { ok: false, skipped: true, message: "自动更新已关闭" };
  }

  try {
    assertManifestUrl(settings.remoteManifestUrl);
    const manifestResponse = await fetch(settings.remoteManifestUrl, { cache: "no-store" });
    if (!manifestResponse.ok) throw new Error(`更新清单请求失败：${manifestResponse.status}`);
    const manifest = await manifestResponse.json();
    if (manifest.schemaVersion !== 1 || !manifest.dataUrl || !manifest.sha256) {
      throw new Error("更新清单格式不正确");
    }
    assertManifestUrl(manifest.dataUrl);
    const { remoteDatasetVersion } = await chrome.storage.local.get("remoteDatasetVersion");
    if (!force && remoteDatasetVersion === manifest.datasetVersion) {
      const result = {
        ok: true,
        updated: false,
        message: "已经是最新词库",
        checkedAt: new Date().toISOString(),
      };
      await chrome.storage.local.set({ updateStatus: result });
      return result;
    }

    const dataResponse = await fetch(manifest.dataUrl, { cache: "no-store" });
    if (!dataResponse.ok) throw new Error(`词库下载失败：${dataResponse.status}`);
    const raw = await dataResponse.text();
    if ((await sha256Hex(raw)) !== manifest.sha256.toLowerCase()) {
      throw new Error("词库 SHA-256 校验失败");
    }
    const dataset = JSON.parse(raw);
    validateDataset(dataset);
    await chrome.storage.local.set({
      remoteDataset: dataset,
      remoteDatasetVersion: dataset.datasetVersion,
    });
    const resolved = await reconcileMissing();
    const result = {
      ok: true,
      updated: true,
      message: `已更新到 ${dataset.datasetVersion}，自动解决 ${resolved} 条漏译`,
      checkedAt: new Date().toISOString(),
    };
    await chrome.storage.local.set({ updateStatus: result });
    return result;
  } catch (error) {
    const result = {
      ok: false,
      updated: false,
      message: error instanceof Error ? error.message : String(error),
      checkedAt: new Date().toISOString(),
    };
    await chrome.storage.local.set({ updateStatus: result });
    return result;
  }
}

async function ensureAlarm() {
  const alarm = await chrome.alarms.get(ALARM_NAME);
  if (!alarm) await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 12 * 60 });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  updateBadge();
  checkForUpdates();
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  updateBadge();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) checkForUpdates();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  let operation;
  if (message?.type === "POE2ZH_GET_DATASET") {
    operation = getDataset().then((dataset) => ({ ok: true, dataset }));
  } else if (message?.type === "POE2ZH_CHECK_UPDATE") {
    operation = checkForUpdates(true);
  } else if (message?.type === "POE2ZH_REPORT_MISSING") {
    operation = recordMissing(message.reports);
  } else if (message?.type === "POE2ZH_GET_HEALTH") {
    operation = reconcileMissing().then(getHealth);
  } else if (message?.type === "POE2ZH_SAVE_OVERRIDE") {
    operation = saveOverride(message.payload);
  } else if (message?.type === "POE2ZH_IGNORE_MISSING") {
    operation = setMissingIgnored(message.id, message.ignored);
  } else if (message?.type === "POE2ZH_DELETE_MISSING") {
    operation = deleteMissing(message.id);
  } else if (message?.type === "POE2ZH_CLEAR_MISSING") {
    operation = chrome.storage.local.set({ missingRecords: {} }).then(async () => {
      await updateBadge({});
      return { ok: true };
    });
  } else {
    return false;
  }

  operation
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, message: String(error) }));
  return true;
});

ensureAlarm();
updateBadge();
