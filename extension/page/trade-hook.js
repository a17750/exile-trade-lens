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
          const name = data.items[entry.name];
          const type = data.items[entry.type];
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
        for (const index of indexes) byIndex.set(index, translated);
      }
      item[`${kind}Mods`] = mods.map((mod, index) => {
        const original = typeof mod === "object" ? mod.description : mod;
        const template = byIndex.get(index);
        if (!template || !original) return mod;
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
      const translatedBaseType = config.dataset.items[originalBaseType];

      if (translatedBaseType) item.baseType = format(translatedBaseType, originalBaseType);
      else if (originalBaseType) {
        reportMissing("item", originalBaseType, originalBaseType, "fetch:baseType");
      }

      if (originalTypeLine) {
        const directTypeLine = config.dataset.items[originalTypeLine];
        if (directTypeLine) {
          item.typeLine = format(directTypeLine, originalTypeLine);
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
        const translatedName = config.dataset.items[item.name];
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
