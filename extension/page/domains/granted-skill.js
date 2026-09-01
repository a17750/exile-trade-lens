(() => {
  const clean = (value) => String(value ?? "").replace(/\[[^|\]]*\||[\][]/g, "").trim();
  const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function matcher(pattern) {
    const parts = String(pattern).split(/(\{[01]\})/g);
    const source = parts.map((part) => {
      if (part === "{0}") return "(?<skill>.+?)";
      if (part === "{1}") return "(?<level>\\d+)";
      return escapeRegex(part);
    }).join("");
    return new RegExp(`^${source}$`);
  }

  function render(pattern, values) {
    return String(pattern).replace(/\{([01])\}/g, (_, slot) => values[Number(slot)] ?? "");
  }

  function translateFlat(property, original, rules, skillNames, format, onMissing) {
    for (const rule of rules) {
      const match = matcher(rule.sourcePattern).exec(original);
      if (!match) continue;
      const skillEnglish = clean(match.groups?.skill);
      const skillZhTW = skillNames?.[skillEnglish];
      if (!skillZhTW || skillZhTW === skillEnglish) {
        onMissing?.(original, {
          domain: "item-skill.granted",
          reason: "missing-skill-name",
          skillEnglish,
          ruleId: rule.ruleId,
        });
        return { handled: true, status: "unresolved", original };
      }
      const translated = render(rule.targetPattern, {
        0: skillZhTW,
        1: match.groups?.level ?? "",
      });
      property.name = format(translated, original);
      return { handled: true, status: "translated", original, translated };
    }
    return null;
  }

  function translateStructured(property, original, rules, skillNames, format, onMissing) {
    const rule = rules.find((candidate) => candidate.sourcePattern === original);
    if (!rule) return null;
    const values = Array.isArray(property.values) ? property.values : [];
    const skillEnglish = clean(values[0]?.[0]);
    const skillZhTW = skillNames?.[skillEnglish];
    const level = clean(values[1]?.[0]);
    if (!skillZhTW || skillZhTW === skillEnglish || (rule.variant === "levelled" && !/^\d+$/.test(level))) {
      onMissing?.(original, {
        domain: "item-skill.granted",
        reason: !skillZhTW || skillZhTW === skillEnglish ? "missing-skill-name" : "invalid-level",
        skillEnglish,
        ruleId: rule.ruleId,
      });
      return { handled: true, status: "unresolved", original };
    }

    const originalLine = render(rule.sourcePattern, { 0: skillEnglish, 1: level });
    const translatedLine = render(rule.targetPattern, { 0: skillZhTW, 1: level });
    property.name = rule.targetPattern;
    property.values[0][0] = format(skillZhTW, skillEnglish);
    // Register the complete line for translated-mode hover without changing the
    // official structured property shape consumed by the page.
    format(translatedLine, originalLine);
    return { handled: true, status: "translated", original: originalLine, translated: translatedLine };
  }

  function translateSplitProperty(property, original, rules, skillNames, format, onMissing) {
    if (original !== "Grants Skill") return null;
    const values = Array.isArray(property.values) ? property.values : [];
    const originalValue = clean(values[0]?.[0]);
    if (!originalValue || values.length !== 1) {
      onMissing?.(original, {
        domain: "item-skill.granted",
        reason: "template-shape-drift",
        skillEnglish: "",
        ruleId: "",
      });
      return { handled: true, status: "unresolved", original };
    }

    for (const rule of rules) {
      const sourcePrefix = "Grants Skill: ";
      const targetPrefix = "賦予技能: ";
      if (!rule.sourcePattern.startsWith(sourcePrefix) || !rule.targetPattern.startsWith(targetPrefix)) {
        continue;
      }
      const match = matcher(rule.sourcePattern.slice(sourcePrefix.length)).exec(originalValue);
      if (!match) continue;
      const skillEnglish = clean(match.groups?.skill);
      const skillZhTW = skillNames?.[skillEnglish];
      if (!skillZhTW || skillZhTW === skillEnglish) {
        onMissing?.(`${original}: ${originalValue}`, {
          domain: "item-skill.granted",
          reason: "missing-skill-name",
          skillEnglish,
          ruleId: rule.ruleId,
        });
        return { handled: true, status: "unresolved", original: `${original}: ${originalValue}` };
      }
      const translatedValue = render(rule.targetPattern.slice(targetPrefix.length), {
        0: skillZhTW,
        1: match.groups?.level ?? "",
      });
      const originalLine = `${original}: ${originalValue}`;
      const translatedLine = `${targetPrefix}${translatedValue}`;
      const renderedLine = format(translatedLine, originalLine);
      if (!renderedLine.startsWith(targetPrefix)) {
        throw new Error("赋予技能格式化结果破坏了已审核的目标前缀");
      }
      property.name = targetPrefix.slice(0, -2);
      property.values[0][0] = renderedLine.slice(targetPrefix.length);
      return { handled: true, status: "translated", original: originalLine, translated: translatedLine };
    }

    onMissing?.(`${original}: ${originalValue}`, {
      domain: "item-skill.granted",
      reason: "template-shape-drift",
      skillEnglish: "",
      ruleId: "",
    });
    return { handled: true, status: "unresolved", original: `${original}: ${originalValue}` };
  }

  function translate(property, { domain, skillNames, format, onMissing }) {
    if (!property || typeof property !== "object" || !domain?.rules) {
      return { handled: false, status: "not-applicable" };
    }
    const original = clean(property.name);
    if (!original) return { handled: false, status: "not-applicable" };
    const rules = [...domain.rules].sort((left, right) =>
      right.sourcePattern.length - left.sourcePattern.length,
    );
    const resolved = original === "Grants Skill"
      ? translateSplitProperty(property, original, rules, skillNames, format, onMissing)
      : original.includes("{")
        ? translateStructured(property, original, rules, skillNames, format, onMissing)
        : translateFlat(property, original, rules, skillNames, format, onMissing);
    if (resolved) return resolved;
    if (/^Grants Skill\s*:/i.test(original)) {
      onMissing?.(original, {
        domain: "item-skill.granted",
        reason: "template-shape-drift",
        skillEnglish: "",
        ruleId: "",
      });
      return { handled: true, status: "unresolved", original };
    }
    return { handled: false, status: "not-applicable" };
  }

  globalThis.POE2ZHGrantedSkillDomain = Object.freeze({ translate, matcher, render, clean });
})();
