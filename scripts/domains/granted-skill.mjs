const PLACEHOLDER = /\{([01])\}/g;

function placeholders(pattern) {
  return [...String(pattern ?? "").matchAll(PLACEHOLDER)].map((match) => Number(match[1]));
}

function assertNormalizedPattern(pattern, variant, label) {
  const slots = placeholders(pattern);
  const expected = variant === "levelled" ? [1, 0] : [0];
  if (slots.length !== expected.length || slots.some((slot, index) => slot !== expected[index])) {
    throw new Error(`${label} 占位符顺序与 ${variant} 规则不一致`);
  }
  if (/<[^>]+>|\{\{|\}\}/.test(pattern)) {
    throw new Error(`${label} 必须是移除展示标记后的审核模板`);
  }
}

export function compileGrantedSkillDomain(policy, clientStrings, baseItems) {
  if (!policy || typeof policy !== "object") {
    throw new Error("缺少 grantedSkill 领域策略");
  }
  if (policy.skillNames?.source !== "ggpk.baseItems") {
    throw new Error("grantedSkill 技能名称来源必须是 ggpk.baseItems");
  }

  const seen = new Set();
  const rules = (policy.templates ?? []).map((entry) => {
    if (
      entry.source !== "ggpk.clientStrings" ||
      !entry.ruleId ||
      !entry.sourceId ||
      !["levelled", "unlevelled"].includes(entry.variant)
    ) {
      throw new Error("grantedSkill 模板规则格式不兼容");
    }
    if (seen.has(entry.sourceId)) {
      throw new Error(`grantedSkill 模板规则重复：${entry.sourceId}`);
    }
    seen.add(entry.sourceId);
    const source = clientStrings.byId?.[entry.sourceId];
    if (!source?.english || !source?.zhTW) {
      throw new Error(`GGPK ClientStrings 缺少赋予技能规则：${entry.sourceId}`);
    }
    if (source.english !== entry.expectedEnglish || source.zhTW !== entry.expectedZhTW) {
      throw new Error(`ClientStrings.${entry.sourceId} 与赋予技能领域的审核断言不一致`);
    }
    assertNormalizedPattern(entry.normalizedEnglish, entry.variant, `${entry.ruleId}.english`);
    assertNormalizedPattern(entry.normalizedZhTW, entry.variant, `${entry.ruleId}.zhTW`);
    return {
      ruleId: entry.ruleId,
      domain: "item-skill.granted",
      variant: entry.variant,
      source: { kind: "ggpk-client-string", id: entry.sourceId },
      sourcePattern: entry.normalizedEnglish,
      targetPattern: entry.normalizedZhTW,
    };
  });

  if (rules.length !== 2 || !rules.some((rule) => rule.variant === "levelled") ||
      !rules.some((rule) => rule.variant === "unlevelled")) {
    throw new Error("grantedSkill 必须同时审核有等级与无等级模板");
  }

  for (const [english, expected] of Object.entries(policy.skillNames.requiredExamples ?? {})) {
    if (baseItems.byEnglish?.[english] !== expected) {
      throw new Error(`GGPK 技能名称审核断言不一致：${english}`);
    }
  }

  return {
    domain: {
      schemaVersion: 1,
      skillNameSource: "baseItems",
      rules,
    },
    report: {
      schemaVersion: 1,
      summary: {
        approvedTemplates: rules.length,
        officialSkillNames: Object.keys(baseItems.byEnglish ?? {}).length,
        requiredExamples: Object.keys(policy.skillNames.requiredExamples ?? {}).length,
      },
      rules,
    },
  };
}
