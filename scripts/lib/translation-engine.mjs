const normalize = (value) => String(value ?? "").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
const words = (value) => normalize(value).match(/[a-z]+(?:['’][a-z]+)?|\d+/g) ?? [];

function domainAllowed(rule, domain) {
  const domains = rule.domains ?? ["*"];
  return domains.includes("*") || domains.includes(domain);
}

export function validateTerminology(glossary, phraseExceptions) {
  if (glossary.schemaVersion !== 1 || !Array.isArray(glossary.terms)) {
    throw new Error("glossary.zh-TW.json 格式不兼容");
  }
  if (phraseExceptions.schemaVersion !== 1 || !Array.isArray(phraseExceptions.phrases)) {
    throw new Error("phrase-exceptions.zh-TW.json 格式不兼容");
  }
  for (const term of glossary.terms) {
    if (!term.en || !term.zhTW || !["reviewed", "proposed"].includes(term.status)) {
      throw new Error(`无效术语：${JSON.stringify(term)}`);
    }
  }
}

export function createCandidateEngine(glossary, phraseExceptions) {
  validateTerminology(glossary, phraseExceptions);
  const phrases = new Map(
    phraseExceptions.phrases.map((entry) => [normalize(entry.en), entry]),
  );
  const terms = glossary.terms
    .map((entry) => ({ ...entry, tokens: words(entry.en) }))
    .filter((entry) => entry.tokens.length)
    .sort((a, b) => b.tokens.length - a.tokens.length);

  return function suggest(english, domain) {
    const exact = phrases.get(normalize(english));
    if (exact && domainAllowed(exact, domain)) {
      return {
        text: exact.zhTW,
        confidence: exact.status === "reviewed" ? 1 : exact.confidence ?? 0.85,
        method: "phrase-exception",
        status: exact.status,
        evidence: [{ en: exact.en, zhTW: exact.zhTW, status: exact.status }],
      };
    }

    const sourceTokens = words(english);
    if (!sourceTokens.length) return null;
    const evidence = [];
    const output = [];
    let cursor = 0;
    while (cursor < sourceTokens.length) {
      const match = terms.find(
        (term) =>
          domainAllowed(term, domain) &&
          term.tokens.every((token, index) => sourceTokens[cursor + index] === token),
      );
      if (!match) return null;
      output.push(match.zhTW);
      evidence.push({
        en: match.en,
        zhTW: match.zhTW,
        status: match.status,
        confidence: match.confidence ?? (match.status === "reviewed" ? 1 : 0.8),
      });
      cursor += match.tokens.length;
    }

    const minimum = Math.min(...evidence.map((entry) => entry.confidence));
    const allReviewed = evidence.every((entry) => entry.status === "reviewed");
    return {
      text: output.join(""),
      confidence: Number((minimum * (allReviewed ? 0.98 : 0.9)).toFixed(3)),
      method: "glossary-composition",
      status: "needs-review",
      evidence,
    };
  };
}

export function countPlaceholders(value) {
  return (String(value ?? "").match(/#/g) ?? []).length;
}
