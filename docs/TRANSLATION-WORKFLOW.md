# 翻译获取与审核流程

最后更新：2026-08-30

## 目标

这套流程把维护者从“逐条找译文”转变为“只审核不确定项”。正式译文必须来自可追踪来源；分词、术语组合和模糊匹配不参与候选生成，AI 结果也不能直接覆盖正式词库。

提出的问题都不应以个例处理。用户给出的字符串或搜索页只用于复现和建立回归样本；修复必须落在共同的数据源、构建管线或运行时规则上，并验证受影响的整类输入。中英文片段混排属于错误翻译，完整可靠对照缺失时应整段保留英文。

> 状态说明：Trade API 与 GGPK 官方英繁配对都已并入构建。GGPK 当前负责基础物品、固定名称、
> 可完整解析的随机名称组件、被动技能名称，以及 `Domain=ITEM` 的魔法装备前后缀；GGPK `.csd` 的 stat description
> 仅在英繁模板数量、占位符和规范化英文都能唯一对应时补充，`/fetch` 的数值词条显示文本仍以稳定 ID 为主。
> 所有无法唯一确认的情况都保留英文并进入报告，详见 [翻译准确性审计与禁止猜译规则](TRANSLATION-ACCURACY-AUDIT.md)。

## 当前已实现的数据层级

```text
人工审核覆盖（稳定 ID + expectedEnglish）
  > 台服官方交易接口（相同稳定 ID）
  > 同版本 GGPK 英繁稳定配对（名称领域）
  > 无翻译，保留英文并进入审核队列
```

“层级”决定来源能否使用。可靠来源未命中时保留英文并进入审核队列，不自动生成候选。

当前构建器已经先按 `trade-stat`、`trade-filter`、`base-item`、`fixed-name`、
`word-component`、`item-affix` 和 `ui` 分域，再在同一领域内应用来源优先级。不存在一个可以跨领域覆盖所有
英文字符串的全局权重。旧 `items` 字段暂时作为兼容层保留。

## 当前 V2 数据层级

### Trade API 领域

```text
人工覆盖（稳定 Trade ID + expectedEnglish）
  > 台服 Trade API 相同稳定 ID
  > 项目已审核译文
  > 英文
```

### GGPK 游戏名称领域

```text
人工例外（GGPK 稳定键 + 源指纹）
  > 同版本英文/繁中 GGPK 按稳定键配对
  > 具备安全稳定键的台服 Trade 数据
  > 项目已审核译文
  > 英文
```

`BaseItemTypes` 负责基础类型，`Words` 负责固定名称或稀有命名组件，`Mods` 的 `ITEM` 领域负责魔法装备前后缀。三者不得写入同一个无领域的英文键空间。
`Words` 行号只用于同一游戏版本内的英繁配对；跨版本必须结合游戏指纹、词表类别和内容哈希，
不能把裸行号当作永久 ID。

## 文件职责

### 按来源区分的数据快照

- `data/trade-api.json`：最近一次通过稳定 ID、占位符和质量门禁的国际服/台服官方 Trade API 英繁快照及对齐结果。接口失败时只读回退，不能覆盖现有文件。
- `data/ggpk.json`：本机只读提取的官方游戏数据，按基础物品、名称组件、装备前后缀和客户端字符串分域。
- `data/ui.zh-TW.json`：项目维护的固定网页 UI 文本，不参与游戏数据和 Trade ID 对齐。

### 正式数据源

- `data/verified-labels.zh-TW.json`：早期经人工确认的稳定游戏属性标签；仍保留已有证据，不接收可由正式来源绑定的新字段。
- Trade API `equipment_filters`：通过双端稳定 ID 自动生成结果卡 `data-field` 注册表；其中与 GGPK `ClientStrings` 完整英文精确相交的条目，同时生成 `/fetch` 属性翻译。
- `data/item-fields.zh-TW.json`：只保存自动注册表覆盖不到的物品字段审核例外与别名；构建时仍验证来源英文，不把 UI 词库整体当作物品属性来源。
- `itemPropertyIndex`：构建器从 Trade API 稳定标签、带语义标记的 GGPK ClientStrings 和一致的完整官方佐证生成，仅供 `/fetch item.properties` 使用；不会写入全局 UI 精确词库。来源冲突保持英文，已知但未接入则阻断构建。
- `data/ui.zh-TW.json`：低风险固定界面词汇；只有 `Base Percentile` 等没有正式字段来源的明确标签可被物品字段绑定逐项引用。
- `data/manual-overrides.json`：人工审核结果；稳定 ID 记录必须带 `expectedEnglish`。
- `data/upstream-baseline.en.json`：上一次已经确认的官方英文结构。

### 已接入的 GGPK 数据

