import path from "node:path";
import { readJson, reportsPath } from "./lib/project.mjs";

const report = readJson(path.join(reportsPath, "quality-report.json"));
if (report.blocking?.count) {
  console.error(`quality-gate: ${report.blocking.count} 个阻断问题`);
  for (const entry of report.blocking.placeholderErrors ?? []) {
    console.error(`- 占位符不一致 ${entry.domain}:${entry.key}`);
  }
  for (const entry of report.blocking.semanticChanges ?? []) {
    console.error(`- 官方英文变化 ${entry.key}: ${entry.previousEnglish} -> ${entry.english}`);
  }
  process.exitCode = 1;
} else {
  console.log("quality-gate: ok");
}
