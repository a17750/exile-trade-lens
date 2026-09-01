(() => {
  const policyLoaded = Boolean(globalThis.POE2ZHMissingReportPolicy);
  const missingPolicy = globalThis.POE2ZHMissingReportPolicy ?? {
    classifyReport: () => ({ allow: false, reason: "policy-not-loaded" }),
    createDomGuard: () => ({ consider() {}, dispose() {} }),
  };
  const resultLabelPolicy = globalThis.POE2ZHResultLabelPolicy ?? {
    match(raw) {
      const text = String(raw ?? "").trim();
      const key = text.replace(/:$/, "");
      return ["Item Level", "Requires"].includes(key)
        ? { key, kind: "exact" }
        : null;
    },
  };
  if (!policyLoaded) {
    document.documentElement?.setAttribute?.("data-poe2zh-policy", "missing");
    console.warn("流亡譯鏡：漏譯採集策略未載入，已停用漏譯採集但保留翻譯功能");
  }

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
  let domGuard = null;
  let exactTranslations = new Map();
  let exactConflicts = new Set();
  let knownRenderedTranslations = new Set();
  const hoverOriginals = new Map();
  const hoverConflicts = new Set();
  const translatedTextValues = new WeakMap();
  const translatedAttributeValues = new WeakMap();
  const pendingMissing = new Map();
  const reportedUiMissing = new Set();
  let missingTimer = null;
  let hoverScanTimer = null;
  let contextInvalidated = false;
  const CONFIG_ELEMENT_ID = "poe2zh-shared-config";
  const TRANSLATABLE_ATTRIBUTES = ["placeholder", "title", "aria-label"];
  const HOVER_MAP_ELEMENT_ID = "poe2zh-hover-originals";
  const HOVER_MAP_EVENT = "poe2zh:hover-originals";
  const RESULT_TEXT_SELECTORS = ".search-results, .resultset, .results, .listing, [class*='itemPopup']";
  function hasRuntimeContext() {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  }

  function isContextInvalidatedError(error) {
    return (
      !hasRuntimeContext() ||
      /Extension context invalidated/i.test(String(error?.message ?? error ?? ""))
    );
  }

  function stopInvalidatedBridge() {
    if (contextInvalidated) return;
    contextInvalidated = true;
    clearTimeout(missingTimer);
    clearTimeout(hoverScanTimer);
    missingTimer = null;
    hoverScanTimer = null;
    pendingMissing.clear();
    domGuard?.dispose();
    domGuard = null;
    observer?.disconnect();
    observer = null;
    document.removeEventListener("poe2zh:missing", queueMissing);
    document.documentElement.dataset.poe2zhBridge = "reload-required";
    console.info("流亡譯鏡：擴充功能已重新載入，請重新整理目前的交易頁。");
  }

  function handleContextInvalidation(error) {
    if (!isContextInvalidatedError(error)) return false;
    stopInvalidatedBridge();
    return true;
  }

  function runSafely(task, label) {
    Promise.resolve()
      .then(task)
      .catch((error) => {
        if (handleContextInvalidation(error)) return;
        console.error(`流亡譯鏡：${label}失敗`, error);
      });
  }

  async function sendRuntimeMessage(message) {
    if (!hasRuntimeContext()) {
      stopInvalidatedBridge();
      return null;
    }
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      if (handleContextInvalidation(error)) return null;
      throw error;
    }
  }

  function queueMissing(event) {
    if (contextInvalidated || !hasRuntimeContext()) {
      stopInvalidatedBridge();
      return;
    }
    const report = event?.detail ?? event;
    const allowed = ["stat", "item", "static", "filter", "property", "ui"];
    if (!report || !allowed.includes(report.type)) return;
    if (!missingPolicy.classifyReport(report).allow) return;
    const key = String(report.key ?? "").trim().slice(0, 300);
    const en = String(report.en ?? "").trim().slice(0, 800);
    if (!key || !en) return;
    pendingMissing.set(`${report.type}:${key}`, {
      type: report.type,
      key,
      en,
      context: String(report.context ?? "").slice(0, 200),
      region: String(report.region ?? "").slice(0, 80),
      source: String(report.source ?? "").slice(0, 80),
    });
    clearTimeout(missingTimer);
    missingTimer = setTimeout(() => runSafely(flushMissing, "漏譯上報"), 750);
  }

  function ensureDomGuard() {
    if (domGuard) return domGuard;
    domGuard = missingPolicy.createDomGuard({
      documentRef: document,
      isKnownRendered: (text) => knownRenderedTranslations.has(text),
      isAlreadyReported: (text) => reportedUiMissing.has(text),
      markReported(text) {
        reportedUiMissing.add(text);
        document.documentElement.dataset.poe2zhUiMissing = String(reportedUiMissing.size);
      },
      onAccept: queueMissing,
    });
    return domGuard;
  }

  function reportUiMissing(raw, element, readCurrent) {
    ensureDomGuard().consider(raw, element, readCurrent);
  }

  async function flushMissing() {
    missingTimer = null;
    if (contextInvalidated || !pendingMissing.size) return;
    const reports = [...pendingMissing.values()];
    pendingMissing.clear();
    try {
      await sendRuntimeMessage({ type: "POE2ZH_REPORT_MISSING", reports });
    } catch (error) {
      console.warn("流亡譯鏡：漏譯上報失敗", error);
    }
  }

  async function publish() {
    if (contextInvalidated) return;
    try {
      settings = {
        ...DEFAULT_SETTINGS,
        ...(await chrome.storage.sync.get(DEFAULT_SETTINGS)),
      };
      const response = await sendRuntimeMessage({ type: "POE2ZH_GET_DATASET" });
      if (contextInvalidated || !response) return;
      if (!response.ok) throw new Error(response.message || "词库加载失败");
      dataset = response.dataset;
      buildExactTranslations();
      globalThis.POE2ZHItemCardFields?.configure({
        enabled: settings.enabled,
        mode: settings.mode,
        fields: dataset?.itemFields?.dom,
      });
      globalThis.POE2ZHGrantedSkillFields?.configure({
        enabled: settings.enabled,
        mode: settings.mode,
        domain: dataset?.domains?.grantedSkill,
        skillNames: dataset?.baseItems,
        stats: dataset?.stats?.entries,
      });
      publishSharedConfig();
      translateDocument();
    } catch (error) {
      if (!handleContextInvalidation(error)) throw error;
    }
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
    exactConflicts = new Set();
    knownRenderedTranslations = new Set();
    const add = (source) => {
      for (const [original, translated] of Object.entries(source ?? {})) {
        if (original && typeof translated === "string" && translated) {
          if (exactConflicts.has(original)) continue;
          const previous = exactTranslations.get(original);
          if (previous && previous !== translated) {
            // A flat DOM node has no reliable domain information. If two
            // domains disagree, leaving it unchanged is safer than guessing.
            exactTranslations.delete(original);
            exactConflicts.add(original);
            continue;
          }
          exactTranslations.set(original, translated);
          knownRenderedTranslations.add(String(translated).replace(/\s+/g, " ").trim());
          knownRenderedTranslations.add(
            `${translated} (${original})`.replace(/\s+/g, " ").trim(),
          );
        }
      }
    };
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

  function normalizeVisibleText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function rememberHoverOriginal(rendered, original) {
    rendered = normalizeVisibleText(rendered);
    original = normalizeVisibleText(original);
    if (!rendered || !original || rendered === original || hoverConflicts.has(rendered)) return;
    const previous = hoverOriginals.get(rendered);
    if (previous && previous !== original) {
      hoverOriginals.delete(rendered);
      hoverConflicts.add(rendered);
      return;
    }
    hoverOriginals.set(rendered, original);
  }

  function hoverTarget(node) {
    const parent = node?.parentElement;
    if (!parent) return null;
    return parent.closest?.(
      "[data-field], .item-mod, .itemName, .item-popup__header-line, .multiselect__option, button, label",
    ) ?? parent;
  }

  function applyHoverOriginal(node, rendered = node?.nodeValue) {
    if (!settings.enabled || settings.mode !== "translated") return;
    const original = hoverOriginals.get(normalizeVisibleText(rendered));
    const target = original ? hoverTarget(node) : null;
    if (!target) return;
    globalThis.POE2ZHOriginalTooltip?.annotate(target, original);
  }

  function applyHoverOriginalsWithin(root) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) applyHoverOriginal(node);
  }

  function receiveHoverOriginals() {
    const node = document.getElementById(HOVER_MAP_ELEMENT_ID);
    if (!node?.textContent) return;
    try {
      const entries = JSON.parse(node.textContent);
      for (const [rendered, original] of Array.isArray(entries) ? entries : []) {
        rememberHoverOriginal(rendered, original);
      }
      clearTimeout(hoverScanTimer);
      hoverScanTimer = setTimeout(() => {
        hoverScanTimer = null;
        applyHoverOriginalsWithin(document.body);
      }, 0);
    } catch (error) {
      console.warn("流亡譯鏡：英文懸停映射無法讀取", error);
    }
  }

  function translateTextNode(node) {
    if (!settings.enabled || !exactTranslations.size || !node.nodeValue?.trim()) return;
    // Result cards are translated from /fetch using field-specific domains. Applying
    // the legacy flat exact map can attach an unrelated stat translation to a result
    // mod, so only the small, explicitly verified item-panel label allowlist may pass.
    if (translatedTextValues.get(node) === node.nodeValue) return;
    const original = node.nodeValue.trim();
    applyHoverOriginal(node, original);
    const inResult = node.parentElement?.closest?.(RESULT_TEXT_SELECTORS);
    const resultMatch = inResult ? resultLabelPolicy.match(original) : null;
    if (inResult && !resultMatch) return;
    const lookup = resultMatch?.key ?? original;
    const translated = resultMatch?.kind === "summary"
      ? dataset?.ui?.[lookup]
      : exactTranslations.get(lookup);
    if (!translated) {
      reportUiMissing(original, node.parentElement, () => node.nodeValue);
      return;
    }
    const replacement = formatExact(lookup, translated);
    node.nodeValue = node.nodeValue.replace(lookup, replacement);
    translatedTextValues.set(node, node.nodeValue);
    if (settings.mode === "translated") {
      rememberHoverOriginal(replacement, lookup);
      applyHoverOriginal(node, replacement);
    }
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
      else reportUiMissing(original, element, () => element.getAttribute(attribute));
    }
  }

  function translateRoot(root) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
    globalThis.POE2ZHGrantedSkillFields?.translateRoot(root);
    globalThis.POE2ZHItemCardFields?.translateRoot(root);
    translateAttributes(root);
    if (root.closest?.("script, style, textarea, input, [contenteditable='true']")) return;
    for (const element of root.querySelectorAll?.("[placeholder], [title], [aria-label]") ?? []) {
      translateAttributes(element);
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) translateTextNode(node);
    const ownText = root.childNodes?.length === 1 && root.firstChild?.nodeType === Node.TEXT_NODE
      ? root.firstChild
      : null;
    if (ownText) applyHoverOriginal(ownText);
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
      runSafely(publish, "詞庫更新");
    }
  });

  document.addEventListener("poe2zh:missing", queueMissing);
  document.addEventListener(HOVER_MAP_EVENT, receiveHoverOriginals);
  // Start listening for editable-control activity before the first DOM miss is seen.
  // Otherwise the first autocomplete mutation could arrive before the guard exists.
  ensureDomGuard();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", translateDocument, { once: true });
  }
  runSafely(publish, "初始化");
})();
