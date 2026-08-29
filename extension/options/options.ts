const DEFAULTS = {
  remoteManifestUrl:
    "https://raw.githubusercontent.com/a17750/exile-trade-lens/main/extension/data/remote-manifest.json",
  autoUpdate: true,
};
const url = document.querySelector("#url");
const auto = document.querySelector("#auto");
const status = document.querySelector("#status");

async function init() {
  const settings = await chrome.storage.sync.get(DEFAULTS);
  url.value = settings.remoteManifestUrl;
  auto.checked = settings.autoUpdate;
}

document.querySelector("#save").addEventListener("click", async () => {
  const value = url.value.trim();
  if (value) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:") throw new Error();
    } catch {
      status.textContent = "请输入有效的 HTTPS 地址";
      return;
    }
  }
  await chrome.storage.sync.set({ remoteManifestUrl: value, autoUpdate: auto.checked });
  status.textContent = "已保存";
});
init();
