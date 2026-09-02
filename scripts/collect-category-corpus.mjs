import path from "node:path";
import {
  categorySearchBody,
  categoryTasks,
  sanitizeFetchResult,
} from "./lib/category-corpus.mjs";
import { dataPath, readJson, writeJsonAtomic } from "./lib/project.mjs";

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const locale = argument("--locale", "en");
const league = argument("--league", locale === "en" ? "Runes of Aldur" : "阿德爾的符文");
const onlyCategory = argument("--category");
// One trade result page is rendered in batches of ten. Keeping the corpus at
// that boundary gives every category equal weight and avoids turning a smoke
// corpus into an API crawl.
const pageSize = Number(argument("--page-size", "10"));
const requestDelayMs = Number(argument("--request-delay-ms", "350"));
const CORPUS_SCHEMA_VERSION = 2;
if (!['en', 'zh-TW'].includes(locale)) throw new Error("--locale 仅支持 en 或 zh-TW");
if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
  throw new Error("--page-size 必须在 1 到 100 之间");
}

const host = locale === "en" ? "https://www.pathofexile.com" : "https://pathofexile.tw";
const realm = "poe2";
const encodedLeague = encodeURIComponent(league);
const tradeApi = readJson(path.join(dataPath, "trade-api.json"));
const allTasks = categoryTasks(tradeApi, pageSize);
writeJsonAtomic(path.join(dataPath, "corpus", "category-tasks.json"), {
  schemaVersion: CORPUS_SCHEMA_VERSION,
  source: "data/trade-api.json#type_filters.category",
  realm,
  pageSize,
  summary: {
    total: allTasks.length,
    controls: allTasks.filter((task) => task.nodeType === "control").length,
    aggregates: allTasks.filter((task) => task.nodeType === "aggregate").length,
    leaves: allTasks.filter((task) => task.nodeType === "leaf").length,
  },
  tasks: allTasks,
});
const tasks = onlyCategory ? allTasks.filter((task) => task.categoryId === onlyCategory) : allTasks;
if (!tasks.length) throw new Error(`找不到分类任务：${onlyCategory}`);

const corpusPath = path.join(dataPath, "corpus", `category-pages.${locale}.json`);
const previous = readJson(corpusPath, null);
const corpus = previous ?? {
  schemaVersion: CORPUS_SCHEMA_VERSION,
  locale,
  realm,
  league,
  source: `${host}/api/trade2/{search,fetch}`,
  privacy: {
    listingRemoved: true,
    accountRemoved: true,
    priceRemoved: true,
    sessionDataStored: false,
  },
  tasks: {},
};
for (const record of Object.values(corpus.tasks ?? {})) delete record.searchId;
writeJsonAtomic(corpusPath, corpus);

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function requestJson(url, options = {}, attempt = 0) {
  let response;
  try {
    response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(30_000),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "exile-trade-lens-category-corpus/0.1",
        ...(options.headers ?? {}),
      },
    });
  } catch (error) {
    if (attempt >= 4) throw error;
    await sleep((attempt + 1) * 2000);
    return requestJson(url, options, attempt + 1);
  }
  if (response.status === 429 && attempt < 5) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "2");
    const waitSeconds = Math.min(30, Math.max(2, Number.isFinite(retryAfter) ? retryAfter : 2));
    console.warn(`  [rate-limit] ${waitSeconds}s 后重试 (${attempt + 1}/5)`);
    await sleep(waitSeconds * 1000);
    return requestJson(url, options, attempt + 1);
  }
  if (!response.ok) throw new Error(`${url} 返回 HTTP ${response.status}`);
  return response.json();
}

async function collect(task) {
  const searchUrl = `${host}/api/trade2/search/${realm}/${encodedLeague}`;
  const search = await requestJson(searchUrl, {
    method: "POST",
    body: JSON.stringify(categorySearchBody(task.categoryId)),
  });
  const ids = (search.result ?? []).slice(0, task.pageSize);
  const samples = [];
  for (let index = 0; index < ids.length; index += 10) {
    const batch = ids.slice(index, index + 10);
    const fetchUrl = `${host}/api/trade2/fetch/${batch.join(",")}?query=${encodeURIComponent(search.id)}`;
    const response = await requestJson(fetchUrl);
    for (const result of response.result ?? []) {
      if (result?.item) samples.push(sanitizeFetchResult(result));
    }
    console.log(`  [batch] ${task.categoryId} ${Math.min(index + batch.length, ids.length)}/${ids.length}`);
    await sleep(requestDelayMs);
  }
  return {
    ...task,
    total: search.total ?? ids.length,
    requested: ids.length,
    captured: samples.length,
    status: samples.length || ids.length === 0 ? "complete" : "empty-fetch",
    capturedAt: new Date().toISOString(),
    samples,
  };
}

for (const task of tasks) {
  const existing = corpus.tasks[task.categoryId];
  const hasAlignmentKeys = existing?.samples?.every((sample) => sample.alignmentKey);
  if (existing?.status === "complete" && existing.pageSize === pageSize && hasAlignmentKeys) {
    console.log(`[skip] ${task.categoryId} ${task.englishLabel}`);
    continue;
  }
  try {
    const result = await collect(task);
    corpus.tasks[task.categoryId] = result;
    console.log(`[${result.status}] ${task.categoryId} ${result.captured}/${result.requested} total=${result.total}`);
  } catch (error) {
    corpus.tasks[task.categoryId] = {
      ...task,
      status: "error",
      error: String(error?.message ?? error),
      capturedAt: new Date().toISOString(),
      samples: [],
    };
    console.warn(`[error] ${task.categoryId}: ${error?.message ?? error}`);
  }
  corpus.updatedAt = new Date().toISOString();
  corpus.schemaVersion = CORPUS_SCHEMA_VERSION;
  writeJsonAtomic(corpusPath, corpus);
  await sleep(requestDelayMs);
}

const values = Object.values(corpus.tasks);
console.log(JSON.stringify({
  locale,
  tasks: values.length,
  complete: values.filter((task) => task.status === "complete").length,
  errors: values.filter((task) => task.status === "error").length,
  samples: values.reduce((sum, task) => sum + (task.captured ?? 0), 0),
}, null, 2));
