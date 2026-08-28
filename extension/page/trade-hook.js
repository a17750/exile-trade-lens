(() => {
  let config = { dataset: null, enabled: true, mode: "bilingual" };
  const CONFIG_ELEMENT_ID = "poe2zh-shared-config";
  let markReady;
  const ready = new Promise((resolve) => {
    markReady = resolve;
  });

  function readSharedConfig() {
    const node = document.getElementById(CONFIG_ELEMENT_ID);
    if (!node?.textContent) return false;
    try {
      const next = JSON.parse(node.textContent);
      if (!next?.dataset?.datasetVersion) return false;
      config = next;
      document.documentElement.dataset.poe2zhDataset = next.dataset.datasetVersion;
      markReady();
      return true;
    } catch (error) {
      console.warn("[POE2ZH] 读取共享词库失败", error);
      return false;
    }
  }

  document.addEventListener("poe2zh:configure", readSharedConfig);
  readSharedConfig();

  const clean = (text) => String(text ?? "").replace(/\[[^|\]]*\||[\][]/g, "");
  const reported = new Set();
  let componentIndexes = { version: null, words: null, withBaseItems: null };
  let statIndexes = { version: null, englishById: null, templates: null };

  function statIndex() {
    const version = config.dataset?.datasetVersion;
    if (statIndexes.version !== version) {
      statIndexes = { version, englishById: new Map(), templates: null };
    }
    statIndexes.englishById ??= new Map();
    return statIndexes;
  }

  function normalizeStatText(text) {
    return String(text ?? "")
      .replace(/\[([^|\]]+)\|([^\]]+)\]/g, "$2")
      .replace(/\[([^\]]+)\]/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  function escapeRegex(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function statTemplateRegex(template) {
    const parts = normalizeStatText(template).split("#");
    const number = "[+-]?(?:\\d*\\.\\d+|\\d+)";
    return new RegExp(
      `^${parts.map((part) => escapeRegex(part).replace(/\\ /g, "\\\\s+")).join(number)}$`,
      "i",
    );
  }

  function statTemplateIndex() {
    const index = statIndex();
    if (index.templates) return index.templates;
    const statTexts = new Set(
      Object.values(config.dataset?.stats?.entries ?? {})
        .map((entry) => (typeof entry === "object" ? entry.text : entry))
        .filter(Boolean),
    );
    index.templates = [];
    for (const [english, translated] of Object.entries(config.dataset?.exact ?? {})) {
      if (!english.includes("#") || !statTexts.has(translated)) continue;
      index.templates.push({ english, translated, pattern: statTemplateRegex(english) });
    }
    return index.templates;
  }

  function statEnglish(statId) {
    if (!statId) return null;
    const index = statIndex();
    return (
      index.englishById.get(statId) ??
      config.dataset?.stats?.entries?.[statId]?.english ??
      null
    );
  }

  function matchingStatTemplates(original) {
    const normalized = normalizeStatText(original);
    return statTemplateIndex().filter((candidate) => candidate.pattern.test(normalized));
  }

  function sameStatShape(template, original) {
    if (!template || !original) return false;
    return statTemplateRegex(template).test(normalizeStatText(original));
  }

  function baseItemTranslation(english) {
    return config.dataset?.baseItems?.[english] || config.dataset?.items?.[english];
  }

  function fixedNameTranslation(english) {
    return config.dataset?.fixedNames?.[english] || config.dataset?.items?.[english];
  }

  function componentIndex(includeBaseItems) {
    const version = config.dataset?.datasetVersion;
    if (componentIndexes.version !== version) {
      componentIndexes = { version, words: null, withBaseItems: null };
    }
    const cacheKey = includeBaseItems ? "withBaseItems" : "words";
    if (componentIndexes[cacheKey]) return componentIndexes[cacheKey];
    const source = includeBaseItems
      ? { ...(config.dataset?.baseItems ?? {}), ...(config.dataset?.wordComponents ?? {}) }
      : config.dataset?.wordComponents ?? {};
    const buckets = new Map();
    for (const [english, translated] of Object.entries(source)) {
      if (!english || !translated || english === translated) continue;
      const first = english[0];
      if (!buckets.has(first)) buckets.set(first, []);
      buckets.get(first).push([english, translated]);
    }
    for (const entries of buckets.values()) {
      entries.sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]));
    }
    componentIndexes[cacheKey] = buckets;
    return buckets;
  }

  function composeOfficialName(original, includeBaseItems = false) {
    original = String(original ?? "");
    if (!original) return null;
    const exact = includeBaseItems
      ? baseItemTranslation(original) || config.dataset?.fixedNames?.[original]
      : config.dataset?.fixedNames?.[original];
    if (exact) return exact;

    const buckets = componentIndex(includeBaseItems);
    const memo = new Map();
    function solve(offset) {
      if (offset === original.length) return { text: "", parts: 0 };
      if (memo.has(offset)) return memo.get(offset);
      let best = null;
      for (const [english, translated] of buckets.get(original[offset]) ?? []) {
        if (!original.startsWith(english, offset)) continue;
        const tail = solve(offset + english.length);
        if (!tail) continue;
        const candidate = { text: translated + tail.text, parts: tail.parts + 1 };
        if (!best || candidate.parts < best.parts) best = candidate;
      }
      memo.set(offset, best);
      return best;
    }
    return solve(0)?.text ?? null;
  }

  function reportMissing(type, key, en, context = "") {
    key = String(key ?? "").trim();
    en = clean(en).trim();
    if (!key || !en || !/[A-Za-z]/.test(en)) return;
    const id = `${type}:${key}`;
    if (reported.has(id)) return;
    reported.add(id);
    document.dispatchEvent(
      new CustomEvent("poe2zh:missing", {
        detail: { type, key, en, context, datasetVersion: config.dataset?.datasetVersion },
      }),
    );
  }

  function format(translated, original) {
    if (!translated || translated === original) return original;
    return config.mode === "bilingual"
      ? `${translated} (${original})`
      : translated;
  }

  function replaceNumbers(template, original) {
    const values = String(original).match(/[+-]?(?:\d*\.\d+|\d+)/g) ?? [];
    let index = 0;
    return String(template).replace(/#/g, () => values[index++] ?? "#");
  }

  function translateOption(option, options) {
    const translated = options?.[String(option.id)];
    if (translated) option.text = format(translated, option.text);
  }

  function translateDataResponse(response, key) {
    const data = config.dataset;
    if (!data || !Array.isArray(response.result)) return response;

    if (key === "stats") {
      for (const group of response.result) {
        group.label = format(data.stats.groups[group.id], group.label);
        for (const entry of group.entries ?? []) {
          statIndex().englishById.set(entry.id, entry.text);
          const translated = data.stats.entries[entry.id];
          if (!translated) {
            continue;
          }
          entry.text = format(translated.text, entry.text);
          for (const option of entry.option?.options ?? []) {
            translateOption(option, translated.options);
          }
        }
      }
    } else if (key === "items") {
      for (const group of response.result) {
        for (const entry of group.entries ?? []) {
          const original = entry.text;
          const name = fixedNameTranslation(entry.name);
          const type = baseItemTranslation(entry.type);
          const translated = [name, type].filter(Boolean).join(" ");
          if (translated) entry.text = format(translated, original);
        }
      }
    } else if (key === "static") {
      for (const group of response.result) {
        group.label = format(data.static.groups[group.id], group.label);
        for (const entry of group.entries ?? []) {
          const translated = data.static.entries[entry.id];
          entry.text = format(translated, entry.text);
        }
      }
    } else if (key === "filters") {
      for (const group of response.result) {
        group.title = format(data.filters.groups[group.id], group.title);
        for (const entry of group.filters ?? []) {
          const translated = data.filters.entries[entry.id];
          if (!translated) {
            continue;
          }
          entry.text = format(translated.text, entry.text);
          for (const option of entry.option?.options ?? []) {
            translateOption(option, translated.options);
          }
        }
      }
    }
    return response;
  }

  function translateProperty(property) {
    const plain = clean(property.name);
    const translated = config.dataset.properties[plain];
    if (translated) property.name = format(translated, property.name);
    else reportMissing("property", plain, plain, "item-property");
  }

  function translateMods(item) {
    const hashes = item.extended?.hashes;
    if (!hashes) return;
    for (const [kind, refs] of Object.entries(hashes)) {
      const mods = item[`${kind}Mods`];
      if (!Array.isArray(mods) || !Array.isArray(refs)) continue;
      const byIndex = new Map();
      for (const ref of refs) {
        const statId = ref?.[0];
        const indexes = ref?.[1];
        const translated = config.dataset.stats.entries[statId]?.text;
        if (!translated || !Array.isArray(indexes)) {
          const firstIndex = Array.isArray(indexes) ? indexes[0] : null;
          const sample = firstIndex == null ? "" : mods[firstIndex];
          reportMissing(
            "stat",
            statId,
            typeof sample === "object" ? sample?.description : sample,
            `fetch:${kind}`,
          );
          continue;
        }
        for (const index of indexes) {
          if (!byIndex.has(index)) byIndex.set(index, []);
          byIndex.get(index).push({ statId, translated });
        }
      }
      item[`${kind}Mods`] = mods.map((mod, index) => {
        const original = typeof mod === "object" ? mod.description : mod;
        if (!original) return mod;
        const refsForIndex = byIndex.get(index) ?? [];
        const matchingRefs = refsForIndex.filter(({ statId }) =>
          sameStatShape(statEnglish(statId), original),
        );
        const templateCandidates = matchingStatTemplates(original);
        let template = matchingRefs.length === 1 ? matchingRefs[0].translated : null;
        if (!template && templateCandidates.length === 1) {
          template = templateCandidates[0].translated;
        }
        if (!template && refsForIndex.length === 1 && !statEnglish(refsForIndex[0].statId)) {
          // Compatibility fallback for an older remote dataset without shipped English templates.
          template = refsForIndex[0].translated;
        }
        if (!template || !original) return mod;
        if (
          refsForIndex.length > 0 &&
          matchingRefs.length === 0 &&
          templateCandidates.length === 0
        ) {
          const statId = refsForIndex[0].statId;
          reportMissing("stat", statId, original, `fetch:${kind}:association-mismatch`);
          return mod;
        }
        const translated = replaceNumbers(template, original);
        const result = format(translated, original);
        return typeof mod === "object" ? { ...mod, description: result } : result;
      });
    }
  }

  function translateFetchResponse(response) {
    if (!Array.isArray(response.result)) return response;
    for (const result of response.result) {
      const item = result.item;
      if (!item) continue;
      const originalBaseType = item.baseType;
      const originalTypeLine = item.typeLine;
      const translatedBaseType = baseItemTranslation(originalBaseType);

      if (translatedBaseType) item.baseType = format(translatedBaseType, originalBaseType);
      else if (originalBaseType) {
        reportMissing("item", originalBaseType, originalBaseType, "fetch:baseType");
      }

      if (originalTypeLine) {
        const directTypeLine =
          config.dataset.baseItems?.[originalTypeLine] ||
          config.dataset.fixedNames?.[originalTypeLine] ||
          config.dataset.items?.[originalTypeLine];
        const composedTypeLine =
          item.frameType === 1 || item.frameType === 2
            ? composeOfficialName(originalTypeLine, true)
            : null;
        if (directTypeLine) {
          item.typeLine = format(directTypeLine, originalTypeLine);
        } else if (composedTypeLine) {
          item.typeLine = format(composedTypeLine, originalTypeLine);
        } else if (
          translatedBaseType &&
          originalBaseType &&
          originalTypeLine.includes(originalBaseType)
        ) {
          const composed = originalTypeLine.replace(originalBaseType, translatedBaseType);
          item.typeLine = format(composed, originalTypeLine);
        } else if (originalTypeLine === originalBaseType && !translatedBaseType) {
          reportMissing("item", originalTypeLine, originalTypeLine, "fetch:typeLine");
        }
      }

      if (item.name) {
        const translatedName =
          item.frameType === 1 || item.frameType === 2
            ? composeOfficialName(item.name)
            : fixedNameTranslation(item.name);
        if (translatedName) item.name = format(translatedName, item.name);
        else if (item.frameType === 3) {
          reportMissing("item", item.name, item.name, "fetch:name");
        }
      }
      for (const property of item.properties ?? []) translateProperty(property);
      for (const requirement of item.requirements ?? []) translateProperty(requirement);
      translateMods(item);
    }
    return response;
  }

  function endpointKey(url) {
    const match = String(url).match(/\/api\/trade2\/data\/(stats|items|static|filters)(?:[?#]|$)/);
    return match?.[1] ?? null;
  }

  ajaxHooker.hook((request) => {
    if (!request.url.includes("/api/trade2/")) return;
    request.response = async (response) => {
      if (!config.dataset) {
        await Promise.race([
          ready,
          new Promise((resolve) => setTimeout(resolve, 3_000)),
        ]);
      }
      if (!config.enabled || !config.dataset || !response.responseText) return;
      try {
        const key = endpointKey(request.url);
        if (key) {
          response.responseText = JSON.stringify(
            translateDataResponse(JSON.parse(response.responseText), key),
          );
          document.documentElement.dataset.poe2zhLastEndpoint = key;
        } else if (request.url.includes("/api/trade2/fetch")) {
          response.responseText = JSON.stringify(
            translateFetchResponse(JSON.parse(response.responseText)),
          );
          document.documentElement.dataset.poe2zhLastEndpoint = "fetch";
        }
      } catch (error) {
        console.warn("[POE2ZH] 翻译响应失败", error);
      }
    };
  });
  ajaxHooker.protect();
  document.documentElement.dataset.poe2zhHook = "ready";
})();
