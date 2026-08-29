import crypto from "node:crypto";
import path from "node:path";
import { dataPath, readJson, writeJson } from "./lib/project.mjs";

const lock = readJson(path.join(dataPath, "source-lock.json"));
const source = lock.sources?.poeGameDataNamesTw;
if (!source?.url || !source.sha256 || !/^[a-f0-9]{40}$/.test(source.ref ?? "")) {
  throw new Error("source-lock.json 中的 poeGameDataNamesTw 未锁定到 Git commit");
}

const response = await fetch(source.url, {
  headers: { "User-Agent": "poe2-trade-zh-dataset-builder/0.4" },
});
if (!response.ok) throw new Error(`下载 poe-game-data 失败：HTTP ${response.status}`);
const text = await response.text();
const actualSha256 = crypto.createHash("sha256").update(text).digest("hex");
if (actualSha256 !== source.sha256) {
  throw new Error(`poe-game-data SHA-256 不匹配：${actualSha256}`);
}
const data = JSON.parse(text);
writeJson(path.join(dataPath, "external", "poe-game-data.names.tw.json"), data, {
  compact: true,
});
console.log(`external-source: ${Object.keys(data).length} 条，ref ${source.ref.slice(0, 12)}`);
