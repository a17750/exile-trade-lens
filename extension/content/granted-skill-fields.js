(() => {
  const SELECTOR = "[data-field^='stat.skill.']";
  const RESULT_SELECTOR = ".resultset, [class*='itemPopup'], .item-popup";
  let config = { enabled: true, mode: "bilingual", domain: null, skillNames: {}, stats: {} };
  const translatedElements = new WeakSet();
  const reported = new Set();

  function normalize(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function reportMissing(element, fieldId, english, detail = {}) {
    const key = `${fieldId}\u0000${english}`;
    if (reported.has(key)) return;
    reported.add(key);
    document.dispatchEvent(new CustomEvent("poe2zh:missing", {
      detail: {
        type: "property",
        key: `data-field:${fieldId}`,
        en: english,
        context: `item-skill-dom:${detail.reason || "unresolved"}`,
        domain: detail.domain || "item-skill.granted",
        reason: detail.reason || "unresolved",
        region: "result-card",
        source: "item-granted-skill-field",
      },
    }));
  }

  function translateField(element) {
    if (
      !config.enabled ||
      translatedElements.has(element) ||
      !element.closest?.(RESULT_SELECTOR)
    ) return;
    const fieldId = element.getAttribute?.("data-field") || "";
    const statId = fieldId.slice("stat.".length);
    const stat = config.stats?.[statId];
    if (!stat?.english?.startsWith("Grants Skill:")) return;

    const original = normalize(element.textContent);
    if (!original.startsWith("Grants Skill:")) return;
    const holder = { name: original, values: [] };
    const result = globalThis.POE2ZHGrantedSkillDomain?.translate(holder, {
      domain: config.domain,
      skillNames: config.skillNames,
      format: (translated, english) =>
        config.mode === "bilingual" ? `${translated} (${english})` : translated,
      onMissing: (english, detail) => reportMissing(element, fieldId, english, detail),
    });
    if (!result?.handled || result.status !== "translated") return;

    const directSpans = [...element.children].filter((child) => child.tagName === "SPAN");
    const label = directSpans.find((child) => !child.classList.contains("keyword"));
    const value = directSpans.find((child) => child.classList.contains("keyword"));
    const separator = holder.name.indexOf(":");
    if (!label || !value || separator < 0) {
      reportMissing(element, fieldId, original, {
        domain: "item-skill.granted",
        reason: "dom-shape-drift",
      });
      return;
    }
    label.textContent = holder.name.slice(0, separator).trim();
    value.textContent = holder.name.slice(separator + 1).trim();
    translatedElements.add(element);
    if (config.mode === "translated") {
      globalThis.POE2ZHOriginalTooltip?.annotate(element, original);
    }
  }

  function translateRoot(root) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
    if (root.matches?.(SELECTOR)) translateField(root);
    for (const element of root.querySelectorAll?.(SELECTOR) ?? []) translateField(element);
  }

  function configure(next) {
    config = {
      enabled: next?.enabled !== false,
      mode: next?.mode === "translated" ? "translated" : "bilingual",
      domain: next?.domain ?? null,
      skillNames: next?.skillNames ?? {},
      stats: next?.stats ?? {},
    };
  }

  globalThis.POE2ZHGrantedSkillFields = Object.freeze({ configure, translateRoot });
})();
