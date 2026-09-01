(() => {
  const API_SOURCE = "trade-api";
  const CATALOG_CACHE_SCHEMA = "translated-api-v1";
  const OFFICIAL_CATALOG_CACHE_KEYS = ["items", "stats", "data", "filters"];

  // The official page caches every translated /data/* response before Vue is
  // created. Invalidate only those four catalogs once when our response schema
  // changes; otherwise a selected option can be rebuilt from stale English data.
  try {
    const markerKey = "poe2zh-trade2-catalog-schema";
    if (localStorage.getItem(markerKey) !== CATALOG_CACHE_SCHEMA) {
      for (const key of OFFICIAL_CATALOG_CACHE_KEYS) {
        localStorage.removeItem(`lscache-trade2${key}`);
        localStorage.removeItem(`lscache-trade2${key}-cacheexpiration`);
      }
      localStorage.setItem(markerKey, CATALOG_CACHE_SCHEMA);
    }
  } catch (_) {
    // Storage can be unavailable in hardened contexts; interception still works
    // as soon as the official cache naturally expires.
  }

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
  let statIndexes = { version: null, englishById: null, renderer: null };
  let catalogAliases = {
    version: null,
    englishByAlias: new Map(),
    ambiguousAliases: new Set(),
  };

  function registerCatalogAlias(index, translated, english) {
    const source = String(english ?? "").trim();
    const target = String(translated ?? "").trim();
    if (!source || !target || source === target) return source;
    const alias = `${target} (${source})`;
    if (index.ambiguousAliases.has(alias)) return alias;
    const previous = index.englishByAlias.get(alias);
    if (previous && previous !== source) {
      index.englishByAlias.delete(alias);
      index.ambiguousAliases.add(alias);
      return alias;
    }
    index.englishByAlias.set(alias, source);
    return alias;
  }

  function catalogAliasIndex() {
    const version = config.dataset?.datasetVersion;
    if (catalogAliases.version !== version) {
      catalogAliases = {
        version,
        englishByAlias: new Map(),
        ambiguousAliases: new Set(),
      };
      // The official page may satisfy /data/items from its own cache, so a
      // request-restoration index cannot depend on observing that response in
      // the current page lifetime. Build it from the validated bundled data.
      for (const source of [
        config.dataset?.baseItems,
        config.dataset?.fixedNames,
        config.dataset?.items,
      ]) {
        for (const [english, translated] of Object.entries(source ?? {})) {
          registerCatalogAlias(catalogAliases, translated, english);
        }
      }
    }
    return catalogAliases;
  }

  function searchableCatalogAlias(translated, english) {
    const source = String(english ?? "").trim();
    const target = String(translated ?? "").trim();
    if (!source || !target || source === target) return source;
    return registerCatalogAlias(catalogAliasIndex(), target, source);
  }

  function restoreOfficialCatalogValue(value) {
    return typeof value === "string"
      ? catalogAliasIndex().englishByAlias.get(value) ?? value
      : value;
  }

  function restoreSearchRequest(request) {
    if (!request.url.includes("/api/trade2/search/") || typeof request.data !== "string") {
      return;
    }
    try {
      const body = JSON.parse(request.data);
      if (!body?.query || typeof body.query !== "object") return;
      if (Object.hasOwn(body.query, "name")) {
        body.query.name = restoreOfficialCatalogValue(body.query.name);
      }
      if (Object.hasOwn(body.query, "type")) {
        body.query.type = restoreOfficialCatalogValue(body.query.type);
      }
      request.data = JSON.stringify(body);
    } catch (_) {
      // Never block an official search when the site changes its request format.
    }
  }

  function statIndex() {
    const version = config.dataset?.datasetVersion;
    if (statIndexes.version !== version) {
      statIndexes = { version, englishById: new Map(), renderer: null };
    }
    statIndexes.englishById ??= new Map();
    return statIndexes;
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

  function statRenderer() {
    const index = statIndex();
    if (!index.renderer) {
      index.renderer = window.POE2ZHStatRendering?.create(config.dataset, index.englishById);
    }
    return index.renderer;
  }

  function matchingStatTemplates(original) {
    return statRenderer()?.matchingTemplates(original) ?? [];
  }

  function sameStatShape(template, original) {
    return statRenderer()?.sameShape(template, original) ?? false;
  }

  function matchingStatRenderings(statId, original) {
    return statRenderer()?.matchingRenderings(statId, original) ?? [];
  }

  function baseItemTranslation(english) {
    return config.dataset?.baseItems?.[english] || config.dataset?.items?.[english];
  }

  function fixedNameTranslation(english) {
    return config.dataset?.fixedNames?.[english] || config.dataset?.items?.[english];
  }

  function reportMissing(type, key, en, context = "", metadata = {}) {
    key = String(key ?? "").trim();
    en = clean(en).trim();
    if (!key || !en || !/[A-Za-z]/.test(en)) return;
    const id = `${type}:${key}`;
    if (reported.has(id)) return;
    reported.add(id);
    document.dispatchEvent(
      new CustomEvent("poe2zh:missing", {
        detail: {
          type,
          key,
          en,
          context,
          domain: String(metadata.domain ?? ""),
          reason: String(metadata.reason ?? ""),
          source: API_SOURCE,
          datasetVersion: config.dataset?.datasetVersion,
        },
      }),
    );
  }

  function format(translated, original) {
    const source = String(original ?? "").trim();
    if (!translated) return source;
    if (!source || translated === source) return translated;
    const rendered = config.mode === "bilingual"
      ? `${translated} (${source})`
      : translated;
    if (config.mode === "translated") {
      globalThis.POE2ZHHoverOriginals?.register(rendered, source);
    }
    return rendered;
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
          const originalName = String(entry.name ?? "").trim();
          const originalType = String(entry.type ?? "").trim();
          const originalText = String(entry.text ?? "").trim();
          const original = originalText || [originalName, originalType].filter(Boolean).join(" ");
          const name = fixedNameTranslation(originalName);
          const type = baseItemTranslation(originalType);
          const direct = !originalText
            ? null
            : originalText === originalType && !originalName
              ? type
              : originalText === originalName && !originalType
                ? name
                : fixedNameTranslation(original) || baseItemTranslation(original);
          const allPartsTranslated = (!originalName || name) && (!originalType || type);
          const translated = direct || (
            allPartsTranslated ? [name, type].filter(Boolean).join(" ") : null
          );
          if (translated) entry.text = format(translated, original);
          if (name) entry.name = searchableCatalogAlias(name, originalName);
          if (type) entry.type = searchableCatalogAlias(type, originalType);
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
    const grantedSkill = translateGrantedSkill(property, {
      type: "property",
      key: null,
      context: "item-skill",
    });
    if (grantedSkill?.handled) return;
    globalThis.POE2ZHItemPropertyRendering?.translate(property, {
      translations: config.dataset.itemPropertyIndex,
      fallbackTranslations: config.dataset.properties,
      type109: config.dataset.itemPropertyType109,
      format,
      onMissing: (english, detail) => reportMissing(
        "property",
        english,
        english,
        detail?.kind === "type-109" ? "item-property:type-109" : "item-property",
      ),
    });
  }

  function translateGrantedSkill(property, report) {
    return globalThis.POE2ZHGrantedSkillDomain?.translate(property, {
      domain: config.dataset.domains?.grantedSkill,
      skillNames: config.dataset.baseItems,
      format,
      onMissing: (english, detail) => reportMissing(
        report.type,
        report.key || detail?.skillEnglish || english,
        english,
        `${report.context}:${detail?.reason || "unresolved"}`,
        { domain: detail?.domain, reason: detail?.reason },
      ),
    });
  }

  function translateMods(item) {
    const hashes = item.extended?.hashes ?? {};
    const kinds = new Set(Object.keys(hashes));
    for (const [field, mods] of Object.entries(item)) {
      if (!field.endsWith("Mods") || !Array.isArray(mods)) continue;
      if (mods.some((mod) => typeof mod === "object" && /^stat\.[^.]+\.stat_\d+$/.test(mod?.hash ?? ""))) {
        kinds.add(field.slice(0, -"Mods".length));
      }
    }
    for (const kind of kinds) {
      const refs = hashes[kind] ?? [];
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
        const inlineStatId = typeof mod === "object" && /^stat\.[^.]+\.stat_\d+$/.test(mod?.hash ?? "")
          ? mod.hash.slice("stat.".length)
          : null;
        const inlineEntry = inlineStatId ? config.dataset.stats.entries[inlineStatId] : null;
        if (inlineStatId && !inlineEntry?.text) {
          reportMissing("stat", inlineStatId, original, `fetch:${kind}:inline-hash-unresolved`);
          return mod;
        }
        // Modern /fetch mod objects carry their own stable hash. That hash is
        // attached to this exact description and is authoritative. The numeric
        // arrays under extended.hashes are not positions in *Mods (the official
        // response can map explicitMods[2] to [4]), so only legacy string mods
        // may use the older association fallback below.
        const refsForIndex = inlineStatId
          ? [{ statId: inlineStatId, translated: inlineEntry.text }]
          : byIndex.get(index) ?? [];
        const renderingMatches = refsForIndex.flatMap(({ statId }) =>
          matchingStatRenderings(statId, original).map((rendering) => ({ statId, rendering })),
        );
        const matchingRefs = refsForIndex.filter(({ statId }) =>
          sameStatShape(statEnglish(statId), original),
        );
        const templateCandidates = matchingStatTemplates(original);
        let template =
          renderingMatches.length === 1 ? renderingMatches[0].rendering.text : null;
        if (!template && matchingRefs.length === 1) template = matchingRefs[0].translated;
        if (!template && templateCandidates.length === 1) {
          template = templateCandidates[0].translated;
        }
        if (!template && refsForIndex.length === 1 && !statEnglish(refsForIndex[0].statId)) {
          // Compatibility fallback for an older remote dataset without shipped English templates.
          template = refsForIndex[0].translated;
        }
        if (!template) {
          const statId = refsForIndex[0]?.statId ?? `unresolved:${kind}:${index}`;
          reportMissing("stat", statId, original, `fetch:${kind}:association-mismatch`);
          return mod;
        }
        const translated = replaceNumbers(template, original);
        const result = format(translated, original);
        return typeof mod === "object" ? { ...mod, description: result } : result;
      });
    }
  }

  function translateFetchItem(item) {
    const itemNameDomain = globalThis.POE2ZHItemNameDomain;
    if (!itemNameDomain) throw new Error("流亡譯鏡：item-name 領域未載入");
    const resolvedNames = itemNameDomain.resolve(item, config.dataset);
    for (const field of ["baseType", "typeLine", "name"]) {
      const result = resolvedNames[field];
      if (result?.status === "translated") {
        item[field] = format(result.text, result.original);
      }
    }
    for (const report of resolvedNames.reports) {
      reportMissing(
        report.type,
        report.key,
        report.en,
        report.context,
        { domain: report.domain, reason: report.reason },
      );
    }
    const properties = Array.isArray(item.properties) ? item.properties : [];
    const requirements = Array.isArray(item.requirements) ? item.requirements : [];
    const grantedSkills = Array.isArray(item.grantedSkills) ? item.grantedSkills : [];
    for (const property of properties) translateProperty(property);
    for (const requirement of requirements) translateProperty(requirement);
    for (const grantedSkill of grantedSkills) {
      translateGrantedSkill(grantedSkill, {
        type: "property",
        key: grantedSkill?.type || null,
        context: "item-granted-skill",
      });
    }
    translateMods(item);
    return item;
  }

  function translateFetchResponse(response) {
    if (!Array.isArray(response.result)) return response;
    for (const result of response.result) {
      if (!result?.item || typeof result.item !== "object") continue;
      const originalItem = result.item;
      try {
        // A malformed optional field on one listing must not cancel translation
        // for the entire /fetch batch. Work on a clone so a failed listing is
        // returned completely unchanged rather than partially translated.
        const translatedItem = JSON.parse(JSON.stringify(originalItem));
        result.item = translateFetchItem(translatedItem);
      } catch (error) {
        result.item = originalItem;
        console.warn("[POE2ZH] 单件物品翻译失败，已保留该件英文", error);
      }
    }
    return response;
  }

  function endpointKey(url) {
    const match = String(url).match(/\/api\/trade2\/data\/(stats|items|static|filters)(?:[?#]|$)/);
    return match?.[1] ?? null;
  }

  ajaxHooker.hook((request) => {
    if (!request.url.includes("/api/trade2/")) return;
    restoreSearchRequest(request);
    request.response = async (response) => {
      const key = endpointKey(request.url);
      if (!config.dataset) {
        if (key) {
          // The trade site caches these catalog responses for the lifetime of
          // the page. Letting an English response through during extension
          // startup permanently breaks Chinese search until the next reload.
          await ready;
        } else {
          await Promise.race([
            ready,
            new Promise((resolve) => setTimeout(resolve, 3_000)),
          ]);
        }
      }
      if (!config.enabled || !config.dataset || !response.responseText) return;
      try {
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
