# GGPK 分类覆盖与提取路线图

## 结论

继续修正零散翻译前，应先提高 GGPK 的数据域覆盖。目标不是无选择地导出整个 GGPK，而是以
Trade `Item Category` 为锚点，提取翻译所需的稳定文本、内部 ID 和表间关系。

当前最大的缺口不是单纯“缺少中文文本”，而是缺少以下关系：

1. `BaseItemTypes → ItemClasses / WeaponTypes / ArmourTypes`。
2. `物品或词缀 → Stats / GrantedEffects`。
3. `SkillGems → GemEffects → GemTags / ActiveSkills`。

关系缺失时，即使 GGPK 已经包含官方译文，构建器也无法确认页面字段应连接到哪条记录，只能退回
Trade API、项目审核项或英文原文。

## 当前已提取范围

`tools/ggpk/Program.cs` 当前读取 14 个 GGPK 内部文件，并生成以下数据域：

- `BaseItemTypes`：基础物品名称。
- `Words`：固定名称与名称组件。
- `Mods`：目前只保留 `Domain=ITEM` 的装备前缀和后缀名称。
- `ClientStrings`：客户端固定文本；构建器只按领域选择允许使用的稳定 ID。
- `PassiveSkills`：被动节点名称。
- `GemTags`：技能宝石标签；当前 55 个稳定语义 ID 的英繁配对覆盖率为 100%。
- `stat_descriptions.csd` 与 `passive_skill_stat_descriptions.csd`：属性描述及渲染变体。
- `linkedTerms`：从 CSD 语义标记派生的精确后备数据。

提取器是可独立重复执行的只读程序，但当前读取表仍是代码中明确声明的小集合，不会自动发现并
导出所有与 Item Category 有关的表。

## 按 Item Category 的缺口

| 分类 | 已提取 | 尚未提取或尚未建立关联 |
| --- | --- | --- |
| 武器、护甲、饰品、珠宝 | 基底名称、名称组件、装备前后缀、部分属性模板 | `ItemClasses`、`WeaponClasses`、`WeaponTypes`、`ArmourTypes`、`Stats`，以及基底、类别和固有属性之间的关系 |
| 自带技能的装备 | 部分技能名称可由 `BaseItemTypes` 确认 | `ItemInherentSkills`、`ModGrantedSkills`、`ActiveSkills`、`GrantedEffects`、`GrantedEffectsPerLevel` |
| 技能宝石 | `GemTags` 已提取并作为标签主源 | `SkillGems`、`GemEffects`、`ActiveSkills`、`GrantedEffects`、`SupportGems`、`UncutGems`、`SkillGemSearchTerms`，以及宝石、标签、属性和说明之间的关系 |
| 药剂、护符 | 基底名称、部分词缀、原始 `ClientStrings` | `Flasks`、`UtilityFlaskBuffs`；充能、持续时间、恢复量等模板仍需领域化接入 |
| 异界、换界石、碑牌 | 基底名称和部分 stat description | `Maps`、`MapTiers`、`EndgameMaps`、`EndgameMapTablets`、`MapFragmentMods` |
| 日志、试炼、遗物 | 少量基底名称 | `ExpeditionAreas`、`Ultimatum*`、`Sanctum*`、`RelicItemEffectVariations` |
| 通货 | 基底名称 | `CurrencyItems`、`CurrencyUseEffects`、`CurrencyUseEffectsFromItem` |
| 符文、灵魂核心 | 基底名称、部分属性文本 | `Expedition2Runes`、`RitualRuneTypes`、`SoulCores`、`SoulCoreStats`、`SoulCoreTypes` |
| Idol、Omen | 主要只有基底名称和 Trade 结构 | 当前本地 schema 没有明确同名表；必须先枚举当前 GGPK 索引，确认实际表名，不得猜测 |

表名来自项目当前锁定的 PoE2 schema，只表示下一步调查入口。接入前仍须确认这些表确实存在于
用户当前版本的 `Content.ggpk`，并验证英文/繁中表结构和稳定键。

## 语料给出的优先方向

现有分类语料包含 64 个 Trade 分类和 600 件首屏样本。最近一次英文结构审计覆盖率约为
93.78%，剩余 162 种未解析签名主要集中于：

- 药剂和护符的充能、恢复、持续时间属性。
- 通货、符文、灵魂核心和 Idol 的用途及装备部位效果。
- 换界石、碑牌、日志、试炼和遗物的专属属性。
- 技能宝石的属性、说明和完整技能关系。
- 当前 `Mods` 提取范围之外的非普通装备词缀域与生成类型。

分类语料是覆盖信号，不是正式翻译源；其中的未解析签名不能直接写入运行词库。

## 后续实施顺序

1. 为 GGPK 工具增加只读索引盘点输出，确认候选表在当前版本中的真实路径和英繁表对。
2. 提取 `ItemClasses`、`WeaponTypes`、`ArmourTypes` 和 `Stats`，建立装备基础结构。
3. 补全 `SkillGems → GemEffects → ActiveSkills / GrantedEffects → GemTags` 技能链。
4. 接入 `Flasks` 领域，优先解决分类语料中最集中的属性模板缺口。
5. 接入地图、碑牌、日志、试炼和遗物领域。
6. 接入通货、符文和灵魂核心领域。
7. 根据 GGPK 索引定位 schema 尚未覆盖的 Idol、Omen 数据表。
8. 每完成一个领域，重新生成 `data/ggpk.json`，运行分类语料审计与完整回归，再决定是否需要
   Trade 第二梯队补位。

## 安全和准确性约束

- `Content.ggpk` 始终以 `FileAccess.Read` 打开，不写入游戏目录，也不修改游戏文件。
- 新表必须记录路径、哈希、行数、行大小和覆盖率。
- 英文与繁中表必须按稳定键配对；禁止按相似文字或页面位置猜测。
- schema 漂移、稳定键不一致、一对多冲突或占位符变化必须中止相应数据域构建。
- GGPK 为第一梯队；Trade API 只校验相同稳定键，或补齐 GGPK 确认缺失的数据。
- 未确认的内容保留英文并上报，不能为了覆盖率进行分词拼接或机器猜译。

## 恢复工作时的入口

下一次继续时，先从“只读索引盘点”和第一批结构表开始，不再从某个页面漏译个例开始。完成
GGPK 数据更新后，再运行：

```powershell
powershell -ExecutionPolicy Bypass -File .agents/skills/poe2-trade-regression/scripts/run-regression.ps1
```

