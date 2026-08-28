# 翻译架构 V2：以稳定键和官方客户端数据为核心

最后更新：2026-08-29

## 1. 这次为什么需要重新设计

项目原先主要面对交易站数据，因此核心思路是：

1. 从国际服 Trade API 获得当前英文和稳定 ID。
2. 从台服 Trade API 按相同 ID 获取繁中。
3. 台服缺失时回退到项目旧词库、第三方名称表和人工修正。
4. 运行时按 ID 或英文精确匹配替换。

这套逻辑适合 `stats`、`static`、`filters`，但不能完整解释搜索结果中的物品名称。
特别是 `item.name`、`item.baseType` 和 `item.typeLine` 属于不同概念：

- `baseType` 是基础类型，例如 `Slim Mace`。
- `name` 可能是固定暗金名，也可能是随机魔法/稀有名称，例如 `Golem Crack`。
- `typeLine` 可能包含品质、特殊前后缀或基础类型组合。

如果只维护一个 `英文 -> 中文` 的扁平物品字典，就容易把完整随机名称误判成基础类型。
此前出现的 `Golem Crack -> 纖細之錘` 就属于解析域错误，不是单纯缺一条译文。

本地只读验证又带来了新的官方数据源：PoE2 客户端 `Content.ggpk` 内同时包含英文和
`traditional chinese` 数据表，而且表结构可以稳定对齐。因此 V2 不再把所有内容都塞进同一套
字符串权重系统，而是先分域，再在每个域内按证据等级解析。

## 2. 已验证事实与当前边界

### 2.1 已完成的只读验证

对本地 `Content.ggpk` 的验证全程只读，没有保存、替换或修复游戏文件。已确认：

| 表 | 英文行数 | 繁中行数 | 行结构 | 用途 |
|---|---:|---:|---|---|
| `BaseItemTypes.datc64` | 5,476 | 5,476 | 360 字节/行 | 基础物品稳定 ID 与名称 |
| `Words.datc64` | 3,246 | 3,246 | 64 字节/行 | 固定名称与随机命名组件 |
| `Mods.datc64` | 16,679 | 16,679 | 677 字节/行 | 模组结构、内部关联与数值范围 |

已确认的官方配对样本：

| 领域 | 英文 | 官方繁中 |
|---|---|---|
| 基础物品 | `Slim Mace` | `纖細之錘` |
| 基础物品 | `Jade Amulet` | `翠玉護身符` |
| 命名组件 | `Golem` | `魔像` |
| 命名组件 | `Crack` | `裂骨錘` |
| 命名组件 | `the Cracked` | `爆發之靈` |

因此正确结论是：

```text
Slim Mace   -> 纖細之錘        （基础类型）
Golem Crack -> 魔像 + 裂骨錘   （随机名称组件，最终空格和语序由命名规则决定）
```

### 2.2 当前实现状态

- `tools/ggpk/` 已提供正式只读提取器，并锁定源码依赖、哈希、补丁和许可证。
- `sources/generated/ggpk/` 已生成 `BaseItemTypes` 与 `Words` 的规范化官方英繁映射。
- `scripts/build-data.mjs` 已把映射写入 `baseItems`、`fixedNames` 和 `wordComponents` 三个域。
- `/fetch` 运行时已经区分 `name`、`baseType` 和 `typeLine`；随机名称必须被官方组件整段覆盖才翻译。
- `/fetch` 的 `Mods` 与 `Stats` 已按英文模板和稳定 ID 双重校验；不会再仅按数组位置套用翻译。具体的词组、占位符和回退规则见 [词组与词条翻译对照规范](PHRASE-TRANSLATION.md)。
- `Words` 的类别、组合顺序和所有语言规则尚未完全解析；当前采用保守的整段匹配。
- GGPK 不负责交易站固定 UI、筛选器或服务端专有文本，这些仍以 Trade API 和项目 UI 词库为准。
- `poe-game-data` 暂时保留为兼容补缺及冲突审计来源，不再参与随机名称解析。

所以 GGPK 现在已经是扩展名称域的正式官方来源，但不是所有交易站文本的统一来源。

## 3. V2 的核心原则

### 3.1 先分域，后谈优先级

不能建立一个全局权重表，让所有来源竞争同一个英文字符串。必须先判断数据属于哪个领域：

