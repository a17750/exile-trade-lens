(() => {
  const EXACT_LABELS = new Set(["Item Level", "Requires"]);
  const SUMMARY_LABELS = [
    "Base Percentile",
    "Armour",
    "Evasion",
    "Energy Shield",
    "Ward",
  ];
  const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const summaryPattern = new RegExp(
    `^(${SUMMARY_LABELS.map(escapeRegex).join("|")})\\s*:\\s*` +
      `(?:[+-]?(?:\\d[\\d,.]*|\\.\\d+)%?)?$`,
  );

  function match(raw) {
    const text = String(raw ?? "").trim();
    if (!text) return null;
    const exact = text.match(/^(.+?):?$/)?.[1];
    if (EXACT_LABELS.has(exact) && (text === exact || text === `${exact}:`)) {
      return { key: exact, kind: "exact" };
    }
    const summary = text.match(summaryPattern);
    return summary ? { key: summary[1], kind: "summary" } : null;
  }

  globalThis.POE2ZHResultLabelPolicy = Object.freeze({
    exactLabels: Object.freeze([...EXACT_LABELS]),
    summaryLabels: Object.freeze([...SUMMARY_LABELS]),
    match,
  });
})();
