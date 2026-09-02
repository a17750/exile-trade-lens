function cleanMarkup(value) {
  return String(value ?? "")
    .replace(/\[([^|\]]+)\|([^\]]+)\]/g, "$2")
    .replace(/\[([^\]]+)\]/g, "$1")
    .trim();
}

function assertClientString(clientStrings, entry, context) {
  const source = clientStrings.byId?.[entry.sourceId];
  if (!source?.english || !source?.zhTW) {
    throw new Error(`GGPK ClientStrings 缺少技能宝石${context}：${entry.sourceId}`);
  }
  if (source.english !== entry.expectedEnglish || source.zhTW !== entry.expectedZhTW) {
    throw new Error(`ClientStrings.${entry.sourceId} 与技能宝石领域审核断言不一致`);
  }
  return source;
}

export function compileSkillGemDomain(
  policy,
  clientStrings,
  linkedTerms,
  ggpkSkillGemTags,
  officialTags,
) {
  if (!policy || typeof policy !== "object") throw new Error("缺少 skillGem 领域策略");
  if (policy.tags?.source !== "ggpk.skillGemTags+data/skill-tags.zh-TW.json+ggpk.linkedTerms") {
    throw new Error("skillGem 标签来源策略无效");
  }
  if (
    ggpkSkillGemTags?.schemaVersion !== 1 ||
    ggpkSkillGemTags?.domain !== "skill-gem-tag" ||
    !ggpkSkillGemTags?.bySemanticId ||
    !Array.isArray(ggpkSkillGemTags?.records)
  ) {
    throw new Error("GGPK skillGemTags 格式不兼容，请重新运行 tools/ggpk/run.ps1");
  }
  if (
    officialTags?.schemaVersion !== 1 ||
    officialTags?.domain !== "item-skill-gem-tags" ||
    officialTags?.policy !== "semantic-id-exact" ||
    !Array.isArray(officialTags?.records)
  ) {
    throw new Error("data/skill-tags.zh-TW.json 格式不兼容");
  }

  const frameTypes = [...new Set(policy.aggregate?.frameTypes ?? [])];
  const frameTypeIds = [...new Set(policy.aggregate?.frameTypeIds ?? [])];
  if (!frameTypes.length || !frameTypeIds.length) throw new Error("skillGem 聚合根判定不完整");

  const tagCandidates = new Map();
  for (const record of linkedTerms?.records ?? []) {
    if (!record?.id || !record?.english || !record?.zhTW || record.english === record.zhTW) continue;
    const key = `${record.id}|${record.english}`;
    if (!tagCandidates.has(key)) tagCandidates.set(key, new Set());
    tagCandidates.get(key).add(record.zhTW);
  }
  const tagsBySemanticText = {};
  for (const [key, translations] of tagCandidates) {
    if (translations.size === 1) tagsBySemanticText[key] = [...translations][0];
  }
  const tagsBySemanticId = {};
  const tagSources = {};
  for (const [semanticId, value] of Object.entries(ggpkSkillGemTags.bySemanticId)) {
    const zhTW = String(value ?? "").trim();
    if (!semanticId || !zhTW) continue;
    tagsBySemanticId[semanticId] = zhTW;
    tagSources[semanticId] = "ggpk:GemTags";
  }
  const tradeValidation = [];
  const tradeConflicts = [];
  const tradeFallbacks = [];
  for (const record of officialTags.records) {
    const semanticId = String(record?.semanticId ?? "").trim();
    const zhTW = String(record?.zhTW ?? "").trim();
    const evidence = String(record?.evidence ?? "").trim();
    if (
      !semanticId ||
      !zhTW ||
      (!evidence.startsWith("category-corpus.zh-TW:") &&
        !evidence.startsWith("official-tw-trade:"))
    ) {
      throw new Error(`skillGem 官方标签记录格式不完整：${semanticId || "unknown"}`);
    }
    if (tagsBySemanticId[semanticId]) {
      if (tagsBySemanticId[semanticId] === zhTW) {
        tradeValidation.push({ semanticId, zhTW, evidence, status: "agrees-with-ggpk" });
      } else {
        tradeConflicts.push({
          semanticId,
          ggpk: tagsBySemanticId[semanticId],
          trade: zhTW,
          evidence,
          resolution: "kept-ggpk",
        });
      }
      continue;
    }
    tagsBySemanticId[semanticId] = zhTW;
    tagSources[semanticId] = "official-tw-trade-fallback";
    tradeFallbacks.push({ semanticId, zhTW, evidence });
  }
  for (const [key, expected] of Object.entries(policy.tags.requiredExamples ?? {})) {
    if (tagsBySemanticId[key] !== expected) {
      throw new Error(`技能标签审核断言不一致：${key}`);
    }
  }

  const propertyLabels = {};
  for (const entry of policy.propertyLabels ?? []) {
    const source = assertClientString(clientStrings, entry, "属性标签");
    const english = cleanMarkup(source.english);
    const zhTW = cleanMarkup(source.zhTW);
    if (propertyLabels[english] && propertyLabels[english] !== zhTW) {
      throw new Error(`skillGem 属性标签冲突：${english}`);
    }
    propertyLabels[english] = zhTW;
  }

  const resources = {};
  for (const entry of policy.resourceLabels ?? []) {
    const source = assertClientString(clientStrings, entry, "资源标签");
    resources[cleanMarkup(source.english)] = cleanMarkup(source.zhTW);
  }

  const valueTemplates = (policy.valueTemplates ?? []).map((entry) => {
    const source = assertClientString(clientStrings, entry, "数值模板");
    if (!entry.kind || !source.english.includes("{0}") || !source.zhTW.includes("{0}")) {
      throw new Error(`skillGem 数值模板不兼容：${entry.sourceId}`);
    }
    return {
      kind: entry.kind,
      sourceId: entry.sourceId,
      sourcePattern: cleanMarkup(source.english),
      targetPattern: cleanMarkup(source.zhTW),
    };
  });

  const domain = {
    schemaVersion: 1,
    aggregate: { frameTypes, frameTypeIds },
    tags: { bySemanticId: tagsBySemanticId, bySemanticText: tagsBySemanticText },
    propertyLabels,
    resources,
    valueTemplates,
  };
  return {
    domain,
    report: {
      schemaVersion: 1,
      domain: "item-skill-gem",
      summary: {
        semanticTags: Object.keys(tagsBySemanticId).length,
        ggpkSemanticTags: Object.values(tagSources).filter((source) => source === "ggpk:GemTags").length,
        tradeValidated: tradeValidation.length,
        tradeFallbacks: tradeFallbacks.length,
        tradeConflicts: tradeConflicts.length,
        ggpkFallbackSemanticTexts: Object.keys(tagsBySemanticText).length,
        propertyLabels: Object.keys(propertyLabels).length,
        resources: Object.keys(resources).length,
        valueTemplates: valueTemplates.length,
      },
      sourcesBySemanticId: tagSources,
      tradeValidation,
      tradeFallbacks,
      tradeConflicts,
    },
  };
}
