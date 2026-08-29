import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataset = JSON.parse(
  fs.readFileSync(path.join(root, "extension/data/bundled.json"), "utf8"),
);

const listeners = {};
const timers = [];
const sharedConfig = { textContent: "" };
let hook;

const context = vm.createContext({
  console,
  window: {},
  CustomEvent: class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  },
  setTimeout(callback) {
    timers.push(callback);
    return timers.length;
  },
  document: {
    documentElement: { dataset: {} },
    getElementById(id) {
      return id === "poe2zh-shared-config" ? sharedConfig : null;
    },
    addEventListener(name, callback) {
      listeners[name] = callback;
    },
    dispatchEvent() {},
  },
  ajaxHooker: {
    hook(callback) {
      hook = callback;
    },
    protect() {},
  },
});

vm.runInContext(
  fs.readFileSync(path.join(root, "extension/page/stat-rendering.js"), "utf8"),
  context,
  { filename: "stat-rendering.js" },
);
vm.runInContext(
  fs.readFileSync(path.join(root, "extension/page/trade-hook.js"), "utf8"),
  context,
  { filename: "trade-hook.js" },
);

const [itemEn, itemZh] = Object.entries(dataset.baseItems)[0];
const request = { url: "https://www.pathofexile.com/api/trade2/data/items" };
hook(request);
const response = {
  responseText: JSON.stringify({
    result: [{ id: "test", entries: [{ type: itemEn, text: itemEn }] }],
  }),
};

let settled = false;
const pendingResponse = request.response(response).then(() => {
  settled = true;
});
await Promise.resolve();

// Simulate every registered timeout firing before the bridge publishes the
// dataset. Catalog responses must still remain pending instead of leaking the
// untranslated English catalog into the site's page-lifetime cache.
for (const callback of timers.splice(0)) callback();
await Promise.resolve();
assert.equal(settled, false, "物品目录不能在词库就绪前以英文放行");

sharedConfig.textContent = JSON.stringify({
  dataset,
  enabled: true,
  mode: "bilingual",
});
listeners["poe2zh:configure"]();
await pendingResponse;

assert.match(
  JSON.parse(response.responseText).result[0].entries[0].text,
  new RegExp(itemZh),
  "冷启动后的物品目录必须支持中文搜索",
);
console.log("search-cold-start-test: ok");
