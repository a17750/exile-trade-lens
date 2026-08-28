# 流亡译镜开发进度

最后更新：2026-08-29

## 当前可交付版本

- 扩展版本：`0.5.0`
- 安装目录：`extension/`
- 压缩包：`poe2zh-extension-0.5.0.zip`
- 词库版本：`project-zhTW-1.manual-7.terms-1.names-e10b747.ggpk-e9052386.tw-e96cf5bd.data-4e3eabed`
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

运行数据包含 4,445 条基础物品映射、3,138 条固定名称/名称组件映射、7,136 条交易属性和
7,459 条动态界面精确对照。质量门禁阻断项为 0；逐条审核队列为 187 条，批量积压 991 条。

这些数字表示当前官方目录的静态覆盖，不等同于所有网页情境都已人工浏览验证。真实页面仍需在
每次游戏或交易站改版后回归。

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
- `Mods`：本轮只记录表结构和指纹，尚未生成显示文本。

### 分域运行时

运行词库已经新增三个相互隔离的域：

- `baseItems`：只翻译 `item.baseType` 和明确的基础类型。
- `fixedNames`：翻译完整匹配的固定名称。
- `wordComponents`：只用于完整随机名称组合。

随机名称采用“整段覆盖”规则：动态规划必须从第一个字符一直匹配到最后一个字符，且每个组件都
来自官方同版本 `Words` 配对，才会产生中文。无法完整匹配时保留英文，不做部分猜译，也不会借用
基础物品译文。

已加入回归样本：

```text
Slim Mace   -> 纖細之錘
Golem Crack -> 魔像 裂骨錘
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
  -> BaseItemTypes / Words 规范化 JSON + 表指纹
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

- 用真实 Chrome 重新加载 `0.5.0`，逐项展开全部筛选组并执行搜索结果回归。
- 分析 `Words` 的类别和语言组合规则；当前安全策略只支持能够无缝整段覆盖的名称。
- 将 `Mods`、`Stats` 和 stat descriptions 关联，进一步提高剩余属性翻译准确率。
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
