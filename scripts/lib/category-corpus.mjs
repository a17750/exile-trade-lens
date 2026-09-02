import crypto from "node:crypto";

export const AGGREGATE_CATEGORY_IDS = new Set([
  "weapon",
  "weapon.onemelee",
  "weapon.twomelee",
  "weapon.ranged",
  "weapon.caster",
  "armour",
  "accessory",
  "gem",
  "flask",
  "map",
  "currency",
  "currency.socketable",
]);

const PARENTS = {
  "weapon.unarmed": "weapon.onemelee",
  "weapon.claw": "weapon.onemelee",
  "weapon.dagger": "weapon.onemelee",
  "weapon.onesword": "weapon.onemelee",
  "weapon.oneaxe": "weapon.onemelee",
  "weapon.onemace": "weapon.onemelee",
  "weapon.spear": "weapon.onemelee",
  "weapon.flail": "weapon.onemelee",
  "weapon.twosword": "weapon.twomelee",
  "weapon.twoaxe": "weapon.twomelee",
  "weapon.twomace": "weapon.twomelee",
  "weapon.warstaff": "weapon.twomelee",
  "weapon.talisman": "weapon.twomelee",
  "weapon.bow": "weapon.ranged",
  "weapon.crossbow": "weapon.ranged",
  "weapon.wand": "weapon.caster",
  "weapon.sceptre": "weapon.caster",
  "weapon.staff": "weapon.caster",
  "currency.rune": "currency.socketable",
  "currency.soulcore": "currency.socketable",
  "currency.idol": "currency.socketable",
};

export function categoryTasks(tradeApi, pageSize = 100) {
  const english = tradeApi?.english?.sections?.filters?.entries?.category?.options;
  const translated = tradeApi?.overlay?.sections?.filters?.entries?.category?.options ??
    tradeApi?.zhTW?.sections?.filters?.entries?.category?.options;
  if (!english || !translated) throw new Error("Trade API 快照缺少 type_filters.category 选项");
  return Object.entries(english).map(([categoryId, englishLabel], index) => ({
    order: index,
    categoryId,
    englishLabel,
    zhTWLabel: translated[categoryId] ?? "",
    nodeType: categoryId === "null"
      ? "control"
      : AGGREGATE_CATEGORY_IDS.has(categoryId) ? "aggregate" : "leaf",
    logicalParent: categoryId === "null"
      ? null
      : PARENTS[categoryId] ?? (categoryId.includes(".") ? categoryId.split(".")[0] : null),
    pageSize,
  }));
}

const ITEM_FIELDS = new Set([
  "support", "name", "typeLine", "baseType", "ilvl", "identified", "corrupted",
  "fractured", "synthesised", "duplicated", "split", "mirrored", "frameType",
  "frameTypeId", "properties", "additionalProperties", "requirements", "weaponRequirements",
  "grantedSkills", "secDescrText", "descrText", "gemTabs", "explicitMods", "implicitMods",
  "enchantMods", "runeMods", "fracturedMods", "craftedMods", "desecratedMods", "ultimatumMods",
  "extended", "sockets", "gemSockets", "socketedItems", "stackSize", "maxStackSize",
]);

export function sanitizeItem(item) {
  const sanitized = {};
  for (const [key, value] of Object.entries(item ?? {})) {
    if (!ITEM_FIELDS.has(key) && !key.endsWith("Mods")) continue;
    if (key === "socketedItems" && Array.isArray(value)) {
      sanitized[key] = value.map(sanitizeItem);
    } else {
      sanitized[key] = structuredClone(value);
    }
  }
  return sanitized;
}

export function structuralFingerprint(item) {
  const propertyShape = (property) => ({
    displayMode: property?.displayMode ?? null,
    type: property?.type ?? null,
    valueCount: Array.isArray(property?.values) ? property.values.length : 0,
    valueColours: (property?.values ?? []).map((value) => value?.[1] ?? null),
    hash: property?.hash ?? null,
  });
  const shape = JSON.stringify({
    frameType: item?.frameType ?? null,
    frameTypeId: item?.frameTypeId ?? null,
    identified: item?.identified ?? null,
    corrupted: item?.corrupted ?? null,
    properties: (item?.properties ?? []).map(propertyShape),
    additionalProperties: (item?.additionalProperties ?? []).map(propertyShape),
    requirements: (item?.requirements ?? []).map(propertyShape),
    weaponRequirements: (item?.weaponRequirements ?? []).map(propertyShape),
    grantedSkills: (item?.grantedSkills ?? []).map(propertyShape),
    modHashes: Object.entries(item ?? {})
      .filter(([key, value]) => key.endsWith("Mods") && Array.isArray(value))
      .map(([key, value]) => [key, value.map((mod) => mod?.hash ?? null)]),
    sockets: (item?.sockets ?? []).map((socket) => ({
      group: socket?.group ?? null,
      attr: socket?.attr ?? null,
      sColour: socket?.sColour ?? null,
    })),
  });
  return crypto.createHash("sha256").update(shape).digest("hex").slice(0, 16);
}

export function sanitizeFetchResult(result) {
  const item = sanitizeItem(result?.item);
  return {
    // One-way digest permits exact EN/TW listing alignment without retaining
    // the official result identifier.
    alignmentKey: crypto.createHash("sha256").update(String(result?.id ?? "")).digest("hex"),
    fingerprint: structuralFingerprint(item),
    item,
  };
}

export function categorySearchBody(categoryId) {
  const filters = categoryId === "null"
    ? {}
    : { type_filters: { filters: { category: { option: categoryId } } } };
  return {
    query: {
      status: { option: "any" },
      stats: [{ type: "and", filters: [] }],
      filters,
    },
    sort: { indexed: "desc" },
  };
}
