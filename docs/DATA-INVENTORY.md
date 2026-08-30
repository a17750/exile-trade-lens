# 翻译数据文件清单

更新时间：2026-08-30

## 结论

根目录 `data/` 是项目唯一的数据输入目录，统一保存官方快照、项目译文、人工规则、审查证据、历史基线和来源治理信息。`extension/data/` 只保存由构建脚本生成、供浏览器扩展打包和运行时读取的产物，不得人工维护。

本次已清理三处重复 UI 数据：

- 历史 `trade.js` 迁移词库及其 UI 兼容数据已经完整移出构建。
- 将 `data/verified-labels.zh-TW.json` 中的 14 条 UI 翻译迁入 `data/ui.zh-TW.json`；该文件以后只保留经过审查的游戏属性标签及证据。
- 删除 `extension/content/bridge.js` 中 13 条硬编码 UI 备用翻译。扩展运行时只使用构建产物中的 `ui` 数据。

## 数据输入

| 文件 | 来源与职责 | 当前规模 |
| --- | --- | ---: |
| `data/ggpk.json` | 本机 `Content.ggpk` 只读提取的官方游戏文本 | 基础物品、词元、装备词缀、2,967 个被动节点和 10,355 条唯一 stat description 模板 |
| `data/trade-api.json` | 国际服与台服官方 Trade API 的成对快照、稳定 ID 对照和质量报告 | 6,608 个通过校验的分组/条目对照；物品因接口缺少稳定键，目前不自动对齐 |
| `data/ui.zh-TW.json` | 项目维护的网页界面短文本 | 73 条 |

构建脚本会将这些快照与下列审查和治理输入合并到 `extension/data/bundled.json`。

## 审查和治理输入

以下文件也全部位于 `data/`，但不代表相同优先级：

| 文件 | 类型 | 职责 |
| --- | --- | --- |
| `data/manual-overrides.json` | 人工覆盖 | 存放明确审查过、需要覆盖自动来源的少量例外；不能由快照自动重建。 |
| `data/verified-labels.zh-TW.json` | 人工审查证据 | 只保留稳定游戏属性标签和证据，不再保存 UI 翻译。 |
| `data/item-fields.zh-TW.json` | 物品字段审核例外 | `equipment_filters` 自动注册表之外的 `/fetch` 属性、DOM 标签与审核别名；不直接充当自由文本词库。 |
| `data/verified-stat-renderings.zh-TW.json` | 官方成对证据 | 保存同一 stable stat ID 的特殊渲染变体及英台 `/fetch` 证据。 |
| `data/upstream-baseline.en.json` | 差异基线 | 保存上次人工接受的官方英文结构，用于发现版本漂移；它不是运行翻译。 |

社区项目 [seominugi/poe-game-data](https://github.com/seominugi/poe-game-data/blob/master/poe2/names/tw.json) 仅作为人工查阅入口，不下载到仓库、不参与构建、不进入审核队列，也不具有翻译优先级。

另外，根目录的 `trade.js` 只是被 `.gitignore` 排除的本地参考材料，不参与构建、运行或翻译优先级，也不计入“待收纳”文件。

## 构建输出

- `extension/data/bundled.json`：扩展实际加载的合并词库。
- `extension/data/bundled-manifest.json`：内置词库摘要。
- `extension/data/remote-manifest.json`：远程更新清单。

这三个文件由 `scripts/build-data.mjs` 生成。它们可以提交和发布，但不是翻译数据源；任何人工改动都会在下次构建时被覆盖。

构建还会生成 `reports/item-property-resolution.json`，记录 `/fetch` 物品属性统一索引的候选、
来源冲突和 `knownButUnrouted`。该报告是审计产物，不参与运行；已知但未接入的数量不为零时
构建会直接失败。

## 历史词库策略

项目不再保留或读取 `data/translations.zh-TW.json`。官方、GGPK、验证数据和人工覆盖均未命中的文本必须保留英文并进入审核记录；不得为提高覆盖率重新引入无逐条证据的历史兜底。
