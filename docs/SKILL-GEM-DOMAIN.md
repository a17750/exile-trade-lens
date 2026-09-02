# 技能宝石领域

技能宝石不是“若干可全局替换的英文”。它是 `/api/trade2/fetch` 中独立的物品聚合，当前以
`frameType=4` 或 `frameTypeId=Gem` 作为领域边界。运行时入口是
`extension/page/domains/skill-gem.js`，构建期规则位于 `scripts/domains/skill-gem.mjs`。

## 领域模型

- 聚合根 `SkillGemItem`：负责确认整张卡片确实属于技能宝石；领域规则不得作用于装备、通货或筛选器。
- 值对象 `SkillTag`：每个 `[semanticId|displayText]` 都是独立标签，例如 `AoESkill|AoE`；以稳定语义 ID 查表，英文显示词只用于 GGPK 后备与上报。
- 值对象 `ResourceCost`：保存数值与资源类型，例如 `108 Ward`；数值原样保留，资源名使用官方对照。
- 值对象 `GemProperty`：技能宝石专属标签，例如 `Attack Time`、`Attack Damage` 和 `Cooldown Time`。
- 领域服务 `SkillGemRenderer`：协调标签、属性与数值模板；通用属性渲染器只处理它没有接管的字段。

## 数据来源与优先级

项目级规则见 [翻译来源优先级](SOURCE-PRIORITY.md)。本领域的目标顺序是：

1. 同版本 GGPK `GemTags` 英繁表按稳定语义 ID 配对；构建产物为 `ggpk.skillGemTags.bySemanticId`，是标签主源。
2. GGPK `ClientStrings` 与 CSD：提供属性标签、资源名、数值模板及可唯一确认的语义标记。
3. `data/skill-tags.zh-TW.json`：台服 `/fetch` 的 `semanticId → 繁中` 直接证据，仅用于校验 GGPK，以及补齐 GGPK 当前版本确实没有的 ID。
4. 未命中时保留英文并逐标签上报。

构建时先装载全部 GGPK 标签；Trade 同 ID 同译文记为校验通过，同 ID 冲突时保留 GGPK 并写入
`reports/skill-gem-domain-report.json`，只有 GGPK 缺少该 ID 时才接受 Trade 补位。CSD 链接词只作为
`semanticId + 英文显示文本` 的末级精确后备，不会覆盖 `GemTags`。

当前审核示例：

| 英文结构 | 官方繁中 | 证据 |
| --- | --- | --- |
| `AoESkill|AoE` | `範圍效果` | GGPK `GemTags`；Trade 校验 |
| `DurationSkill|Duration` | `持續時間` | GGPK `GemTags`；Trade 校验 |
| `Sustained|Sustained` | `持續性` | GGPK `GemTags`；Trade 校验 |
| `Channelling|Channelling` | `引導` | GGPK `GemTags`；Trade 校验 |
| `Travel|Travel` | `快行` | GGPK `GemTags`；Trade 校验 |

这些记录属于技能宝石领域证据，不进入通用 UI 词库，也不能用于普通英文句子的分词替换。

## 不变量

- 只处理技能宝石聚合；相同的 `Cost` 或 `Attack` 出现在其他领域时不受影响。
- 标签先逐个解析，再按稳定语义 ID 独立匹配；全部命中才整体渲染，未知标签逐 ID 上报且整行保留英文。
- 属性标签必须通过已审核的 `ClientStrings.Id` 构建，客户端不根据英文语法推测译文。
- 数值、百分比和等级不得被改写；复合消耗按逗号拆成资源组件，每个组件只套用带 `{0}` 的官方 `ClientStrings` 模板。
- 资源名未知时保留原值并上报，禁止输出“已翻译标签 + 未知资源猜译”。
- 领域已接管的属性不会再次进入通用属性渲染器，防止二次翻译和误报。

## 扩展新字段

游戏更新后先关闭游戏与启动器更新进程，执行：

```powershell
.\tools\ggpk\run.ps1 -GamePath 'D:\games\Path of Exile 2\Content.ggpk'
```

该命令会在同一次只读提取中读取英文与繁中 `GemTags.datc64`，更新 `data/ggpk.json` 的
`skillGemTags` 与表哈希。随后运行完整回归；不得只更新 Trade 样本而跳过 GGPK 提取。

新增技能标签时，先确认 GGPK 已提取该语义 ID，再用英服/台服 `/fetch` 对同一 ID 做校验；只有 GGPK
确实缺少时才将 Trade 证据作为补位加入 `data/skill-tags.zh-TW.json`。`scripts/audit-skill-gem-corpus.mjs`
会阻断真实首屏样本中的未知标签。新增属性时必须
记录对应 `ClientStrings.Id`、英文断言和繁中断言。任何一项断言随游戏版本漂移都会阻断构建。
