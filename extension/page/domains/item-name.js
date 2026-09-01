(() => {
  let componentIndexes = { version: null, words: null, withBaseItems: null };

  function translated(original, text, domain, ruleId) {
    return { status: "translated", original, text, domain, ruleId };
  }

  function unresolved(original, domain, reason) {
    return { status: "unresolved", original, domain, reason };
  }

  function absent(domain) {
    return { status: "not-applicable", original: "", domain };
  }

  function baseItemTranslation(dataset, english) {
    return dataset?.baseItems?.[english] || dataset?.items?.[english];
  }

  function fixedNameTranslation(dataset, english) {
    return dataset?.fixedNames?.[english] || dataset?.items?.[english];
  }

  function componentIndex(dataset, includeBaseItems) {
    const version = dataset?.datasetVersion;
    if (componentIndexes.version !== version) {
      componentIndexes = { version, words: null, withBaseItems: null };
    }
    const cacheKey = includeBaseItems ? "withBaseItems" : "words";
    if (componentIndexes[cacheKey]) return componentIndexes[cacheKey];
    const source = includeBaseItems
      ? { ...(dataset?.baseItems ?? {}), ...(dataset?.wordComponents ?? {}) }
      : dataset?.wordComponents ?? {};
    const buckets = new Map();
    for (const [english, text] of Object.entries(source)) {
      if (!english || !text || english === text) continue;
      const first = english[0];
      if (!buckets.has(first)) buckets.set(first, []);
      buckets.get(first).push([english, text]);
    }
    for (const entries of buckets.values()) {
      entries.sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0]));
    }
    componentIndexes[cacheKey] = buckets;
    return buckets;
  }

  function composeOfficialName(dataset, original, includeBaseItems = false) {
    original = String(original ?? "");
    if (!original) return null;
    const exact = includeBaseItems
      ? baseItemTranslation(dataset, original) || dataset?.fixedNames?.[original]
      : dataset?.fixedNames?.[original];
    if (exact) return exact;

    const buckets = componentIndex(dataset, includeBaseItems);
    const memo = new Map();
    function solve(offset) {
      if (offset === original.length) return { texts: [""], parts: 0 };
      if (memo.has(offset)) return memo.get(offset);
      let minimumParts = Number.POSITIVE_INFINITY;
      const texts = new Set();
      for (const [english, text] of buckets.get(original[offset]) ?? []) {
        if (!original.startsWith(english, offset)) continue;
        const tail = solve(offset + english.length);
        if (!tail) continue;
        minimumParts = Math.min(minimumParts, tail.parts + 1);
        for (const tailText of tail.texts) {
          texts.add(text + tailText);
          if (texts.size > 1) break;
        }
        if (texts.size > 1) break;
      }
      const best = minimumParts < Number.POSITIVE_INFINITY
        ? { texts: [...texts], parts: minimumParts }
        : null;
      memo.set(offset, best);
      return best;
    }
    const result = solve(0);
    return result?.texts?.length === 1 ? result.texts[0] : null;
  }

  function composeMagicTypeLine(dataset, original, baseType, frameType) {
    const translatedBase = baseItemTranslation(dataset, baseType);
    if (!original || !baseType || !translatedBase) return null;
    const rule = dataset?.domains?.itemName?.magicAffixRule;
    if (!rule?.frameTypes?.includes(frameType)) return null;
    const baseOffset = original.indexOf(baseType);
    if (baseOffset < 0 || original.indexOf(baseType, baseOffset + baseType.length) >= 0) {
      return null;
    }
    const prefix = original.slice(0, baseOffset).trim();
    const suffix = original.slice(baseOffset + baseType.length).trim();
    const translatedPrefix = prefix ? dataset?.affixNames?.prefixes?.[prefix] : "";
    const translatedSuffix = suffix ? dataset?.affixNames?.suffixes?.[suffix] : "";
    if ((prefix && !translatedPrefix) || (suffix && !translatedSuffix)) return null;
    const translatedParts = {
      prefix: translatedPrefix,
      base: translatedBase,
      suffix: translatedSuffix,
    };
    return rule.targetOrder.map((part) => translatedParts[part] ?? "").join("");
  }

  function composeNormalTypeLine(dataset, original, baseType, frameType) {
    const translatedBase = baseItemTranslation(dataset, baseType);
    if (!original || !baseType || !translatedBase) return null;
    if (original === baseType) {
      return { text: translatedBase, ruleId: "base-item:exact" };
    }
    for (const rule of dataset?.domains?.itemName?.normalDisplayRules ?? []) {
      if (!rule?.frameTypes?.includes(frameType)) continue;
      const source = rule.sourcePattern;
      const target = rule.targetPattern;
      if (!source || !target) continue;
      if (original !== `${source.before}${baseType}${source.after}`) continue;
      return {
        text: `${target.before}${translatedBase}${target.after}`,
        ruleId: rule.ruleId,
      };
    }
    return null;
  }

  function resolve(item, dataset) {
    const frameType = item?.frameType;
    const originalBaseType = String(item?.baseType ?? "");
    const originalTypeLine = String(item?.typeLine ?? "");
    const originalName = String(item?.name ?? "");
    const reports = [];

    const translatedBase = baseItemTranslation(dataset, originalBaseType);
    const baseType = !originalBaseType
      ? absent("item-name.base-type")
      : translatedBase
        ? translated(originalBaseType, translatedBase, "item-name.base-type", "base-item:exact")
        : unresolved(originalBaseType, "item-name.base-type", "missing-base-item");
    if (baseType.status === "unresolved") {
      reports.push({
        type: "item",
        key: originalBaseType,
        en: originalBaseType,
        context: "fetch:baseType",
        domain: baseType.domain,
        reason: baseType.reason,
      });
    }

    let typeLine = absent("item-name.type-line");
    if (originalTypeLine) {
      const direct =
        dataset?.baseItems?.[originalTypeLine] ||
        dataset?.fixedNames?.[originalTypeLine] ||
        dataset?.items?.[originalTypeLine];
      let composed = null;
      let ruleId = "item-name:exact";
      if (!direct && frameType === 0) {
        const result = composeNormalTypeLine(
          dataset,
          originalTypeLine,
          originalBaseType,
          frameType,
        );
        composed = result?.text ?? null;
        ruleId = result?.ruleId ?? "normal-display:unresolved";
      } else if (!direct && frameType === 1) {
        composed = composeMagicTypeLine(
          dataset,
          originalTypeLine,
          originalBaseType,
          frameType,
        );
        ruleId = dataset?.domains?.itemName?.magicAffixRule?.ruleId ??
          "magic-affix:unresolved";
      } else if (!direct && frameType === 2) {
        composed = composeOfficialName(dataset, originalTypeLine, true);
        ruleId = "rare-name:components";
      }
      const text = direct || composed;
      typeLine = text
        ? translated(originalTypeLine, text, "item-name.type-line", ruleId)
        : unresolved(
            originalTypeLine,
            frameType === 0 ? "item-name.normal-display" : "item-name.type-line",
            frameType === 0 ? "unknown-display-template" : "unresolved-type-line",
          );
      if (typeLine.status === "unresolved" && frameType === 0) {
        reports.push({
          type: "item",
          key: originalTypeLine,
          en: originalTypeLine,
          context: "fetch:typeLine:normal-display-unresolved",
          domain: typeLine.domain,
          reason: typeLine.reason,
        });
      } else if (
        typeLine.status === "unresolved" &&
        originalTypeLine === originalBaseType &&
        baseType.status === "unresolved"
      ) {
        reports.push({
          type: "item",
          key: originalTypeLine,
          en: originalTypeLine,
          context: "fetch:typeLine",
          domain: typeLine.domain,
          reason: typeLine.reason,
        });
      }
    }

    let name = absent("item-name.fixed-name");
    if (originalName) {
      const text = frameType === 1 || frameType === 2
        ? composeOfficialName(dataset, originalName)
        : fixedNameTranslation(dataset, originalName);
      name = text
        ? translated(
            originalName,
            text,
            frameType === 1 || frameType === 2
              ? "item-name.generated-name"
              : "item-name.fixed-name",
            frameType === 1 || frameType === 2 ? "word-components:complete" : "fixed-name:exact",
          )
        : unresolved(
            originalName,
            frameType === 1 || frameType === 2
              ? "item-name.generated-name"
              : "item-name.fixed-name",
            "unresolved-name",
          );
      if (name.status === "unresolved" && frameType === 3) {
        reports.push({
          type: "item",
          key: originalName,
          en: originalName,
          context: "fetch:name",
          domain: name.domain,
          reason: name.reason,
        });
      }
    }

    return { baseType, typeLine, name, reports };
  }

  globalThis.POE2ZHItemNameDomain = { resolve };
})();
