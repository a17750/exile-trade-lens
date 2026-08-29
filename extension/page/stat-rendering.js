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

  function create(dataset, englishById = new Map()) {
    let version = null;
    let templates = [];

    function refresh() {
      const nextVersion = dataset?.datasetVersion;
      if (version === nextVersion) return;
      version = nextVersion;
      const statTexts = new Set(
        Object.values(dataset?.stats?.entries ?? {})
          .map((entry) => (typeof entry === "object" ? entry.text : entry))
          .filter(Boolean),
      );
      templates = [];
      for (const [english, translated] of Object.entries(dataset?.exact ?? {})) {
        if (!english.includes("#") || !statTexts.has(translated)) continue;
        templates.push({ english, translated, pattern: templateRegex(english) });
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
      return templates.filter((candidate) => candidate.pattern.test(normalize(original)));
    }

    function matchingRenderings(statId, original) {
      refresh();
      const renderings = dataset?.stats?.entries?.[statId]?.renderings ?? [];
      if (!Array.isArray(renderings)) return [];
      return renderings.filter(
        (rendering) => rendering?.text && sameShape(rendering.english, original),
      );
    }

    return { english, sameShape, matchingTemplates, matchingRenderings };
  }

  window.POE2ZHStatRendering = { create, normalize, templateRegex };
})();
