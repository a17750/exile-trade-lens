# 流亡译镜开发进度

最后更新：2026-08-29

## 当前可交付版本

- 扩展版本：`0.5.8`
- 安装目录：`extension/`
- 压缩包：`poe2zh-extension-0.5.8.zip`
- 词库版本：`project-zhTW-1.labels-2.manual-7.renderings-1.terms-1.names-e10b747.ggpk-2ca5516d.tw-55587e59.data-2b7bf21d`
- 权限：`storage`、`alarms`
- 网站范围：POE 官网、GitHub Raw、jsDelivr

当前构建已经达到并超过本阶段“80% 可用率”目标：

| 领域 | 当前覆盖 |
|---|---:|
| 官方市集物品条目 | 99.92% |
| 官方市集属性条目 | 87.26% |
| 静态项目 | 100% |
| 筛选器标题 | 100% |
| 筛选器选项 | 100% |
| GGPK 基础物品可用映射 | 99.82% |
| GGPK 名称组件可用映射 | 98.96% |
| GGPK 装备前缀可用映射 | 93.89% |
| GGPK 装备后缀可用映射 | 94.02% |
| GGPK 客户端字符串可用映射 | 96.96% |

运行数据包含 4,445 条基础物品映射、3,138 条固定名称/名称组件映射、584 条装备前缀、487 条
装备后缀、7,136 条交易属性和 7,480 条动态界面精确对照。质量门禁阻断项为 0；逐条审核队列
为 187 条。

这些数字表示当前官方目录的静态覆盖，不等同于所有网页情境都已人工浏览验证。真实页面仍需在
每次游戏或交易站改版后回归。

## 本轮完成：官方 stat 特殊渲染与 `/fetch` 故障隔离

- 确认 `Always Poison on Hit with this weapon` 与目录模板
  `#% chance to Poison on Hit with this weapon` 共用稳定 ID `explicit.stat_3885634897`；这是官方针对
  100% 数值的特殊显示，不是普通漏译。
- 新增 `sources/verified-stat-renderings.zh-TW.json`，用英服和台服 `/fetch` 的相同 hash、query ID、
  item ID 和原始 description 保存可追溯证据。
- 运行时先在该 stable ID 内匹配特殊渲染，再走原有目录模板；绝不写入全局 `exact`，其他 ID 即使出现
  相同英文也不会套用。
- 撤回与本问题无关的 `grantedSkills` 运行时接入，避免一次修复同时扩大多个高准确性领域。
- `/fetch` 改为逐件克隆后原子翻译：一件物品字段异常时，该件完整保留英文，其他结果仍正常翻译；
  不再因单件异常放弃整批响应。
- 新增正例和错误-ID 反例测试，确保修复的是整类“同 ID 多渲染”机制而非页面样本特判。

## 本轮完成：输入污染守门与目录双语修复

- 新增 `extension/shared/missing-report-policy.js`，统一管理页面 API、DOM 和后台三层漏译来源。
- 输入型 combobox、autocomplete、ARIA 关联浮层和输入后动态下拉不会进入漏译记录。
- 不读取或保存输入值；只在内存中保留输入控件引用与事件时间。
- 静态 DOM 候选必须稳定 1.2 秒，并由后台再次校验来源和区域。
- 自动清理旧版本无来源的 `ui + dropdown-option` 污染记录。
- 修复官方物品目录只有 `type`、没有 `text` 时出现 `(undefined)`；双语英文回退使用
  `text ?? name + type`，全局格式化器也拒绝空英文。
- 每次扩展安装、升级或开发者模式重新加载都会清空上一代码批次的漏译记录；浏览器普通重启、
  Service Worker 唤醒和远程词库更新不会清空当前批次。

## 本轮完成：官方客户端名称接入

### 只读 GGPK 工具

- 正式工具位于 `tools/ggpk/`，项目唯一维护目录为 `D:\code\exile-trade-lens`。
- 使用只读文件流打开 `Content.ggpk`，不会写回、修复、压缩或替换游戏文件。
- 原始 `.datc64` 只在内存中处理，不写入仓库或扩展包。
- 运行前后比较游戏文件大小与修改时间；本轮两者完全一致。
- 依赖版本、哈希、补丁和许可证均已锁定并记录。
- 规范化数据输出到 `sources/generated/ggpk/`，报告输出到
  `reports/ggpk-source-report.json`。

本轮从同一客户端版本读取并配对：

- `BaseItemTypes`：基础物品名称。
- `Words`：固定名称及随机命名组件。
- `Mods`：已按稳定 Mod ID 配对 `Domain=ITEM` 的 `PREFIX/SUFFIX` 官方英繁名称；其他领域仍隔离。
- `ClientStrings`：按稳定字符串 ID 配对客户端展示模板；运行数据目前只选入已审核的
  `QualityItem`（`Superior {0} -> 精良的 {0}`）。

### 分域运行时

运行词库已经新增相互隔离的名称域：

- `baseItems`：只翻译 `item.baseType` 和明确的基础类型。
- `fixedNames`：翻译完整匹配的固定名称。
- `wordComponents`：只用于完整随机名称组合。
- `affixNames.prefixes/suffixes`：只用于魔法装备 `typeLine` 的完整前缀/底材/后缀组合。
- `itemDisplayTemplates.quality`：只用于普通品质物品 `typeLine` 的官方完整模板。

