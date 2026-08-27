# 翻译获取、候选生成与审核流程

最后更新：2026-08-28

## 目标

这套流程把维护者从“逐条找译文”转变为“只审核不确定项”。正式译文必须来自可追踪来源；分词、术语组合、模糊匹配和 AI 只能生成候选，不得直接覆盖正式词库。

## 数据层级

```text
人工审核覆盖（稳定 ID + expectedEnglish）
  > 台服官方交易接口（相同稳定 ID）
  > 项目已有正式译文
  > 锁定版本的 poe-game-data 精确英文名称匹配
  > 完整短语例外
  > 已审核术语组合
  > 推断术语组合
  > 无翻译，保留英文并进入审核队列
```

“层级”决定来源能否使用，“置信度”只用于排列候选。低层级候选即使分数很高，也不能覆盖更高层级的正式译文。

## 文件职责

### 正式数据源

- `sources/translations.zh-TW.json`：一次性迁移后由本项目接管的基础正式词库。
- `sources/manual-overrides.json`：人工审核结果；稳定 ID 记录必须带 `expectedEnglish`。
- `sources/glossary.zh-TW.json`：可组合术语，区分 `reviewed` 与 `proposed`。
- `sources/phrase-exceptions.zh-TW.json`：不可拆分的完整短语和专有名称。
- `sources/source-lock.json`：第三方来源的仓库、commit、URL 和 SHA-256。
- `sources/upstream-baseline.en.json`：上一次已经确认的官方英文结构。
- `sources/external/poe-game-data.names.tw.json`：锁定版本的外部名称缓存。

### 生成结果

- `extension/data/bundled.json`：扩展运行时词库。
- `extension/data/bundled-manifest.json`：版本、大小和 SHA-256。
- `reports/upstream-current.en.json`：本次官方英文快照。
- `reports/upstream-diff.json`：相对已确认基线的新增、删除和改义。
- `reports/coverage-report.json`：按 items、stats、static、filters 统计覆盖率。
- `reports/quality-report.json`：阻断发布的问题。
- `reports/review-queue.json`：待人工处理的记录及候选。
- `reports/external-source-report.json`：外部名称自动应用及冲突。
- `reports/official-tw-current.json`：本次台服官方繁中规范化快照。
- `reports/official-tw-source-report.json`：稳定 ID 应用、拒绝项以及物品安全对齐结果。

## 一次完整构建

```powershell
node scripts/sync-external-sources.mjs
node scripts/build-data.mjs
node scripts/check-quality.mjs
node scripts/pipeline-test.mjs
node scripts/smoke-test.mjs
node scripts/background-smoke-test.mjs
```

流程如下：

1. 根据 `source-lock.json` 下载固定 commit 的 `poe-game-data`。
2. 校验下载内容的 SHA-256；不一致立即失败。
3. 获取官方 `items`、`stats`、`static`、`filters` 英文接口。
4. 获取台服官方繁中 `items`、`stats`、`static`、`filters` 接口。
5. 对 `stats`、`static`、`filters` 按稳定 ID 对齐，并校验 `#` 占位符和选项 ID。
6. 物品只在两端存在相同稳定 `id` 或唯一图片资源时自动采用；不按数组位置猜测。
7. 与 `upstream-baseline.en.json` 比较稳定 ID、英文和选项。
8. 按“人工覆盖 > 台服官方 > 项目基础词库 > 第三方补缺”合并。
9. 对缺失项尝试完整短语或最长术语组合。
10. 生成覆盖率、来源、质量报告和审核队列，通过门禁后才允许发布。

台服四个数据接口当前可匿名读取，因此构建和 GitHub Actions 不需要保存账号、Cookie 或 `POESESSID`。台服缺失的稳定 ID 不会删除已有译文；只保留回退结果并写入来源报告。

## 外部名称的自动采用条件

`poe-game-data` 目前只自动补充物品/技能名称，并且必须同时满足：

1. 来源锁定到 Git commit，而不是 `master`。
2. 下载文件 SHA-256 与锁文件完全一致。
3. 官方 Trade 当前确实存在该英文名称。
4. 英文经过大小写和连续空格规范化后完全一致。
5. 项目正式词库尚无该名称。

