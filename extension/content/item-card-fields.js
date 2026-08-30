(() => {
  const RESULT_SELECTOR = ".resultset, [class*='itemPopup']";
  let config = { enabled: true, mode: "bilingual", fields: {} };
  const translatedNodes = new WeakMap();
  const reportedUnknownFields = new Set();

  function normalize(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function format(translated, english) {
    return config.mode === "bilingual" ? `${translated} (${english})` : translated;
  }

  function reportUnknownField(element, fieldId) {
    if (!element.closest?.(".itemPopupAdditional")) return;
    if (!/^[a-z0-9_.-]+$/i.test(fieldId)) return;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const english = normalize(node.nodeValue);
      if (!/^[A-Za-z][A-Za-z %'()/.+-]{0,119}$/.test(english)) continue;
      const reportKey = `${fieldId}\u0000${english}`;
      if (reportedUnknownFields.has(reportKey)) return;
      reportedUnknownFields.add(reportKey);
      document.dispatchEvent(new CustomEvent("poe2zh:missing", {
        detail: {
          type: "property",
          key: `data-field:${fieldId}`,
          en: english,
          context: "item-card:data-field",
          region: "result-card",
          source: "item-card-field",
        },
      }));
      return;
    }
  }

  function translateField(element) {
    if (!config.enabled || !element?.getAttribute || !element.closest?.(RESULT_SELECTOR)) return;
    const fieldId = element.getAttribute("data-field");
    const field = config.fields?.[fieldId];
    if (!field?.labels) {
      reportUnknownField(element, fieldId);
      return;
    }
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let matched = false;
    let node;
    while ((node = walker.nextNode())) {
      if (translatedNodes.get(node) === node.nodeValue) continue;
      const english = normalize(node.nodeValue);
      const record = field.labels[english];
      if (!record?.text) continue;
      matched = true;
      const replacement = format(record.text, english);
      node.nodeValue = node.nodeValue.replace(english, replacement);
      translatedNodes.set(node, node.nodeValue);
      if (config.mode === "translated") {
        globalThis.POE2ZHOriginalTooltip?.annotate(element, english);
      }
    }
    if (!matched) reportUnknownField(element, fieldId);
  }

  function translateRoot(root) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
    if (root.matches?.("[data-field]")) translateField(root);
    for (const element of root.querySelectorAll?.("[data-field]") ?? []) translateField(element);
  }

  function configure(next) {
    config = {
      enabled: next?.enabled !== false,
      mode: next?.mode === "translated" ? "translated" : "bilingual",
      fields: next?.fields ?? {},
    };
  }

  globalThis.POE2ZHItemCardFields = Object.freeze({ configure, translateRoot });
})();
