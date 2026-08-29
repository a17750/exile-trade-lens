import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let focusIn;
class FakeHTMLElement {}

const context = vm.createContext({
  console,
  HTMLElement: FakeHTMLElement,
  window: {},
  document: {
    documentElement: { dataset: {} },
    addEventListener(name, callback) {
      if (name === "focusin") focusIn = callback;
    },
  },
});
vm.runInContext(
  fs.readFileSync(path.join(root, "extension/page/dropdown-search.js"), "utf8"),
  context,
  { filename: "dropdown-search.js" },
);

const storm = {
  type: "Jade Amulet",
  name: "Choir of the Storm",
  text: "暴風之語 (Choir of the Storm) Jade Amulet",
};
const destiny = {
  type: "Jade Amulet",
  name: "Defiance of Destiny",
  text: "拒絕命運 (Defiance of Destiny) Jade Amulet",
};
const multiselect = {
  search: "暴風",
  label: "text",
  options: [{ label: "Accessories", entries: [storm, destiny] }],
  groupValues: "entries",
  groupLabel: "label",
  customLabel(option) {
    return `${option.name} ${option.type}`;
  },
  _computedWatchers: {
    filteredOptions: {
      getter(instance) {
        const query = instance.search.toLowerCase();
        return instance.options[0].entries.filter((option) =>
          `${option.name} ${option.type}`.toLowerCase().includes(query));
      },
    },
  },
};

const rootElement = { __vue__: multiselect };
const input = new FakeHTMLElement();
input.classList = { contains: (name) => name === "multiselect__input" };
input.closest = (selector) => selector === ".multiselect" ? rootElement : null;
focusIn({ target: input });

const chineseResults = multiselect._computedWatchers.filteredOptions.getter(multiselect);
assert.equal(chineseResults.length, 2, "中文标签命中时应增加分组标题和原始选项");
assert.equal(chineseResults[0].$groupLabel, "中文匹配");
assert.equal(chineseResults[1], storm, "必须返回官方原始选项对象，不能创建自定义查询值");
assert.equal(storm.name, "Choir of the Storm");
assert.equal(storm.type, "Jade Amulet");
assert.match(
  context.window.__poe2zhDropdownSearch.searchableTextOf(multiselect, storm),
  /暴風之語/,
  "双语 text 必须独立进入搜索文本，不能依赖官网英文 customLabel",
);

multiselect.search = "Jade";
const englishResults = multiselect._computedWatchers.filteredOptions.getter(multiselect);
assert.deepEqual(englishResults, [storm, destiny], "英文原生结果必须保持原顺序且不能重复");
console.log("dropdown-search-test: ok");
