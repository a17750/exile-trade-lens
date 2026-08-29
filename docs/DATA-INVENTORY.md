# 翻译数据文件清单

更新时间：2026-08-29

## 结论

根目录 `data/` 是项目唯一的数据输入目录，统一保存官方快照、项目译文、人工规则、审查证据、历史基线和来源治理信息。`extension/data/` 只保存由构建脚本生成、供浏览器扩展打包和运行时读取的产物，不得人工维护。

本次已清理三处重复 UI 数据：

- 从 `data/translations.zh-TW.json` 删除已被 `data/ui.zh-TW.json` 完整覆盖的 42 条旧 UI 翻译。
- 将 `data/verified-labels.zh-TW.json` 中的 14 条 UI 翻译迁入 `data/ui.zh-TW.json`；该文件以后只保留经过审查的游戏属性标签及证据。
- 删除 `extension/content/bridge.js` 中 13 条硬编码 UI 备用翻译。扩展运行时只使用构建产物中的 `ui` 数据。

## 数据输入

| 文件 | 来源与职责 | 当前规模 |
| --- | --- | ---: |
| `data/ggpk.json` | 本机 `Content.ggpk` 只读提取的官方游戏文本 | 4,445 个基础物品英文键、3,138 个词元、1,071 个词缀名、8,201 个客户端字符串英文键 |
| `data/trade-api.json` | 国际服与台服官方 Trade API 的成对快照、稳定 ID 对照和质量报告 | 6,608 个通过校验的分组/条目对照；物品因接口缺少稳定键，目前不自动对齐 |
| `data/ui.zh-TW.json` | 项目维护的网页界面短文本 | 73 条 |

构建脚本会将这些快照与下列审查和治理输入合并到 `extension/data/bundled.json`。

## 审查和治理输入

以下文件也全部位于 `data/`，但不代表相同优先级：

| 文件 | 类型 | 职责 |
| --- | --- | --- |
| `data/translations.zh-TW.json` | 历史兼容基线 | 仍补充官方新数据源未覆盖的内容。现有 3,008 个物品键中有 447 个不在 GGPK 基础物品表；按 stable ID 交集统计，旧表中还有 1,338 个 stat、12 个 static 和 2 个 filter 条目未被当前 API 对照覆盖，不能整文件删除。其优先级低于官方稳定来源。 |
| `data/manual-overrides.json` | 人工覆盖 | 存放明确审查过、需要覆盖自动来源的少量例外；不能由快照自动重建。 |
| `data/verified-labels.zh-TW.json` | 人工审查证据 | 只保留稳定游戏属性标签和证据，不再保存 UI 翻译。 |
| `data/verified-stat-renderings.zh-TW.json` | 官方成对证据 | 保存同一 stable stat ID 的特殊渲染变体及英台 `/fetch` 证据。 |
| `data/glossary.zh-TW.json` | 候选术语规则 | 仅用于生成待审候选，不直接取得正式翻译优先权。 |
| `data/phrase-exceptions.zh-TW.json` | 候选短语规则 | 防止候选分词破坏固定短语，同样不直接进入正式词库。 |
| `data/source-lock.json` | 来源治理 | 锁定第三方仓库 commit、URL 与 SHA-256。 |
| `data/upstream-baseline.en.json` | 差异基线 | 保存上次人工接受的官方英文结构，用于发现版本漂移；它不是运行翻译。 |
| `data/external/poe-game-data.names.tw.json` | 生成缓存（Git 忽略） | 由 `source-lock.json` 指定版本下载并校验，作为低优先级第三方候选；可以重新生成。 |

另外，根目录的 `trade.js` 只是被 `.gitignore` 排除的本地参考材料，不参与构建、运行或翻译优先级，也不计入“待收纳”文件。

## 构建输出

- `extension/data/bundled.json`：扩展实际加载的合并词库。
- `extension/data/bundled-manifest.json`：内置词库摘要。
- `extension/data/remote-manifest.json`：远程更新清单。

这三个文件由 `scripts/build-data.mjs` 生成。它们可以提交和发布，但不是翻译数据源；任何人工改动都会在下次构建时被覆盖。

## 后续清理优先级

下一阶段唯一需要分批迁移的大文件是 `data/translations.zh-TW.json`。迁移必须按领域和稳定键进行，只有在某一条记录被 GGPK、官方 Trade API 或带证据的人工来源等价覆盖后才可删除。不能按文件年龄、字符串相似度或目录位置批量判定过时。

每次清理后都必须构建并执行物品、筛选项、属性/词缀和运行时挂钩回归；准确性优先于缩小文件体积。
