# 回归自检流程

这份流程用于防止一次修复物品名称后，又意外破坏筛选项、属性词缀或页面消息链路。它和翻译来源审核分开：回归自检回答“现有功能有没有被破坏”，来源审核回答“译文是否可信”。

## 什么时候必须执行

以下任一类变更完成后，必须执行完整回归套件：

- `extension/page/`、`extension/background/`、`extension/content/` 的运行时代码；
- `extension/data/`、`sources/`、`scripts/`、manifest 或数据构建流程；
- 物品名称、底材、固定名、前后缀、筛选分组/选项、属性/词缀、`/fetch` 拦截和 bridge；
- 扩展版本、打包流程或漏译收集策略。

只改说明文档时不需要重跑完整套件，但下一次代码变更仍要执行。

## 一键执行

在仓库根目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File .agents/skills/poe2-trade-regression/scripts/run-regression.ps1
```

如果只想检查当前已生成数据、不重新构建：

```powershell
powershell -ExecutionPolicy Bypass -File .agents/skills/poe2-trade-regression/scripts/run-regression.ps1 -SkipBuild
```

执行顺序是：运行时语法检查 → 数据构建 → 质量门禁 → 数据管线 → 物品/筛选/属性 smoke test（包含中文目录别名与搜索请求英文还原）→ 中文物品搜索冷启动测试 → background test → page/background bridge test → `git diff --check`。任一命令失败都视为阻断，不得通过手工改生成文件掩盖失败。

## 检查矩阵

| 范围 | 必须确认的行为 | 主要检查 |
| --- | --- | --- |
| 物品 | 已知名称、底材、固定名和完整稀有名称仍可翻译；未知名称保留英文；不出现 `(undefined)` 或中英拼接 | `smoke-test.mjs`、`item-label-dom-smoke-test.mjs`、质量报告 |
| API 目录缓存 | 扩展冷启动时目录必须等词库就绪；目录结构升级时只失效 `items/stats/data/filters` 八个精确缓存键一次，避免展开与选中状态使用不同语言模型 | `search-cold-start-test.mjs`、`smoke-test.mjs` |
| 中文下拉匹配 | 目录 `name/type` 使用可逆双语别名供官网原生过滤；发出 `/search` 前必须精确还原官方英文，未知格式原样放行 | `smoke-test.mjs` |
| 筛选项 | 分组、选项和动态下拉值都是字符串；缺失映射不会把 `undefined` 写进 DOM | `smoke-test.mjs`、DOM 采集规则 |
| 属性/词缀 | 按稳定 stat id 绑定；数值和占位符保留；替代英文渲染只对声明的 id 生效；单复数等变体必须有独立官方证据；未知 id 回退原文 | `smoke-test.mjs`、`stat-rendering-test.mjs`、`pipeline-test.mjs` |
| `/fetch` | 单个坏条目不会取消同批其他条目的翻译；可选字段异常时保留源对象 | `trade-hook.js`、`smoke-test.mjs` |
| bridge | 页面环境和 service worker 的消息可达；上下文失效时不产生未处理 Promise 错误 | `background-smoke-test.mjs`、`bridge-context-smoke-test.mjs` |
| 漏译收集 | 排除输入值、自动完成行、双语文本和瞬时片段；只记录稳定且可复现的 UI 文本 | `MISSING-REPORT-POLICY.md`、质量报告 |

## 交付前人工验证

本地套件通过后，刷新解压扩展并重新打开交易页，至少验证：

1. 一个普通/暗金物品名称；
2. 一个筛选分组及其下拉选项；
3. 一个带数值的属性或词缀；
4. 一个未知文本，确认它保留英文并进入合规的漏译记录。

人工浏览器验证必须单独记录，因为它依赖当前登录状态、页面缓存和上游页面结构，不能由 Node smoke test 代替。

## 报告与判定

重点查看：

- `reports/coverage-report.json`：覆盖率和缺失数量；
- `reports/quality-report.json`：阻断质量问题必须为 0；
- `reports/review-queue.json`：需要人工审核的候选，不等于已确认译文；
- `reports/official-tw-source-report.json`、`reports/ggpk-source-report.json`：来源版本和提取状态。

“通过”只表示没有发现回归，不表示所有英文都已经翻译。低可信候选必须继续保留原文，不能为了提高覆盖率而猜测。
