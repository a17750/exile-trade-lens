(() => {
  const DEFAULT_SETTINGS = {
    enabled: true,
    mode: "bilingual",
    autoUpdate: true,
    remoteManifestUrl:
      "https://raw.githubusercontent.com/a17750/exile-trade-lens/main/extension/data/remote-manifest.json",
  };
  let dataset = null;
  let settings = DEFAULT_SETTINGS;
  let observer = null;
  let exactTranslations = new Map();
  let knownRenderedTranslations = new Set();
  const translatedTextValues = new WeakMap();
  const translatedAttributeValues = new WeakMap();
  const pendingMissing = new Map();
  const reportedUiMissing = new Set();
  let missingTimer = null;
  const CONFIG_ELEMENT_ID = "poe2zh-shared-config";
  const TRANSLATABLE_ATTRIBUTES = ["placeholder", "title", "aria-label"];
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

  function queueMissing(event) {
    const report = event?.detail ?? event;
    const allowed = ["stat", "item", "static", "filter", "property", "ui"];
    if (!report || !allowed.includes(report.type)) return;
    const key = String(report.key ?? "").trim().slice(0, 300);
    const en = String(report.en ?? "").trim().slice(0, 800);
    if (!key || !en) return;
    pendingMissing.set(`${report.type}:${key}`, {
      type: report.type,
      key,
      en,
      context: String(report.context ?? "").slice(0, 200),
    });
    clearTimeout(missingTimer);
    missingTimer = setTimeout(flushMissing, 750);
  }

  function uiContext(element) {
    if (!element?.closest) return null;
    if (
      element.closest(
        "footer, .search-results, .resultset, .results, .listing, [class*='itemPopup'], [data-poe2zh-ignore]",
      )
    ) {
      return null;
    }
    if (element.closest("[role='option'], [role='listbox'], [class*='dropdown'], [class*='option']")) {
      return "dropdown-option";
    }
    if (element.closest("[class*='filter'], .search-advanced-pane, .search-panel")) {
      return "filter-panel";
    }
    if (element.closest("button")) return "button";
    if (element.closest("label, [role='combobox'], [class*='select']")) return "form-control";
    return null;
  }

  function reportUiMissing(raw, element) {
    const en = String(raw ?? "").replace(/\s+/g, " ").trim();
    const context = uiContext(element);
    const dynamicFragment =
      context === "dropdown-option" &&
      ((!/^[A-Za-z0-9]/.test(en) && /[A-Za-z]/.test(en)) ||
        (/\)$/.test(en) && !/\(/.test(en)) ||
        /\bundefined\b/i.test(en));
    if (
      !context ||
      en.length < 2 ||
      en.length > 160 ||
      !/[A-Za-z]/.test(en) ||
      /https?:\/\/|\S+@\S+/.test(en) ||
      element?.closest?.("input, textarea, [contenteditable='true']") ||
      dynamicFragment ||
      knownRenderedTranslations.has(en) ||
      (/[^\x00-\x7f]/.test(en) && /\([A-Za-z][^)]*\)/.test(en)) ||
      /\(\s*undefined\s*\)$/i.test(en) ||
      reportedUiMissing.has(en)
    ) {
      return;
    }
    reportedUiMissing.add(en);
    queueMissing({ type: "ui", key: en, en, context });
    document.documentElement.dataset.poe2zhUiMissing = String(reportedUiMissing.size);
  }

  async function flushMissing() {
    if (!pendingMissing.size) return;
    const reports = [...pendingMissing.values()];
    pendingMissing.clear();
    await chrome.runtime.sendMessage({ type: "POE2ZH_REPORT_MISSING", reports });
  }

  async function publish() {
    settings = {
      ...DEFAULT_SETTINGS,
      ...(await chrome.storage.sync.get(DEFAULT_SETTINGS)),
    };
    const response = await chrome.runtime.sendMessage({ type: "POE2ZH_GET_DATASET" });
    if (!response?.ok) throw new Error(response?.message || "词库加载失败");
    dataset = response.dataset;
    buildExactTranslations();
    publishSharedConfig();
    translateDocument();
  }

  function publishSharedConfig() {
    let node = document.getElementById(CONFIG_ELEMENT_ID);
    if (!node) {
      node = document.createElement("script");
      node.id = CONFIG_ELEMENT_ID;
      node.type = "application/json";
      node.hidden = true;
      (document.head || document.documentElement).append(node);
    }
    node.textContent = JSON.stringify({
      dataset,
      enabled: settings.enabled,
      mode: settings.mode,
    });
    document.dispatchEvent(new Event("poe2zh:configure"));
    document.documentElement.dataset.poe2zhBridge = "ready";
  }

  function buildExactTranslations() {
    exactTranslations = new Map();
    knownRenderedTranslations = new Set();
    const add = (source) => {
      for (const [original, translated] of Object.entries(source ?? {})) {
        if (original && typeof translated === "string" && translated) {
          exactTranslations.set(original, translated);
          knownRenderedTranslations.add(String(translated).replace(/\s+/g, " ").trim());
          knownRenderedTranslations.add(
            `${translated} (${original})`.replace(/\s+/g, " ").trim(),
          );
        }
      }
    };
    add(UI_FALLBACK_TRANSLATIONS);
    add(dataset?.ui);
    add(dataset?.items);
    add(dataset?.properties);
    add(dataset?.stats?.groups);
    add(dataset?.static?.groups);
    add(dataset?.static?.entries);
    add(dataset?.filters?.groups);
    add(dataset?.exact);
  }

  function formatExact(original, translated) {
    if (!translated || translated === original) return original;
    return settings.mode === "bilingual"
      ? `${translated} (${original})`
      : translated;
  }

  function translateTextNode(node) {
    if (!settings.enabled || !exactTranslations.size || !node.nodeValue?.trim()) return;
    if (translatedTextValues.get(node) === node.nodeValue) return;
    const original = node.nodeValue.trim();
    const translated = exactTranslations.get(original);
    if (!translated) {
      reportUiMissing(original, node.parentElement);
      return;
    }
    const replacement = formatExact(original, translated);
    node.nodeValue = node.nodeValue.replace(original, replacement);
    translatedTextValues.set(node, node.nodeValue);
  }

  function translateAttributes(element) {
    if (!settings.enabled || !exactTranslations.size || !element?.getAttribute) return;
    let translatedValues = translatedAttributeValues.get(element);
    if (!translatedValues) {
      translatedValues = new Map();
      translatedAttributeValues.set(element, translatedValues);
    }
    for (const attribute of TRANSLATABLE_ATTRIBUTES) {
      const original = element.getAttribute(attribute)?.trim();
      if (!original) continue;
      if (translatedValues.get(attribute) === original) continue;
      const translated = exactTranslations.get(original);
      if (translated) {
        const replacement = formatExact(original, translated);
        element.setAttribute(attribute, replacement);
        translatedValues.set(attribute, replacement);
      }
      else reportUiMissing(original, element);
    }
  }

  function translateRoot(root) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
    translateAttributes(root);
    if (root.closest?.("script, style, textarea, input, [contenteditable='true']")) return;
    for (const element of root.querySelectorAll?.("[placeholder], [title], [aria-label]") ?? []) {
      translateAttributes(element);
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) translateTextNode(node);
  }

  function translateDocument() {
    if (!document.body) return;
    translateRoot(document.body);
    if (!observer) {
      observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === "attributes") translateAttributes(mutation.target);
          if (mutation.type === "characterData") translateTextNode(mutation.target);
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
            else translateRoot(node);
          }
        }
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
        attributeFilter: TRANSLATABLE_ATTRIBUTES,
      });
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync") {
      location.reload();
    } else if (area === "local" && changes.localOverrides) {
      location.reload();
    } else if (area === "local" && changes.remoteDataset) {
      publish().catch(console.error);
    }
  });

  document.addEventListener("poe2zh:missing", queueMissing);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", translateDocument, { once: true });
  }
  publish().catch(console.error);
})();
