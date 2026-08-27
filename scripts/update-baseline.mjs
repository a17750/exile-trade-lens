import path from "node:path";
import { readJson, reportsPath, sourcesPath, writeJson } from "./lib/project.mjs";

const initialize = process.argv.includes("--initialize");
const current = readJson(path.join(reportsPath, "upstream-current.en.json"));
const quality = readJson(path.join(reportsPath, "quality-report.json"));
const target = path.join(sourcesPath, "upstream-baseline.en.json");

if (!initialize && quality.blocking?.count) {
  throw new Error(`仍有 ${quality.blocking.count} 个阻断问题，不能更新官方英文基线`);
}
writeJson(target, current);
console.log(`${initialize ? "已初始化" : "已更新"}官方英文基线：${target}`);
