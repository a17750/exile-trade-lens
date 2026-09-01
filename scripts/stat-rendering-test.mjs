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
console.log("stat-rendering-test: ok");
