# 物品卡字段渲染

## 为什么独立处理

交易结果中的文字并非来自同一层：物品名、底材、`properties`、`requirements` 和词缀来自
`/api/trade2/fetch`；DPS 与防御摘要则由交易网页根据结果再次计算并写入 DOM。通用 DOM 文本
匹配既无法稳定覆盖这些节点，也容易把筛选器、价格或卖家文字误当成物品字段。

因此物品卡按三个明确领域处理：

1. `extension/page/domains/granted-skill.js` 专门处理武器赋予技能，只接受已审核的
   GGPK ClientStrings 模板和 GGPK 官方技能名。
2. `extension/page/item-property-rendering.js` 在页面渲染前翻译 `/fetch` 的结构化
   `properties` 与 `requirements` 名称，数值仍由官网渲染。
3. `extension/content/item-card-fields.js` 只处理结果卡内已登记的稳定 `data-field`。

这不是第二套任意词库。两个模块分别消费构建产物中的 `itemPropertyIndex` 与
`itemFields.dom`；旧的 `properties` 只保留审核覆盖与旧版远程词库兼容。

## 数据和证据

构建器以国际服与台服 Trade API 的 `filters` 中 `equipment_filters` 分组作为稳定字段注册表：

- 通过相同 `data-field` ID 对齐英文和台服文字，批量生成 `itemFields.dom`。因此
  `Reload Time`、`Armour`、`Physical DPS` 等字段无需逐个手写。
- 同一完整英文若也存在于当前 GGPK `ClientStrings`，批量生成 `/fetch` 的
  `properties` 翻译。此处采用 GGPK 客户端用语；DOM 摘要仍采用 Trade API 用语。
- 构建结果写入 `reports/item-field-coverage.json`，列出自动登记、人工例外和总覆盖。

`data/item-fields.zh-TW.json` 只维护不能自动取得的例外与审核别名。每条记录必须声明来源：

- `ggpk-client`：同版本 GGPK 的完整 ClientStrings 英繁对照。
- `ggpk-word`：同版本 GGPK 的完整词语对照。
- `ggpk-passive`：明确列出的完整 PassiveSkills 名称对照；不会自动跨领域导入。
- `trade-filter`：国际服与台服 Trade API 通过稳定筛选字段 ID 对齐后的官方文本。
- `reviewed-trade-stat-term`：没有独立标签时，使用明确列出的官方 Trade stat 英繁整句作为术语证据；任一证据变化都会阻断构建。
- `property`：引用本文件中已经验证完成的结构化属性。
- `ui`：只允许低风险且无官方字段来源的固定网页标签，例如 `Base Percentile`。

## 统一属性索引

`itemPropertyIndex` 是 `/fetch item.properties` 唯一的自动解析入口，构建时合并：

- Trade API 通过稳定 ID 对齐后的完整筛选标签与选项；
- GGPK ClientStrings 中带语义标记的完整标签；
- 与 Trade API 标签完全一致的无标记 ClientStrings；
- 对已有候选提供一致佐证的完整 PassiveSkills 名称；
- `data/item-fields.zh-TW.json` 中的审核例外。

来源必须以完整英文精确匹配，不进行分词猜译。多个自动来源译文不一致时，该词不进入索引；
只有明确审核绑定可以解决冲突。构建报告 `reports/item-property-resolution.json` 记录候选、冲突和
`knownButUnrouted`。后者只要大于零就会直接中止构建。

运行时和后台漏译去重共用该索引，因此 `Staff`、`Elemental Damage` 这类已有官方证据的属性
不会再出现“页面没翻译，同时又被当成未知上报”的分叉。

## 赋予技能领域

`Grants Skill` 不是普通 UI 标签，也不能拆词替换。构建期由
`scripts/domains/granted-skill.mjs` 验证两条 GGPK ClientStrings：

- `ItemDisplayGrantedSkill`：有技能等级；
- `ItemDisplayGrantedSkillNoScaling`：无技能等级。

运行时只完整匹配这两种官方句式，再使用 `ggpk.baseItems` 导出的 `baseItems` 对技能英文名做
精确查询。例如 `Grants Skill: Spear Throw` 解析为 `賦予技能: 長矛投擲`。等级数字只作为
结构化参数回填，不参与翻译。

官网 `/fetch` 会把这类记录放在独立的 `item.grantedSkills` 数组，并拆成
`name: "Grants Skill"` 与 `values[0]: "Level 20 Solar Orb"`，最终 DOM 标记为
`data-field="stat.skill.solar_orb"`。它不会经过 `item.properties` 的普通属性循环。这不是
另一套翻译规则：解析器会先用相同的英文模板验证组合值，再用相同的繁中模板拆回
`name: "賦予技能"` 与 `values[0]: "20 級 日耀球"`。整行、占位符和拆分结构因此共享同一
来源与失败策略。

主路径在 `/fetch` 阶段单独遍历 `item.grantedSkills`。结果卡另有一个仅接受
`[data-field^="stat.skill."]` 且能在稳定 stat 索引中验证为 `Grants Skill:` 的 DOM 适配器，作为
官网移动字段或旧缓存造成结构偏差时的第二层保险；它不会扫描普通英文文本。

模板命中但技能名称不存在时，整行保持英文并以 `item-skill.granted`、
`missing-skill-name` 上报；模板形态变化则以 `template-shape-drift` 上报。两种情况都禁止输出
中英混合的半成品。构建审计写入 `reports/granted-skill-domain-report.json`。

构建器会验证来源英文必须等于目标英文。确实存在官网缩写的情况，例如 `DPS` 对应稳定字段
`Damage per Second`，必须显式写入 `reviewedAlias: true`；未声明的跨词或相似词不会自动采用。

## Tooltip

仅繁中模式下，结构化属性在 `/fetch` 翻译时登记实际英文；DOM 计算字段则在命中稳定
`data-field` 时登记当前英文。两者最终都复用页面唯一的 `original-tooltip` 实例，不使用
`title`，也不从中文反向推断英文。

## 自检与边界

- 不处理价格、卖家、上架时间和账号。
- 未登记的 `data-field` 保持英文；仅当它位于物品卡附加属性区域时，才上报稳定 ID 和纯英文
  标签。数字、属性值、价格、卖家及输入内容不会进入报告。
- `No Physical Damage` 等具备稳定 stat ID 的词缀仍走 stat 审核链路；`Grants Skill: ...`
  由赋予技能领域处理，因为无等级的武器固有技能并不保证具有 Trade API stat ID。
- 新字段优先由下一次 Trade API 构建自动纳入；不在官方注册表中的字段，只有找到官方来源或
  完成明确人工审核后才能加入例外文件。