| 领域 | 主要稳定键 | 首选官方来源 |
|---|---|---|
| 交易词缀/搜索条件 | Trade API entry ID | 英文与台服 Trade API |
| 筛选器和下拉选项 | filter ID + option ID | 英文与台服 Trade API |
| 静态交易项目 | Trade API static ID | 英文与台服 Trade API |
| 基础物品 | `BaseItemTypes.Id` | 英文与繁中 GGPK 表 |
| 固定名称/随机名称组件 | 同版本 `Words` 行 + 词表类别 | 英文与繁中 GGPK 表 |
| 游戏模组结构 | `Mods` 内部 ID | GGPK 表与 stat descriptions |
| 固定网页 UI | 项目定义的 UI key/精确文本 | 项目自有人工词库 |
| 用户搜索输入 | 无 | 不翻译、不收集 |

相同英文在不同领域可以有不同译文。稳定键必须包含命名空间，例如：

```text
trade.stat:explicit.stat_123
trade.filter:item_category:weapon
ggpk.base:Metadata/Items/Weapons/...
ggpk.word:<gameFingerprint>:2167
ui:clear_filter_group
```

`BaseItemTypes.Id` 可以作为跨版本身份键；`Words` 行号目前只证明能在同一版本的英繁表之间
安全配对，不能假定补丁后仍代表同一单词。跨版本追踪必须同时保存游戏指纹、词表类别、英文原文
和行内容哈希，并在行号或内容变化时重新审核。

### 3.2 数据合并发生在构建期，不在浏览器里逐层联网查询

“分层来源”不等于扩展运行时依次请求多个网站。正确流程是：

```text
各来源快照
   -> 规范化为带稳定键、来源和版本的记录
   -> 构建期冲突决策与质量门禁
   -> 生成单一运行数据集
   -> 扩展运行时 O(1) 查表
```

扩展只下载声明式 JSON，不解析 GGPK、不访问第三方翻译站、不执行远程代码。

### 3.3 正式译文与候选必须分开

- 官方相同稳定键配对：可以自动进入正式数据。
- 已审核人工覆盖：可以进入正式数据，并保存预期英文/来源版本。
- 第三方英文精确匹配：只能在稳定来源被锁定且没有冲突时补缺。
- 分词、术语组合、模糊匹配和 AI：只生成候选。
- 找不到可靠证据：保留英文并进入审核报告。

## 4. 每个领域的来源优先级

优先级只在同一领域、同一稳定键内比较。

### 4.1 交易站数据

```text
带 expectedEnglish 的人工覆盖
  > 台服 Trade API 相同稳定 ID
  > 项目已审核正式译文
  > 锁定第三方来源的精确稳定键/英文匹配
  > 候选系统
  > 英文回退
```

适用于 `stats`、`static`、`filters` 及选项。继续保留现有占位符数量校验、选项 ID
校验和英文改义门禁。

### 4.2 基础物品

```text
带 GGPK 稳定 ID 与源指纹的人工例外
  > 同版本英文/繁中 BaseItemTypes 按 Id 配对
  > 台服 Trade API 中具备相同稳定键的条目
  > 项目已审核名称
  > 锁定 poe-game-data 精确英文补缺
  > 候选系统
  > 英文回退
```

GGPK 接入稳定后，`poe-game-data/names/tw.json` 从主要名称补充源降为审计/兜底源。

### 4.3 随机魔法和稀有名称

不能把完整名称交给基础物品字典，也不能用普通英文分词直接拼中文。目标流程是：

1. 从 API 的 `name`、`baseType`、`rarity` 分辨名称类型。
2. 使用同版本 `Words` 行、词表类别和内容指纹建立前缀、后缀、专有名组件映射。
3. 根据该语言的命名格式组合，而不是保留英文词序的简单空格拼接。
4. 无法确认组件或语序时保留原文，不回退到基础物品翻译。
5. 自检只记录未知组件的内部键；不记录玩家输入或完整随机物品名。

### 4.4 模组描述

`Mods.datc64` 本身不等于最终显示文本。目标需要联合：

- `Mods`：模组 ID、类别、关联 stat 和数值。
- `Stats`：stat 稳定 ID。
- 英文/繁中 stat descriptions：模板、占位符、条件和复数规则。
- Trade API：交易站实际暴露的统计项 ID 与文本。

GGPK 用于补充和验证，Trade API ID 仍是交易筛选器运行时的主键。

### 4.5 固定网页 UI

`Clear Filter Group`、`Count` 等页面框架文本通常没有 GGPK 游戏数据稳定键，应继续由项目自有
`ui.zh-TW`/`exact` 词库维护。DOM 翻译只允许在白名单区域做完整精确匹配。

## 5. 目标数据模型

正式源记录不应只保存 `英文: 中文`，而应保存证据：

