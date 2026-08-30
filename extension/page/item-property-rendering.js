(() => {
  const clean = (value) => String(value ?? "").replace(/\[[^|\]]*\||[\][]/g, "").trim();

  function resolveType109(property, english, config) {
    if (
      Number(property?.type) !== Number(config?.propertyType) ||
      (Array.isArray(property?.values) && property.values.length) ||
      config?.template !== "{qualifier}{class}"
    ) return null;
    const classes = Object.entries(config.classes ?? {})
      .sort(([left], [right]) => right.length - left.length);
    for (const [classEnglish, classRecord] of classes) {
      if (english === classEnglish) return { text: classRecord.text };
      const suffix = ` ${classEnglish}`;
      if (!english.endsWith(suffix)) continue;
      const qualifierEnglish = english.slice(0, -suffix.length);
      const qualifier = config.qualifiers?.[qualifierEnglish];
      if (!qualifier?.text) {
        return { unresolved: true, qualifier: qualifierEnglish, itemClass: classEnglish };
      }
      return {
        text: config.template
          .replace("{qualifier}", qualifier.text)
          .replace("{class}", classRecord.text),
      };
    }
    return { unresolved: true, qualifier: null, itemClass: null };
  }

  function translate(
    property,
    { translations, fallbackTranslations, type109, format, onMissing },
  ) {
    if (!property || typeof property !== "object") return property;
    const english = clean(property.name);
    if (!english) return property;
    const record = fallbackTranslations?.[english] ?? translations?.[english];
    let translated = typeof record === "string" ? record : record?.text;
    let unresolvedType109 = null;
    if (!translated) {
      const structured = resolveType109(property, english, type109);
      translated = structured?.text;
      if (structured?.unresolved) unresolvedType109 = structured;
    }
    if (translated) property.name = format(translated, english);
    else onMissing?.(english, unresolvedType109 ? { kind: "type-109", ...unresolvedType109 } : null);
    return property;
  }

  globalThis.POE2ZHItemPropertyRendering = Object.freeze({ translate, clean, resolveType109 });
})();
