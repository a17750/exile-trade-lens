const DEFAULT_SETTINGS = { enabled: true, mode: "bilingual" };
const enabled = document.querySelector("#enabled");
const mode = document.querySelector("#mode");
const version = document.querySelector("#version");
const status = document.querySelector("#status");
const update = document.querySelector("#update");

async function init() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  enabled.checked = settings.enabled;
  mode.value = settings.mode;
  const response = await chrome.runtime.sendMessage({ type: "POE2ZH_GET_DATASET" });
  if (response?.ok) version.textContent = `词库：${response.dataset.datasetVersion}`;
  const health = await chrome.runtime.sendMessage({ type: "POE2ZH_GET_HEALTH" });
  if (health?.ok) {
    const pending = health.records.filter((record) => !record.ignored).length;
    document.querySelector("#health").textContent = `漏译自检：${pending} 条待处理，${health.overrideCount} 条本地修正`;
  }
  const local = await chrome.storage.local.get("updateStatus");
  status.textContent = local.updateStatus?.message ?? "当前使用内置词库";
}

enabled.addEventListener("change", () => chrome.storage.sync.set({ enabled: enabled.checked }));
mode.addEventListener("change", () => chrome.storage.sync.set({ mode: mode.value }));
update.addEventListener("click", async () => {
  update.disabled = true;
  status.textContent = "正在检查…";
  const result = await chrome.runtime.sendMessage({ type: "POE2ZH_CHECK_UPDATE" });
  status.textContent = result.message;
  update.disabled = false;
  await init();
});
document.querySelector("#options").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.querySelector("#health-page").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("health/health.html") });
});
init();