```json
{
  "key": "ggpk.base:Metadata/Items/Weapons/OneHandWeapons/OneHandMaces/FourOneHandMace3",
  "domain": "base-item",
  "english": "Slim Mace",
  "zhTW": "纖細之錘",
  "source": {
    "kind": "ggpk-paired-table",
    "table": "BaseItemTypes",
    "gameFingerprint": "...",
    "englishRow": 2024,
    "translatedRow": 2024
  },
  "status": "official"
}
```

运行数据可以压缩成快速查表结构，但构建报告必须保留上述来源信息。

建议的仓库结构：

```text
tools/
  ggpk/
    README.md
    extractor source
    table schema adapters

sources/
  manual-overrides.json
  glossary.zh-TW.json
  phrase-exceptions.zh-TW.json
  source-lock.json
  generated/
    ggpk/
      manifest.json
      base-items.zh-TW.json
      words.zh-TW.json
      mods.zh-TW.json

reports/
  ggpk-source-report.json
  source-conflicts.json
  coverage-report.json
  review-queue.json
```

原始 `.ggpk` 和 `.datc64` 不进入 Git，也不打包进扩展。是否提交规范化映射需在发布前检查
GGG 数据使用政策；在此之前可以只将其作为本地构建输入和审计报告。

## 6. GGPK 读取的安全边界

当前正式提取器满足：

- 只使用只读文件句柄打开 `Content.ggpk`。
- 不调用写回、压缩、替换、修复、重建索引或更新哈希的接口。
- 不加载到游戏进程、不注入 DLL、不读写游戏内存。
- 不模拟游戏操作，不自动交易，不读取账号令牌。
- 所有缓存和输出写入本仓库明确目录，不写入游戏安装目录。
- 游戏路径由本地配置或命令参数提供，不硬编码到扩展。
- 原始表、路径配置和本机信息不得进入扩展发布包。
- 执行前后记录文件大小与修改时间；关键表另做 SHA-256 指纹。

浏览器扩展本身不能也不应该读取任意本地 GGPK。GGPK 解析只属于维护者的离线数据构建工具。

## 7. 自动更新应该怎样工作

### 7.1 GitHub 托管 Actions 能做的事

- 定时读取英文与台服 Trade API。
- 对比稳定 ID 和英文改义。
- 使用仓库中已经审核/生成的规范化快照构建扩展数据。
- 运行质量门禁、测试和发布清单。

### 7.2 GitHub 托管 Actions 做不到的事

托管 Runner 没有维护者本地已授权安装的 `Content.ggpk`，因此不能凭空自动提取最新客户端数据。

### 7.3 推荐更新链路

```text
本机检测游戏更新
  -> 只读提取指定表
  -> 生成规范化映射和来源指纹
  -> 生成差异报告
  -> 人工确认异常/来源政策
  -> 提交映射或发布专用数据制品
  -> GitHub Actions 构建、测试和发布
  -> 扩展下载带 SHA-256 的 JSON
```

后续可选方案：

- 本地手动命令：最简单、最安全，补丁后执行一次。
- 本地计划任务：检测 GGPK 修改时间后生成报告，但不自动提交。
- 自托管 Runner：可自动化，但必须限制权限并确保游戏数据使用符合要求。

不建议让普通扩展用户安装 GGPK 解析组件；扩展应该继续保持纯浏览器形态。

## 8. 运行时翻译流程

### 8.1 Trade 目录接口

```text
收到 items/stats/static/filters
  -> 按 endpoint 选择数据域
  -> 首选稳定 ID/option ID
  -> 应用构建好的正式译文
  -> 无译文时上报稳定键
  -> DOM exact 只做显示兜底
```

### 8.2 搜索结果物品

```text
收到 /fetch item
  -> 单独保存原始 name/baseType/typeLine/rarity
  -> baseType 只查 base-item 域
  -> 固定 name 查 unique/fixed-name 域
  -> 随机 name 查 word-component 域并按规则组合
  -> typeLine 只用明确字段重建或精确替换
  -> 属性和词缀按 Trade stat ID 翻译
  -> 任一域失败只回退该字段，不跨域借用译文
```

关键约束：

- 禁止使用基础类型译文覆盖完整 `item.name`。
- 禁止通过后缀包含关系判断物品类型。
- 禁止将搜索输入框、卖家信息或完整随机名称加入通用漏译库。
- 双语模式只在最终字段格式化时附加英文，不能把双语结果重新送入检测器。

## 9. 自检机制 V2

### 9.1 构建期自检

- GGPK 英文/繁中表行数、行宽和稳定 ID 是否一致。
- 同一稳定键的英文或中文是否发生变化。
- 表结构是否漂移，指针/占位符是否还能正确解析。
- Trade API 的稳定 ID、选项和英文是否变化。
- 同一领域是否出现一对多冲突。
- 人工覆盖的预期英文和源指纹是否过期。

