(() => {
  "use strict";

  const API_SOURCE = "trade-api";
  const DOM_SOURCE = "dom-static-ui";
  const INPUT_SOURCE = "dom-input-derived";
  const ITEM_CARD_SOURCE = "item-card-field";
  const DOM_REGIONS = new Set([
    "button",
    "filter-panel",
    "form-control",
    "dropdown-option",
  ]);
  const EDITABLE_SELECTOR =
    "input:not([type='button']):not([type='checkbox']):not([type='radio']):not([type='submit']), " +
    "textarea, [contenteditable='true'], [role='textbox'], [aria-autocomplete]";
  const RESULT_OR_IGNORED_SELECTOR =
    "footer, .search-results, .resultset, .results, .listing, " +
    "[class*='itemPopup'], [data-poe2zh-ignore]";
  const DROPDOWN_SELECTOR =
    "[role='option'], [role='listbox'], [class*='dropdown'], [class*='option']";
  const INPUT_COMPONENT_SELECTOR =
    "[role='combobox'], [class*='autocomplete'], [class*='typeahead'], " +
    "[class*='suggest']";

  function normalizeText(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim();
  }

  function isEditable(element) {
    return Boolean(element?.matches?.(EDITABLE_SELECTOR));
  }

  function uiRegion(element) {
    if (!element?.closest || element.closest(RESULT_OR_IGNORED_SELECTOR)) return null;
    if (element.closest(DROPDOWN_SELECTOR)) return "dropdown-option";
    if (element.closest("[class*='filter'], .search-advanced-pane, .search-panel")) {
      return "filter-panel";
    }
    if (element.closest("button")) return "button";
    if (element.closest("label, [role='combobox'], [class*='select']")) {
      return "form-control";
    }
    return null;
  }

  function controlledByEditable(element, documentRef) {
    const listbox = element?.closest?.("[role='listbox'], [id]");
    const id = listbox?.id;
    if (!id || !documentRef?.querySelectorAll) return false;
    for (const controller of documentRef.querySelectorAll("[aria-controls], [aria-owns]")) {
      const controls = `${controller.getAttribute?.("aria-controls") ?? ""} ${
        controller.getAttribute?.("aria-owns") ?? ""
      }`.trim().split(/\s+/);
      if (controls.includes(id) && (isEditable(controller) || controller.querySelector?.(EDITABLE_SELECTOR))) {
        return true;
      }
    }
    return false;
  }

  function belongsToEditableComponent(element) {
    if (!element?.closest) return false;
    if (element.closest(EDITABLE_SELECTOR)) return true;
    const component = element.closest(INPUT_COMPONENT_SELECTOR);
    return Boolean(component?.querySelector?.(EDITABLE_SELECTOR));
  }

  function isInputDerived({
    element,
    documentRef,
    activeEditable,
    lastEditableAt = 0,
    now = Date.now(),
    recentInputMs = 2_500,
    region = uiRegion(element),
  }) {
    if (belongsToEditableComponent(element) || controlledByEditable(element, documentRef)) {
      return true;
    }
    const recent = activeEditable && now - lastEditableAt <= recentInputMs;
    if (!recent) return false;
    if (region === "dropdown-option") return true;

    const candidateRoot = element?.closest?.(INPUT_COMPONENT_SELECTOR);
    const editableRoot = activeEditable?.closest?.(INPUT_COMPONENT_SELECTOR);
    return Boolean(candidateRoot && editableRoot && candidateRoot === editableRoot);
  }

  function classifyDomCandidate({
    raw,
    element,
    documentRef,
    activeEditable,
    lastEditableAt,
    now,
    knownRendered = false,
    alreadyReported = false,
  }) {
    const text = normalizeText(raw);
    const region = uiRegion(element);
    if (!region) return { allow: false, reason: "outside-static-ui" };
    if (
      isInputDerived({ element, documentRef, activeEditable, lastEditableAt, now, region })
    ) {
      return { allow: false, reason: "input-derived", source: INPUT_SOURCE, region, text };
    }
    if (text.length < 2 || text.length > 160 || !/[A-Za-z]/.test(text)) {
      return { allow: false, reason: "not-reviewable-ui", region, text };
    }
    if (/https?:\/\/|\S+@\S+/.test(text)) {
      return { allow: false, reason: "external-or-private", region, text };
    }
    if (
      /\bundefined\b/i.test(text) ||
      (/[^A-Za-z0-9]/.test(text[0] ?? "") && region === "dropdown-option") ||
      (/\)$/.test(text) && !/\(/.test(text))
    ) {
      return { allow: false, reason: "transient-fragment", region, text };
    }
    if (
      knownRendered ||
      alreadyReported ||
      (/[^\x00-\x7f]/.test(text) && /\([A-Za-z][^)]*\)/.test(text))
    ) {
      return { allow: false, reason: "known-or-bilingual", region, text };
    }
    return { allow: true, source: DOM_SOURCE, region, text };
  }

  function classifyReport(report) {
    const source = String(report?.source ?? "");
    const region = String(report?.region ?? report?.context ?? "");
    if (source === API_SOURCE && report?.type !== "ui") return { allow: true };
    if (source === INPUT_SOURCE) return { allow: false, reason: "input-derived" };
    if (
      source === ITEM_CARD_SOURCE &&
      report?.type === "property" &&
      region === "result-card" &&
      /^data-field:[a-z0-9_.-]+$/i.test(String(report?.key ?? "")) &&
      /^[A-Za-z][A-Za-z %'()/.+-]{0,119}$/.test(normalizeText(report?.en))
    ) {
      return { allow: true };
    }
    if (source === DOM_SOURCE && report?.type === "ui" && DOM_REGIONS.has(region)) {
      return { allow: true };
    }
    return { allow: false, reason: "untrusted-report-source" };
  }

  function shouldDiscardStoredReport(report) {
    if (report?.source === INPUT_SOURCE) return true;
    return report?.type === "ui" && report?.context === "dropdown-option" && !report?.source;
  }

  function createDomGuard({
    documentRef,
    onAccept,
    isKnownRendered = () => false,
    isAlreadyReported = () => false,
    markReported = () => {},
    delayMs = 1_200,
    now = () => Date.now(),
  }) {
    let activeEditable = null;
    let lastEditableAt = 0;
    const pending = new WeakMap();
    const timers = new Set();

    const noteEditableActivity = (event) => {
      if (!isEditable(event?.target)) return;
      activeEditable = event.target;
      lastEditableAt = now();
      // A typing event invalidates every pending DOM observation. Static UI can
      // be reconsidered after it settles; transient input renderings must not win a race.
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
    for (const type of ["beforeinput", "input", "compositionstart", "compositionupdate"]) {
      documentRef?.addEventListener?.(type, noteEditableActivity, true);
    }

    function consider(raw, element, readCurrent = () => raw) {
      const first = classifyDomCandidate({
        raw,
        element,
        documentRef,
        activeEditable,
        lastEditableAt,
        now: now(),
        knownRendered: isKnownRendered(normalizeText(raw)),
        alreadyReported: isAlreadyReported(normalizeText(raw)),
      });
      if (!first.allow || !element) return first;

      const previous = pending.get(element);
      if (previous) {
        clearTimeout(previous.timer);
        timers.delete(previous.timer);
      }
      const expected = first.text;
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (pending.get(element)?.timer !== timer) return;
        pending.delete(element);
        if (element.isConnected === false || normalizeText(readCurrent()) !== expected) return;
        const final = classifyDomCandidate({
          raw: expected,
          element,
          documentRef,
          activeEditable,
          lastEditableAt,
          now: now(),
          knownRendered: isKnownRendered(expected),
          alreadyReported: isAlreadyReported(expected),
        });
        if (!final.allow) return;
        markReported(expected);
        onAccept({
          type: "ui",
          key: expected,
          en: expected,
          context: final.region,
          region: final.region,
          source: final.source,
        });
      }, delayMs);
      timers.add(timer);
      pending.set(element, { timer, expected });
      return { ...first, pending: true };
    }

    function dispose() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const type of ["beforeinput", "input", "compositionstart", "compositionupdate"]) {
        documentRef?.removeEventListener?.(type, noteEditableActivity, true);
      }
    }

    return Object.freeze({ consider, dispose, noteEditableActivity });
  }

  globalThis.POE2ZHMissingReportPolicy = Object.freeze({
    API_SOURCE,
    DOM_SOURCE,
    INPUT_SOURCE,
    ITEM_CARD_SOURCE,
    normalizeText,
    classifyDomCandidate,
    classifyReport,
    shouldDiscardStoredReport,
    createDomGuard,
  });
})();
