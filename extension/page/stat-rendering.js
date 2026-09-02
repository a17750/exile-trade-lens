(() => {
  // Stat rendering is deliberately isolated from the API interceptor. This
  // module only matches verified templates and never invents grammar variants.
  function normalize(text) {
    return String(text ?? "")
      .replace(/\[([^|\]]+)\|([^\]]+)\]/g, "$2")
      .replace(/\[([^\]]+)\]/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  function escapeRegex(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function templateRegex(template) {
    const parts = normalize(template).split("#");
    const number = "[+-]?(?:\\d*\\.\\d+|\\d+)";
    return new RegExp(
      `^${parts.map((part) => escapeRegex(part).replace(/\\ /g, "\\\\s+")).join(number)}$`,
      "i",
    );
  }

  function bucketKey(value) {
    return normalize(value)
      .replace(/[+-]?(?:\d*\.\d+|\d+)|#/g, " ")
      .match(/[A-Za-z]{2,}/)?.[0]
      ?.toLocaleLowerCase("en-US") ?? "";
  }

  function create(dataset, englishById = new Map()) {
    let version = null;
    let templatesByBucket = new Map();

    function refresh() {
      const nextVersion = dataset?.datasetVersion;
      if (version === nextVersion) return;
      version = nextVersion;
      const statTexts = new Set(
        Object.values(dataset?.stats?.entries ?? {})
          .map((entry) => (typeof entry === "object" ? entry.text : entry))
          .filter(Boolean),
      );
      templatesByBucket = new Map();
      const seen = new Set();
      const register = (english, translated) => {
        const key = `${english}\u0000${translated}`;
        if (seen.has(key)) return;
        seen.add(key);
        const bucket = bucketKey(english);
        const candidates = templatesByBucket.get(bucket) ?? [];
        candidates.push({ english, translated, pattern: templateRegex(english) });
        templatesByBucket.set(bucket, candidates);
      };
      for (const [english, translated] of Object.entries(
        dataset?.domains?.statDescriptionExact?.entries ?? {},
      )) {
        if (!english || !translated || english === translated) continue;
        register(english, translated);
      }
      for (const [english, translated] of Object.entries(dataset?.exact ?? {})) {
        if (!english.includes("#") || !statTexts.has(translated)) continue;
        register(english, translated);
      }
    }

    function english(statId) {
      return englishById.get(statId) ?? dataset?.stats?.entries?.[statId]?.english ?? null;
    }

    function sameShape(template, original) {
      return Boolean(template && original && templateRegex(template).test(normalize(original)));
    }

    function matchingTemplates(original) {
      refresh();
      return (templatesByBucket.get(bucketKey(original)) ?? [])
        .filter((candidate) => candidate.pattern.test(normalize(original)));
    }

    function matchingRenderings(statId, original) {
      refresh();
      const renderings = dataset?.stats?.entries?.[statId]?.renderings ?? [];
      if (!Array.isArray(renderings)) return [];
      return renderings.filter(
        (rendering) => rendering?.text && sameShape(rendering.english, original),
      );
    }

    return { english, sameShape, matchingTemplates, matchingRenderings, bucketKey };
  }

  window.POE2ZHStatRendering = { create, normalize, templateRegex };
})();