结构漂移必须阻断自动发布；普通新增缺失进入审核队列。

### 9.2 运行期自检

- API 层：只记录缺失稳定 ID、endpoint、英文模板和出现次数。
- 物品层：分别记录未知基础类型、未知固定名或未知命名组件。
- DOM 层：仅扫描白名单 UI 区域，并排除输入框、结果物品名、卖家信息和已双语文本。
- 本地去重；默认不自动上传。
- 更新词库后自动消解已经覆盖的稳定键。

### 9.3 审核队列分类

```text
blocker       表结构漂移、稳定 ID 改义、占位符不一致
official-new  新增官方稳定键，尚无中文
conflict      两个正式来源对同一键给出不同译文
candidate     分词/术语/AI 生成的候选
ui-observed   白名单区域发现的固定 UI 英文
ignored       用户输入、随机完整名称、卖家或交易内容
```

## 10. 对现有实现的影响

### 可以保留

- Manifest V3 扩展结构和远程 JSON 更新机制。
- Trade API 的稳定 ID 翻译。
- SHA-256 校验、失败保留旧词库。
- 本地漏译管理、去重、忽略和导出。
- `trade.js` 完全退出运行与构建的原则。
- 台服 Trade API、人工覆盖、质量门禁和英文基线。

### 需要重构

- `scripts/build-data.mjs`：拆为来源适配、领域规范化、冲突解析和输出四层。
- `dataset.items`：拆分为 `baseItems`、`fixedNames`、`wordComponents`，避免扁平键冲突。
- `extension/page/trade-hook.js`：按 `name/baseType/typeLine/rarity` 分类解析。
- 审核报告：加入 GGPK 来源指纹、稳定键和结构漂移。
- 第三方名称表：GGPK 覆盖稳定后降级为兜底/审计来源。

### 需要停止的做法

- 不再通过一个扁平 `items[english]` 同时解释基础类型、暗金名和随机名称。
- 不再把普通分词结果直接用于运行时翻译。
- 不再收集用户正在输入的字符串或完整随机物品名。
- 不再用“逐条人工修补页面现象”代替数据域和稳定键修复。

## 11. 实施顺序

### 阶段 A：把 GGPK 验证代码正式迁入仓库（已完成）

1. 在 `tools/ggpk/` 建立独立只读提取器。
2. 明确依赖、许可证、构建方式和只读安全保证。
3. 支持从命令参数读取游戏路径，输出到仓库内受控目录。
4. 加入前后元数据检查和关键表指纹。

完成标准：可重复生成相同映射，且不会修改游戏目录。

### 阶段 B：建立规范化 GGPK 数据（基础名称已完成）

1. 配对 `BaseItemTypes`。
2. 配对 `Words` 并解析词表类别/组合规则。
3. 研究 `Mods`、`Stats` 和 stat descriptions 的关联。
4. 生成覆盖率、冲突和结构漂移报告。

完成标准：`Slim Mace`、`Jade Amulet`、`Golem Crack` 等样本能按正确领域解析。

### 阶段 C：重构构建器（兼容迁移已完成）

1. 引入带命名空间稳定键的统一记录模型。
2. 将来源优先级改为领域内决策。
3. 保留旧 `dataset.items` 兼容输出，直到新运行时通过回归。
4. 对新旧数据集生成差异报告。

完成标准：现有 Trade API 覆盖率不下降，跨域错误被测试捕获。

### 阶段 D：重构运行时物品翻译（首版已完成）

1. 明确区分 `baseType`、固定 `name`、随机 `name` 和 `typeLine`。
2. 增加普通、魔法、稀有、暗金等样本测试。
3. 禁止跨域回退。
4. 调整漏译收集边界。

完成标准：不再出现完整名称被基础类型覆盖，也不收集玩家输入。

### 阶段 E：自动更新（进行中）

1. 本地补丁检测和一键提取。
2. GitHub Actions 消费规范化数据并执行质量门禁。
3. 数据变更通过后更新远程 JSON。
4. 扩展继续每 12 小时检查签名清单。

## 12. 当前决策

1. 项目唯一维护目录为 `D:\code\exile-trade-lens`。
2. 不再在系统临时目录创建或维护项目副本。
3. 后续正式工具、源码、文档和可复现配置都进入本仓库。
4. 临时目录仅可承载可删除的编译缓存或一次性输出，且不得成为任何正式流程依赖。
5. GGPK 解析已经并入扩展构建，但只消费规范化 JSON；浏览器扩展本身不读取本地游戏文件。
6. `trade.js` 继续仅作为历史参考，不参与运行、构建或 GGPK 数据生成。
