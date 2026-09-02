import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = vm.createContext({ window: {} });
vm.runInContext(
  fs.readFileSync(path.join(root, "extension/page/stat-rendering.js"), "utf8"),
  context,
  { filename: "stat-rendering.js" },
);

const statId = "explicit.stat_1416292992";
const signedStatId = "explicit.stat_3639275092";
const dataset = {
  datasetVersion: "test",
  domains: {
    statDescriptionExact: {
      entries: {
        "No Physical Damage": "不造成物理傷害",
        "Grenade Skills have +# Cooldown Use": "擲彈技能有+#次冷卻使用次數",
      },
    },
  },
  exact: { "Has # Charm Slot": "有#個護符欄位" },
  stats: {
    entries: {
      [statId]: {
        english: "Has # Charm Slot",
        text: "有#個護符欄位",
        renderings: [{
          english: "Has # Charm Slots",
          text: "有#個護符欄位",
        }],
      },
      [signedStatId]: {
        english: "#% increased Attribute Requirements",
        text: "增加#%能力值需求",
        renderings: [{
          english: "#% reduced Attribute Requirements",
          text: "減少#%能力值需求",
          source: "ggpk-csd-signed-variant",
        }],
      },
    },
  },
};
const renderer = context.window.POE2ZHStatRendering.create(dataset);

assert.equal(renderer.sameShape("Has # Charm Slot", "Has 1 Charm Slot"), true);
assert.equal(renderer.sameShape("Has # Charm Slots", "Has 2 Charm Slots"), true);
assert.equal(renderer.sameShape("Has # Charm Slot", "Has 2 Charm Slots"), false);
assert.deepEqual(renderer.matchingRenderings(statId, "Has 3 Charm Slots"), [{
  english: "Has # Charm Slots",
  text: "有#個護符欄位",
}]);
assert.deepEqual(renderer.matchingRenderings(statId, "Has 3 Rune Slots"), []);
assert.deepEqual(renderer.matchingRenderings(signedStatId, "40% reduced Attribute Requirements"), [{
  english: "#% reduced Attribute Requirements",
  text: "減少#%能力值需求",
  source: "ggpk-csd-signed-variant",
}]);
assert.deepEqual(renderer.matchingRenderings(signedStatId, "40% increased Attribute Requirements"), []);
assert.deepEqual(renderer.matchingRenderings(signedStatId, "40% diminished Attribute Requirements"), []);
assert.equal(
  renderer.matchingTemplates("No Physical Damage").map((entry) => entry.translated).join("|"),
  "不造成物理傷害",
);
assert.equal(
  renderer.matchingTemplates("Grenade Skills have +1 Cooldown Use").map((entry) => entry.translated).join("|"),
  "擲彈技能有+#次冷卻使用次數",
);

const builtDataset = JSON.parse(
  fs.readFileSync(path.join(root, "extension/data/bundled.json"), "utf8"),
);
const builtRenderer = context.window.POE2ZHStatRendering.create(builtDataset);
for (const [id, original, expected] of [
  ["implicit.stat_2933846633", "40% chance to Daze on Hit", "擊中時有#%機率造成目眩"],
  ["implicit.stat_4077843608", "Has 3 Sockets", "有#個插槽"],
  ["explicit.stat_1368271171", "Lose 3 Mana per enemy killed", "每個被擊殺的敵人，失去#魔力"],
  ["explicit.stat_412462523", "40% less Attack Damage", "#%更少攻擊傷害"],
]) {
  assert.equal(
    builtRenderer.matchingRenderings(id, original).map((entry) => entry.text).join("|"),
    expected,
    `${id} 应从同一 GGPK CSD 描述块解析条件/复数变体`,
  );
}
console.log("stat-rendering-test: ok");
