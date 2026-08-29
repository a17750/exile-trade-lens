# Stat 渲染变体人工维护流程

## 适用范围

当同一个交易 stat ID 在物品卡上出现不同官方文字时使用本流程，例如：

- `Has 1 Charm Slot`
- `Has 2 Charm Slots`

这类差异属于同一词条的官方渲染变体，不是新的全局词条，也不是可以由英文语法自动推导的内容。

## 文件职责

| 文件 | 只负责什么 |
| --- | --- |
| `sources/verified-stat-renderings.zh-TW.json` | 人工确认的变体、繁中译文及英/台官方证据 |
| `extension/page/stat-rendering.js` | 模板形状匹配和按 stat ID 选择变体 |
| `extension/page/trade-hook.js` | API 拦截、hash 与 stat ID 关联、数值回填 |
| `scripts/stat-rendering-test.mjs` | 复数、占位符和错误 ID 的回归测试 |

## 新增变体步骤

1. 从英服和台服官方交易站找到同一 stat ID 的物品 `/fetch` 结果。
2. 确认两边 `extended.hashes` 使用同一个 `stat.<stable-id>`，并记录 query ID、item ID 和原始 description。
3. 在 `statsById.<stable-id>.variants` 增加一条记录；`english`、`text` 必须是清理占位符后的正式文本，`evidence` 保留原始文本。
4. 确认英/繁中 `#` 占位符数量一致；同一英文变体不得对应两个译文。
5. 在 `scripts/stat-rendering-test.mjs` 增加至少一个具体数值用例和一个不应命中的相似句式。
6. 运行完整回归并检查质量报告为 0 个阻断项。

## 禁止事项

- 不在 `stat-rendering.js` 中加入 `Slot → Slots`、`1 → 复数` 等通用猜测规则。
- 不把变体写入全局 `exact`，避免被其他 stat ID 借用。
- 没有英/台官方成对证据时，不把截图观察直接写成正式词库条目。
- 不为 `2`、`3` 等具体数字分别创建条目；一个经官方确认的 `#` 复数模板应覆盖全部数值。

## 当前待办

`explicit.stat_1416292992` 已确认主模板为 `Has # Charm Slot → 有#個護符欄位`。其 `Has # Charm Slots` 变体仍待英/台官方 `/fetch` 成对证据；证据补齐后只需修改本流程指定的数据文件和测试文件，运行时代码无需再改。
