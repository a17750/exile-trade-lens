(() => {
  const LINK = /^\[([^|\]]+)(?:\|([^\]]+))?\]$/;
  const cleanMarkup = (value) => String(value ?? "")
    .replace(/\[([^|\]]+)\|([^\]]+)\]/g, "$2")
    .replace(/\[([^\]]+)\]/g, "$1")
    .trim();

  function isSkillGem(item, aggregate) {
    return aggregate?.frameTypes?.includes(item?.frameType) ||
      aggregate?.frameTypeIds?.includes(item?.frameTypeId);
  }

  function applyTemplate(pattern, value) {
    const escaped = String(pattern).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace("\\{0\\}", "(?<value>.+?)");
    const match = new RegExp(`^${escaped}$`).exec(String(value ?? "").trim());
    return match?.groups?.value ?? null;
  }

  function translateValue(property, originalLabel, domain, format, onMissing) {
    const values = Array.isArray(property.values) ? property.values : [];
    if (values.length !== 1 || !Array.isArray(values[0]) || typeof values[0][0] !== "string") return;
    const original = values[0][0].trim();

    if (["Cost", "Reservation"].includes(originalLabel)) {
      const translatedComponents = [];
      const missingComponents = [];
      for (const component of original.split(/\s*,\s*/)) {
        const normalizedComponent = cleanMarkup(component);
        const direct = /^(?<amount>[+-]?(?:\d+(?:\.\d+)?|\.\d+))\s+(?<resource>[^\s]+)$/.exec(normalizedComponent);
        const translatedResource = direct && domain.resources?.[direct.groups.resource];
        if (translatedResource) {
          translatedComponents.push(`${direct.groups.amount} ${translatedResource}`);
          continue;
        }
        let translated = null;
        for (const template of domain.valueTemplates ?? []) {
          if (template.kind !== "cost-component") continue;
          const value = applyTemplate(template.sourcePattern, normalizedComponent);
          if (value == null) continue;
          translated = template.targetPattern.replace("{0}", value);
          break;
        }
        if (translated) translatedComponents.push(translated);
        else missingComponents.push(component);
      }
      if (missingComponents.length) {
        for (const component of missingComponents) {
          onMissing?.(component, { reason: "unknown-cost-component", resource: component });
        }
        return;
      }
      values[0][0] = format(translatedComponents.join(", "), original);
      return;
    }

    for (const template of domain.valueTemplates ?? []) {
      if (template.kind === "seconds" &&
          !["Cast Time", "Cooldown Time", "Attack Time", "Use Time"].includes(originalLabel)) continue;
      if (template.kind === "percentage-of-base" && originalLabel !== "Attack Speed") continue;
      if (template.kind === "max-level" && originalLabel !== "Level") continue;
      const value = applyTemplate(template.sourcePattern, original);
      if (value == null) continue;
      values[0][0] = format(template.targetPattern.replace("{0}", value), original);
      return;
    }
  }

  function translateTags(property, domain, format, onMissing) {
    if (!property || (property.values?.length ?? 0) !== 0 || typeof property.name !== "string") return false;
    const rawTags = property.name.split(/\s*,\s*/);
    if (!rawTags.length) return false;
    const tokens = [];
    for (const raw of rawTags) {
      const match = LINK.exec(raw.trim());
      if (!match) return false;
      const semanticId = match[1];
      const english = match[2] || semanticId;
      tokens.push({
        semanticId,
        english,
        target: domain.tags?.bySemanticId?.[semanticId] ||
          domain.tags?.bySemanticText?.[`${semanticId}|${english}`],
      });
    }
    const unresolved = tokens.filter((token) => !token.target);
    if (unresolved.length) {
      for (const token of unresolved) {
        onMissing?.(token.english, {
          reason: "unknown-skill-tag",
          semanticId: token.semanticId,
          english: token.english,
        });
      }
      return true;
    }
    const original = cleanMarkup(property.name);
    property.name = format(tokens.map((token) => token.target).join(", "), original);
    return true;
  }

  function translateItem(item, { domain, format, onMissing }) {
    const handled = new Set();
    if (!domain || !isSkillGem(item, domain.aggregate)) {
      return { applicable: false, handled };
    }
    const properties = Array.isArray(item.properties) ? item.properties : [];
    for (const property of properties) {
      if (translateTags(property, domain, format, onMissing)) {
        handled.add(property);
        continue;
      }
      const originalLabel = cleanMarkup(property?.name);
      translateValue(property, originalLabel, domain, format, onMissing);
      const translatedLabel = domain.propertyLabels?.[originalLabel];
      if (!translatedLabel) continue;
      property.name = format(translatedLabel, originalLabel);
      handled.add(property);
    }
    return { applicable: true, handled };
  }

  globalThis.POE2ZHSkillGemDomain = Object.freeze({
    cleanMarkup,
    isSkillGem,
    translateItem,
  });
})();
