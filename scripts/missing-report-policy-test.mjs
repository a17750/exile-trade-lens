import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const context = vm.createContext({ clearTimeout, setTimeout });
vm.runInContext(
  fs.readFileSync(path.join(root, "extension/shared/missing-report-policy.js"), "utf8"),
  context,
  { filename: "missing-report-policy.js" },
);
const policy = context.POE2ZHMissingReportPolicy;

function fakeElement({ region, editable = false, id = "", component = null } = {}) {
  const element = {
    id,
    isConnected: true,
    textContent: "",
    matches(selector) {
      return editable && selector.includes("input:not");
    },
    closest(selector) {
      if (selector.includes("footer") || selector.includes("itemPopup")) return null;
      if (selector.includes("input:not") || selector.includes("textarea")) {
        return editable ? element : null;
      }
      if (selector.includes("[role='listbox'], [id]")) {
        return region === "dropdown-option" && id ? element : null;
      }
      if (selector.includes("[role='option']")) {
        return region === "dropdown-option" ? element : null;
      }
      if (selector.includes("[class*='filter']")) {
        return region === "filter-panel" ? element : null;
      }
      if (selector === "button") return region === "button" ? element : null;
      if (selector.includes("label, [role='combobox']")) {
        return region === "form-control" ? element : null;
      }
      if (selector.includes("[role='combobox']") && selector.includes("autocomplete")) {
        return component;
      }
      return null;
    },
    querySelector() { return null; },
    getAttribute() { return null; },
  };
  return element;
}

const editable = fakeElement({ editable: true });
Object.defineProperty(editable, "value", {
  get() { throw new Error("策略不得读取或保存用户输入值"); },
});
const portalOption = fakeElement({ region: "dropdown-option" });
const recentPortal = policy.classifyDomCandidate({
  raw: "Typed Search Fragment",
  element: portalOption,
  activeEditable: editable,
  lastEditableAt: 1_000,
  now: 1_100,
});
assert.equal(recentPortal.allow, false);
assert.equal(recentPortal.reason, "input-derived");

const staticOption = policy.classifyDomCandidate({
  raw: "Static Filter Option",
  element: fakeElement({ region: "dropdown-option" }),
  activeEditable: null,
  lastEditableAt: 0,
  now: 5_000,
});
assert.equal(staticOption.allow, true);
assert.equal(staticOption.source, "dom-static-ui");

const controller = fakeElement({ editable: true });
controller.getAttribute = (name) => name === "aria-controls" ? "suggestions" : null;
const controlledOption = fakeElement({ region: "dropdown-option", id: "suggestions" });
const controlled = policy.classifyDomCandidate({
  raw: "Autocomplete Candidate",
  element: controlledOption,
  documentRef: { querySelectorAll: () => [controller] },
  activeEditable: null,
  lastEditableAt: 0,
  now: 5_000,
});
assert.equal(controlled.allow, false);
assert.equal(controlled.reason, "input-derived");

assert.equal(
  policy.classifyDomCandidate({
    raw: "邪惡細杖 (undefined)",
    element: fakeElement({ region: "dropdown-option" }),
  }).reason,
  "transient-fragment",
);
assert.equal(policy.classifyReport({ source: "trade-api", type: "item" }).allow, true);
assert.equal(policy.classifyReport({ source: "trade-api", type: "ui" }).allow, false);
assert.equal(
  policy.classifyReport({ source: "dom-static-ui", type: "ui", region: "filter-panel" }).allow,
  true,
);
assert.equal(policy.classifyReport({ source: "dom-input-derived" }).allow, false);
assert.equal(
  policy.classifyReport({
    source: "item-card-field",
    type: "property",
    key: "data-field:reload_time",
    en: "Reload Time",
    region: "result-card",
  }).allow,
  true,
);
assert.equal(
  policy.classifyReport({
    source: "item-card-field",
    type: "property",
    key: "data-field:reload_time",
    en: "Reload Time: 0.75",
    region: "result-card",
  }).allow,
  false,
  "物品字段上报不得夹带动态数值",
);
assert.equal(policy.classifyReport({ source: "", region: "dropdown-option" }).allow, false);
assert.equal(
  policy.shouldDiscardStoredReport({ type: "ui", context: "dropdown-option" }),
  true,
);

const listeners = new Map();
const accepted = [];
const documentRef = {
  addEventListener(type, listener) { listeners.set(type, listener); },
  removeEventListener(type) { listeners.delete(type); },
  querySelectorAll() { return []; },
};
const guard = policy.createDomGuard({
  documentRef,
  onAccept: (report) => accepted.push(report),
  delayMs: 10,
  now: () => 10_000,
});
assert.equal(typeof listeners.get("compositionstart"), "function");
const button = fakeElement({ region: "button" });
button.textContent = "Stable Missing Button";
guard.consider(button.textContent, button, () => button.textContent);
await new Promise((resolve) => setTimeout(resolve, 25));
assert.equal(accepted.length, 1);
assert.equal(accepted[0].source, "dom-static-ui");

const pendingButton = fakeElement({ region: "button" });
pendingButton.textContent = "Canceled By Typing";
guard.consider(pendingButton.textContent, pendingButton, () => pendingButton.textContent);
listeners.get("input")({ target: editable });
await new Promise((resolve) => setTimeout(resolve, 25));
assert.equal(accepted.length, 1);
const blocked = guard.consider("Typed Candidate", portalOption, () => "Typed Candidate");
assert.equal(blocked.reason, "input-derived");
await new Promise((resolve) => setTimeout(resolve, 25));
assert.equal(accepted.length, 1);
guard.dispose();

console.log("missing-report-policy-test: ok");