稀有名称采用 `Words` 的“整段覆盖”规则。魔法名称则用原始 `baseType` 切分，再分别匹配官方
`ITEM` 前缀和后缀；三部分全部存在才产生中文。无法完整匹配时保留英文，不做部分猜译。

已加入回归样本：

```text
Slim Mace   -> 纖細之錘
Golem Crack -> 魔像 裂骨錘
Composite Bow of the Fletcher -> 合成弓製箭者之
Frosted Recurve Bow of Osmosis -> 結霜的反曲弓逆滲透之
Superior Bombard Crossbow -> 精良的 轟擊十字弓
```

测试同时断言 `Golem Crack` 不能出现 `纖細之錘`，从机制上防止此前的跨领域误翻。

### 现有功能保留

- Manifest V3；仅中文/中英双语模式。
- Trade API 的 `items`、`stats`、`static`、`filters` 和 `/fetch` 翻译。
- 台服 Trade API 按稳定 ID 对齐。
- 内置词库、远程 JSON 更新、SHA-256 校验和失败回滚。
- 漏译检测、去重、角标、管理页、本地修正、忽略和安全导出。
- 排除输入框、卖家/交易内容、完整随机名称和已双语文本，避免污染漏译数据。
- `trade.js` 只作历史参考，不参与运行、构建或 GGPK 提取。

## 数据流程

```text
本机 Content.ggpk（只读）
  -> BaseItemTypes / Words / Mods ITEM 前后缀 / ClientStrings 规范化 JSON + 表指纹
国际服 Trade API + 台服 Trade API + 人工覆盖 + 锁定第三方源
  -> 分领域合并 + 冲突排除 + 质量门禁
  -> extension/data/bundled.json
  -> 扩展运行时按字段查对应领域
```

本机刷新 GGPK 数据：

```powershell
.\tools\ggpk\run.ps1 -GamePath 'D:\games\Path of Exile 2\Content.ggpk'
```

完整构建与验证：

```powershell
node scripts/sync-external-sources.mjs
node scripts/build-data.mjs
node scripts/check-quality.mjs
node scripts/pipeline-test.mjs
node scripts/smoke-test.mjs
node scripts/background-smoke-test.mjs
node --check extension/page/trade-hook.js
node --check extension/background/service-worker.js
```

本轮上述质量门禁、流水线测试、页面接口冒烟测试和后台自检测试全部通过。

## 尚未完成

- 用真实 Chrome 重新加载 `0.5.8`，逐项展开全部筛选组并执行搜索结果回归。
- 分析 `Words` 的类别和语言组合规则；当前安全策略只支持能够无缝整段覆盖的稀有名称。
- 将 `Mods`、`Stats` 和 stat descriptions 关联，进一步提高剩余数值属性翻译准确率；装备前后缀名称配对已经完成。
- 为 GGPK 规范化快照增加跨版本结构漂移门禁；当前已记录表哈希、行数和行宽。
- 决定本机游戏更新后的触发方式。GitHub Actions 没有本机 GGPK，因此只能消费已经提交的
  规范化数据，不能自行提取客户端文件。
- 完成真实页面回归后再考虑 Chrome 商店发布。

## 下一步建议

1. 在 `chrome://extensions` 刷新扩展，重新加载交易站。
2. 检查普通、魔法、稀有和暗金结果的 `name`、`baseType`、`typeLine`。
3. 展开 Item Category、Type Filters、Equipment Filters、Requirements、Endgame Filters、
   Miscellaneous 和 Trade Filters。
4. 导出一次新的漏译记录，确认只剩真实 UI/稳定 ID 缺失，没有搜索输入或随机物品名。
5. 真实页面通过后，再实现补丁检测和本机一键更新流程。

## 关键文件

- `tools/ggpk/README.md`：只读提取器用法和安全边界。
- `sources/generated/ggpk/manifest.json`：游戏表指纹、覆盖率和只读结果。
- `sources/generated/ggpk/base-items.zh-TW.json`：官方基础物品对照。
- `sources/generated/ggpk/words.zh-TW.json`：官方固定名/名称组件对照。
- `sources/generated/ggpk/affixes.zh-TW.json`：官方装备前后缀对照。
- `sources/generated/ggpk/client-strings.zh-TW.json`：官方客户端字符串对照；构建时按 ID 白名单选用。
- `sources/verified-stat-renderings.zh-TW.json`：英台官方 `/fetch` 成对验证的 stat 特殊显示形式。
- `scripts/build-data.mjs`：Trade 与 GGPK 数据构建。
- `extension/page/trade-hook.js`：接口翻译和名称分域解析。
- `extension/background/service-worker.js`：词库合并、更新、自检与本地修正。
- `reports/coverage-report.json`：当前官方目录覆盖率。
- `reports/ggpk-source-report.json`：GGPK 来源与冲突报告。
- `reports/review-queue.json`：需要逐条判断的项目。

## 安装

1. 打开 `chrome://extensions` 并开启开发者模式。
2. 加载已解压的 `extension` 目录，或刷新已经加载的扩展。
3. 关闭并重新打开 POE2 市集页面。
4. 点击工具栏中的“流亡译镜”；通过“查看漏译与修正”打开管理页，不要直接双击
   `health.html`。