- `BaseItemTypes.datc64`：基础物品内部 ID 与本地化名称。
- `Words.datc64`：固定名称和随机名称组件。
- `Mods.datc64`：按稳定 Mod ID 配对 `Domain=ITEM`、`PREFIX/SUFFIX` 的官方英繁名称，写入 `data/ggpk.json` 的 `affixes` 区域。怪物、区域等其他领域不混入装备词缀表。
- `PassiveSkills.datc64`：同一行 ID 配对被动节点名称，写入 `passiveSkills`；完整节点名可生成 `Allocates <name>`，不做分词拼接。
- `data/statdescriptions/stat_descriptions.csd` 与 `passive_skill_stat_descriptions.csd`：UTF-16 描述模板的英繁配对，写入 `statDescriptions`。只收录唯一且占位符数量一致的模板；冲突留在 GGPK 来源报告，不进入运行时映射。

`Mods.Name` 可以直接解决 `Frosted`、`of Osmosis`、`of the Fletcher` 这类魔法物品标题组件。数值词条正文仍需要联合 `Stats` 与 stat descriptions；它与名称前后缀是两个独立领域。

正式提取器和规范化数据只允许位于本仓库的 `tools/ggpk/`、`data/ggpk.json`
和 `reports/`。原始 GGPK/Dat 文件不得进入 Git 或扩展包。

### 生成结果

- `extension/data/bundled.json`：扩展运行时词库。
- `extension/data/bundled-manifest.json`：版本、大小和 SHA-256。
- `reports/upstream-current.en.json`：本次官方英文快照。
- `reports/upstream-diff.json`：相对已确认基线的新增、删除和改义。
- `reports/coverage-report.json`：按 items、stats、static、filters 统计覆盖率。
- `reports/quality-report.json`：阻断发布的问题。
- `reports/review-queue.json`：待人工处理的缺失和改义记录；不自动附加翻译候选。
- `reports/bulk-backlog.json`：可批量处理的模板项，不混入人工主队列。
- `reports/official-tw-current.json`：本次台服官方繁中规范化快照。
- `reports/official-tw-source-report.json`：稳定 ID 应用、拒绝项以及物品安全对齐结果。
- `reports/ggpk-source-report.json`：只读安全结果、表指纹、覆盖率和冲突。

## 一次完整构建

### 当前命令

```powershell
.\tools\ggpk\run.ps1 -GamePath 'D:\games\Path of Exile 2\Content.ggpk'
node scripts/build-data.mjs
node scripts/check-quality.mjs
node scripts/pipeline-test.mjs
node scripts/smoke-test.mjs
node scripts/background-smoke-test.mjs
```

只需基于仓库内已验证的 `data/trade-api.json` 重建扩展产物、且不希望刷新官方接口快照时，使用：

```powershell
node scripts/build-data.mjs --cached-trade-api
```

流程如下：

1. 本机只读配对 GGPK 英文/繁中 `BaseItemTypes`、`Words`、`Mods`、`PassiveSkills`，解析 stat description CSD，并生成表指纹和规范化 JSON。
2. 获取官方 `items`、`stats`、`static`、`filters` 英文及台服繁中接口。
3. 对 `stats`、`static`、`filters` 按稳定 ID 对齐，并校验 `#` 占位符和选项 ID。
4. 物品只在两端存在相同稳定 `id` 或唯一图片资源时自动采用；不按数组位置猜测。
5. 与 `upstream-baseline.en.json` 比较稳定 ID、英文和选项。
6. 把 GGPK 名称映射写入相互隔离的运行域；被动节点仅生成完整 `Allocates`，CSD stat description 只填补官方台服缺失的稳定模板，绝不覆盖已有官方译文。
7. 生成覆盖率、来源、质量报告和审核队列，通过门禁后才允许发布。

GitHub 托管 Actions 只执行仓库数据构建阶段（上述第 2–7 步），因为它没有维护者本地已授权安装的 `Content.ggpk`。
不能把“本机 GGPK 自动提取”和“GitHub 每日构建”误写成同一个环境中的任务。

`review-queue.json` 只保留需要逐条判断的项目；`Allocates ...` 这类可由模板批量处理的词缀会移动到 `bulk-backlog.json`。这样队列数量代表实际人工工作量，而不是接口目录的总条目数。

扩展升级或打开健康检查页时，会自动清理旧版本遗留的目录预加载记录（`stat`、`item`、`static`、`filter` 且不是 `fetch:` 上下文）。真正来自交易结果的漏译记录会继续保留。

台服四个数据接口当前可匿名读取，因此构建和 GitHub Actions 不需要保存账号、Cookie 或 `POESESSID`。台服缺失的稳定 ID 不会删除已有译文；只保留回退结果并写入来源报告。

## 社区名称表

[seominugi/poe-game-data 的繁中名称表](https://github.com/seominugi/poe-game-data/blob/master/poe2/names/tw.json) 仅供维护者人工查阅。构建器不会下载、读取或采用其中的数据，也不会因为它与项目译文不同而制造审核任务。

## 缺失处理

官方 Trade API、同版本 GGPK、验证数据和已审核人工覆盖均未命中时，构建器不生成翻译建议；运行时保留完整英文，审核队列只记录稳定键、英文、领域和上下文。

## 质量门禁

以下问题会阻断发布：

- 稳定 ID 或选项 ID 的官方英文发生变化但尚未审核。
- 英文与译文中的 `#` 占位符数量不同。
- 人工覆盖的 `expectedEnglish` 与当前官方英文不一致。
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
