function parseSinglePlaceholderTemplate(text, supportedPlaceholders, label) {
  text = String(text ?? "");
  const matches = supportedPlaceholders.flatMap((placeholder) => {
    const indexes = [];
    let offset = text.indexOf(placeholder);
    while (offset >= 0) {
      indexes.push({ placeholder, offset });
      offset = text.indexOf(placeholder, offset + placeholder.length);
    }
    return indexes;
  });
  if (matches.length !== 1) {
    throw new Error(`${label} 必须且只能包含一个受支持的占位符`);
  }
  const [{ placeholder, offset }] = matches;
  return {
    placeholder,
    before: text.slice(0, offset),
    after: text.slice(offset + placeholder.length),
  };
}

function candidateClientStrings(clientStrings, discovery) {
  const suffix = String(discovery.sourceIdSuffix ?? "");
  const placeholders = discovery.supportedPlaceholders ?? [];
  return (clientStrings.records ?? [])
    .filter((record) => String(record.id ?? "").endsWith(suffix))
    .flatMap((record) => {
      try {
        const sourcePattern = parseSinglePlaceholderTemplate(
          record.english,
          placeholders,
          `ClientStrings.${record.id}.english`,
        );
        const targetPattern = parseSinglePlaceholderTemplate(
          record.zhTW,
          placeholders,
          `ClientStrings.${record.id}.zhTW`,
        );
        return [{ record, sourcePattern, targetPattern }];
      } catch {
        return [];
      }
    })
    .filter(({ sourcePattern, targetPattern }) => {
      if (sourcePattern.after !== "" || targetPattern.after !== "") return false;
      const wrapper = `${sourcePattern.before}${sourcePattern.after}`;
      return /^[A-Za-z][A-Za-z -]*$/.test(wrapper);
    });
}

export function compileItemNameDomain(policy, clientStrings) {
  if (!policy || typeof policy !== "object") {
    throw new Error("缺少 itemName 领域策略");
  }
  const discovery = policy.candidateDiscovery ?? {};
  if (discovery.source !== "ggpk.clientStrings") {
    throw new Error("itemName 候选模板来源必须是 ggpk.clientStrings");
  }
  const supportedPlaceholders = discovery.supportedPlaceholders ?? [];
  if (!supportedPlaceholders.length) {
    throw new Error("itemName 领域没有声明受支持的占位符");
  }

  const approvedSourceIds = new Set();
  const rules = (policy.normalDisplayTemplates ?? []).map((entry) => {
    if (
      entry.source !== "ggpk.clientStrings" ||
      !entry.ruleId ||
      !entry.sourceId ||
      !Array.isArray(entry.frameTypes) ||
      !entry.frameTypes.length
    ) {
      throw new Error("itemName 普通展示规则格式不兼容");
    }
    if (approvedSourceIds.has(entry.sourceId)) {
      throw new Error(`itemName 普通展示规则重复：${entry.sourceId}`);
    }
    approvedSourceIds.add(entry.sourceId);
    const sourceRecord = clientStrings.byId?.[entry.sourceId];
    if (!sourceRecord?.english || !sourceRecord?.zhTW) {
      throw new Error(`GGPK ClientStrings 缺少已审核规则：${entry.sourceId}`);
    }
    if (sourceRecord.english !== entry.expectedEnglish) {
      throw new Error(`ClientStrings.${entry.sourceId}.english 与领域策略的审核断言不一致`);
    }
    if (sourceRecord.zhTW !== entry.expectedZhTW) {
      throw new Error(`ClientStrings.${entry.sourceId}.zhTW 与领域策略的审核断言不一致`);
    }
    return {
      ruleId: entry.ruleId,
      domain: "item-name.normal-display",
      source: { kind: "ggpk-client-string", id: entry.sourceId },
      frameTypes: [...new Set(entry.frameTypes)].sort((a, b) => a - b),
      sourcePattern: parseSinglePlaceholderTemplate(
        sourceRecord.english,
        supportedPlaceholders,
        `ClientStrings.${entry.sourceId}.english`,
      ),
      targetPattern: parseSinglePlaceholderTemplate(
        sourceRecord.zhTW,
        supportedPlaceholders,
        `ClientStrings.${entry.sourceId}.zhTW`,
      ),
    };
  });

  const candidates = candidateClientStrings(clientStrings, discovery).map(
    ({ record, sourcePattern, targetPattern }) => ({
      sourceId: record.id,
      row: record.row,
      english: record.english,
      zhTW: record.zhTW,
      sourcePattern,
      targetPattern,
      status: approvedSourceIds.has(record.id) ? "approved" : "review",
    }),
  );

  return {
    domain: {
      schemaVersion: 1,
      normalDisplayRules: rules,
    },
    report: {
      schemaVersion: 1,
      summary: {
        approvedRules: rules.length,
        discoveredCandidates: candidates.length,
        reviewCandidates: candidates.filter((candidate) => candidate.status === "review").length,
      },
      candidates,
    },
  };
}
