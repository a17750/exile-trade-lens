import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const scriptsPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const rootPath = path.resolve(scriptsPath, "..");
export const sourcesPath = path.join(rootPath, "sources");
export const reportsPath = path.join(rootPath, "reports");
export const extensionPath = path.join(rootPath, "extension");

export function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    if (arguments.length > 1) return fallback;
    throw new Error(`缺少 JSON 文件：${filePath}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeJson(filePath, value, { compact = false } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = compact ? JSON.stringify(value) : JSON.stringify(value, null, 2);
  fs.writeFileSync(filePath, `${body}\n`);
}

export function writeJsonAtomic(filePath, value, { compact = false } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = compact ? JSON.stringify(value) : JSON.stringify(value, null, 2);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, `${body}\n`);
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }
}

export function clone(value) {
  return structuredClone(value);
}
