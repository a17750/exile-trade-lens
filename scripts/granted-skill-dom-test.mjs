import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataset = JSON.parse(fs.readFileSync(path.join(root, "extension/data/bundled.json"), "utf8"));
const events = [];
const annotations = [];
const context = vm.createContext({
  Node: { ELEMENT_NODE: 1 },
  CustomEvent: class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init?.detail; }
  },
  document: { dispatchEvent(event) { events.push(event); } },
});
context.POE2ZHOriginalTooltip = {
  annotate(element, original) { annotations.push({ element, original }); },
};
vm.runInContext(
  fs.readFileSync(path.join(root, "extension/page/domains/granted-skill.js"), "utf8"),
  context,
);
vm.runInContext(
  fs.readFileSync(path.join(root, "extension/content/granted-skill-fields.js"), "utf8"),
  context,
);
const renderer = vm.runInContext("globalThis.POE2ZHGrantedSkillFields", context);

function span(text, keyword = false) {
  return {
    tagName: "SPAN",
    textContent: text,
    classList: { contains(name) { return keyword && name === "keyword"; } },
  };
}

function skillElement(fieldId, labelText, valueText) {
  const label = span(labelText);
  const value = span(valueText, true);
  return {
    nodeType: 1,
    children: [{ tagName: "IMG", classList: { contains() { return false; } } }, label, value],
    get textContent() { return `${label.textContent}: ${value.textContent}`; },
    getAttribute(name) { return name === "data-field" ? fieldId : null; },
    closest() { return {}; },
    matches(selector) { return selector === "[data-field^='stat.skill.']"; },
    querySelectorAll() { return []; },
    label,
    value,
  };
}

renderer.configure({
  enabled: true,
  mode: "translated",
  domain: dataset.domains.grantedSkill,
  skillNames: dataset.baseItems,
  stats: dataset.stats.entries,
});
const solarOrb = skillElement("stat.skill.solar_orb", "Grants Skill", "Level 20 Solar Orb");
renderer.translateRoot(solarOrb);
assert.equal(solarOrb.label.textContent, "賦予技能");
assert.equal(solarOrb.value.textContent, "20 級 日耀球");
assert.equal(annotations.at(-1).original, "Grants Skill: Level 20 Solar Orb");
assert.equal(events.length, 0);

const unrelated = skillElement("stat.explicit.stat_123", "Grants Skill", "Level 20 Solar Orb");
renderer.translateRoot(unrelated);
assert.equal(unrelated.label.textContent, "Grants Skill");
assert.equal(unrelated.value.textContent, "Level 20 Solar Orb");

console.log("granted-skill-dom-test: ok");