如果项目已有译文但外部译文不同，不覆盖，写入 `external-source-conflict` 审核记录。

## 术语组合

候选生成器使用最长匹配。例如：

```text
Abyssal Flail
  Abyssal -> 深淵（proposed，0.90）
  Flail   -> 鏈錘（reviewed，1.00）
  候选    -> 深淵鏈錘（0.81，needs-review）
```

完整短语优先于分词：

```text
Abyssal Signet -> 深淵之記
```

不会被组合成字面译文。任一单词无法覆盖时，不强行拼接，也不生成部分译文。

当前组合结果一律进入审核队列。未来只有同时满足“所有术语均为 reviewed、领域一致、没有例外、历史审核样本充足”时，才考虑开放自动采用。

## 质量门禁

以下问题会阻断发布：

- 稳定 ID 或选项 ID 的官方英文发生变化但尚未审核。
- 英文与译文中的 `#` 占位符数量不同。
- 人工覆盖的 `expectedEnglish` 与当前官方英文不一致。
- 外部文件版本或 SHA-256 不符合锁文件。
- 数据 schema 不兼容。

普通缺失不会破坏扩展；运行时会保留英文，但会进入审核队列。

## 审核一条翻译

物品名称：

```powershell
node scripts/review-translation.mjs item "Abyssal Flail" "深淵鏈錘"
```

稳定 ID 词缀：

```powershell
node scripts/review-translation.mjs stat "explicit.example_id" "增加 #% 火焰傷害"
```

筛选器：

```powershell
node scripts/review-translation.mjs filter "filter_id" "繁中译文"
```

筛选器或词缀选项使用 `条目ID:选项ID`：

```powershell
node scripts/review-translation.mjs filter-option "filter_id:option_id" "繁中译文"
```

命令会从当前官方快照读取英文，写入 `manual-overrides.json`，自动增加版本，并保存审核时间。随后重新运行构建。

如果外部来源与项目旧译文冲突：

- 接受外部译文：把外部候选作为命令的中文参数。
- 保留项目译文：把当前项目译文作为中文参数。

两种选择都会生成明确的人工记录，后续构建不再重复报告同一冲突。

## 审核官方英文变化

当 `upstream-diff.json` 出现 `changed`：

1. 查看稳定 ID、`previousEnglish`、当前英文和旧译文。
2. 判断是措辞调整还是含义变化。
3. 使用审核命令确认或修改译文。
4. 重新构建并运行 `check-quality.mjs`。
5. 阻断问题为零后更新基线：

```powershell
node scripts/update-baseline.mjs
```

禁止在未审核改义记录时直接更新基线，否则会丢失变化证据。

## 更新第三方来源

第三方仓库有新数据时：

1. 查询准备采用的 commit SHA。
2. 修改 `source-lock.json` 的 `ref` 和固定 commit URL。
3. 下载一次并计算新文件 SHA-256，写入锁文件。
4. 运行 `sync-external-sources.mjs` 验证。
5. 重新构建，审核新增自动补充和外部冲突。
6. 质量门禁及全部测试通过后发布。

GitHub Actions 以后只执行相同命令，不拥有额外的翻译决策权。

## GitHub 自动化

当前仓库为 `a17750/exile-trade-lens`，已经启用每日检查和远程词库发布：

### 每日检查

- 工作流保存在 `.github/workflows/translation-check.yml`。
- 定时运行构建。
- 上传 `reports/` 为 Actions artifact。
- 有官方改义或质量阻断时失败并通知。
- 只有普通缺失时成功，但在摘要中显示数量。

### 自动发布规则

- 定时运行或主分支手动触发。
- 同步锁定数据源、构建、质量检查和测试。
- 内容不变时不创建提交；内容变化时更新 `extension/data/` 并由 Actions 提交。
- `remote-manifest.json` 固定指向主分支的 `bundled.json`。
- 扩展只下载 JSON，并验证 SHA-256，不下载远程代码。
