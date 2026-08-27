# 流亡译镜开发进度

最后更新：2026-08-28

## 当前可交付版本

- 扩展版本：`0.3.1`
- 词库版本：`project-zhTW-1.manual-7.terms-1.names-e10b747.tw-82883049`
- 安装目录：`extension/`
- 压缩包：`poe2-trade-zh-extension-0.3.1.zip`
- 当前权限：`storage`、`alarms`
- 当前主机范围：POE 官网、GitHub Raw、jsDelivr

词库规模：

- 物品名称：3,552 条
- 交易词缀：7,136 条
- 动态界面精确对照：7,459 条
- 手写固定 UI：42 条

当前官方覆盖审计：

- 物品名称：3,552 / 3,574（99.38%）。
- 交易词缀：7,136 / 8,178（87.26%）。
- 静态项目：754 / 754（100%）。
- 筛选器：55 / 55（100%），全部 141 个筛选选项已覆盖；仅含选项而无标题的 `status` 不计为缺失文本。
- 审核队列：1,197 条，其中包含 132 条外部来源冲突。

## 已完成

### Chrome 扩展基础

- Manifest V3 扩展结构。
- 中英双语和仅繁体中文两种模式。
- Popup 启停、模式选择、词库状态、漏译数量和更新入口。
- 设置页、漏译管理页及本地人工修正。
- 已在真实 Chrome 和已登录 POE2 市集页面确认扩展可以注入。

### 市集翻译

- 拦截 `/api/trade2/data/stats`、`items`、`static`、`filters`。
- 拦截 `/api/trade2/fetch`，翻译搜索结果物品、属性和词缀。
- 翻译物品分类、筛选器、下拉选项、按钮和输入提示。
- 监听新增节点、属性变化及复用文字节点的内容变化。
- DOM 精确匹配作为接口翻译之外的兜底。

### 接口接管修复

- 不再依赖跨隔离环境传递 `CustomEvent.detail` 大对象。
- 使用不可执行的共享 JSON 节点向页面环境传递词库。
- 锁定 Fetch/XHR 拦截器，降低被页面脚本覆盖的概率。
- 页面根节点记录桥接、拦截器、词库和最近处理接口的诊断状态。

### 数据构建

- 历史繁中数据已一次性迁移到项目自有的 `sources/translations.zh-TW.json`。
- `scripts/build-data.mjs` 只读取项目数据源、人工修正和 POE2 官方英文接口。
- `extension/page/ajax-hooker.js` 已成为独立维护的本地源码，不再由构建器生成。
- 构建时读取 POE2 官方英文交易接口，按稳定 ID 配对英文和中文。
- 构建时读取台服官方繁中接口；稳定 ID 词条优先采用官方译文，台服缺失时保留原有回退。
- 生成 `extension/data/bundled.json` 和带 SHA-256 的清单。
- 远程更新只接受声明式 JSON，不下载或执行远程代码。
- 支持 GitHub Raw 和 jsDelivr 清单，每 12 小时自动检查。

### 翻译流水线

- 新增官方英文快照和审核基线，自动检测新增、删除和稳定 ID 改义。
- `poe-game-data` 已锁定到 commit `e10b7473addb` 并校验 SHA-256。
- 对官方当前物品名进行规范化英文完全匹配，自动补充 544 条名称。
- 新增完整短语例外、领域术语和最长术语组合候选。
- 新增覆盖率、外部冲突、质量门禁和人工审核队列。
- 新增审核命令，可记录 `expectedEnglish`、译文和审核时间。
- 第一轮质量审计发现并修正 6 条占位符或硬编码错误。
- 台服官方源本次安全应用 6,608 个稳定 ID 词条；1 条占位符不一致记录被拒绝并写入来源报告。
- 物品接口不再按数组位置配对；当前没有具备安全非语言键的新增物品译文，继续由锁定第三方名称表兜底。

### 数据源结论

- `poe-game-data/poe2/names/tw.json` 主要覆盖基础物品和技能名称，不能作为完整交易站词库。
- 交易筛选器必须由官方英文接口与现有中文交易数据按 ID 合并。
- 第三方缺失或语义过期的内容放在 `sources/manual-overrides.json`。
- 人工覆盖同时保存稳定 ID 和预期英文；英文语义变化时构建失败，要求人工复核。
- `Monster Effectiveness` 已校正为“怪物效用”，不再沿用旧的 `Waystone Magic Monsters` 含义。

### 漏译自检

- 接口层按物品、词缀、静态项目、筛选器和属性 ID 检测缺失。
- 页面层扫描筛选面板、下拉选项、按钮、标签和输入提示中的残留英文。
- 页面候选去重并延迟批量写入，避免频繁操作本地存储。
- 漏译管理支持搜索、分类、忽略、删除、清空、安全导出和本地补译。
- 远程词库或本地修正包含译文后自动消解记录。
- 扩展刷新导致旧管理页上下文失效时，显示重新连接提示。
- 已知“中文（English）”双语显示会从 DOM 漏译候选中排除，避免 `# 元素抗性 (# total Elemental Resistances)` 一类误报。

### 隐私边界

不记录或上传：

- POE 账号、卖家名称和私聊内容。
- Cookie、`POESESSID` 和 whisper token。
- 搜索输入、搜索历史、物品价格和浏览历史。
- 随机稀有物品名称。

当前所有漏译与人工修正只保存在浏览器本地。

## 已验证

以下测试在 `0.3.1` 通过：

```powershell
node scripts/sync-external-sources.mjs
node scripts/build-data.mjs
node scripts/check-quality.mjs
node scripts/pipeline-test.mjs
node scripts/smoke-test.mjs
node scripts/background-smoke-test.mjs
node --check extension/content/bridge.js
node --check extension/page/trade-hook.js
node --check extension/background/service-worker.js
node --check extension/health/health.js
node --check scripts/build-data.mjs
```

人工检查曾确认：

- Chrome 控制扩展可以连接用户的 Chrome。
- POE2 市集顶部固定文本成功双语化。
- 旧版本存在动态接口词条不生效问题，随后已完成共享配置与 DOM 兜底修复。
- 截图确认终局筛选器的上游数据存在英文残留，`0.2.4` 和 `0.2.5` 已加入校正。

## 当前未完成的验证

- `0.3.1` 在扩展重新加载后的完整真实页面回归尚未完成。
- 需要逐项展开 Item Category、Type Filters、Equipment Filters、Requirements、Endgame Filters、Miscellaneous 和 Trade Filters。
- 需要确认“怪物效用”等新校正已经直接显示，且不会先显示旧英文再闪烁替换。
- 需要查看漏译管理页是否只收集标准 UI，不产生卖家或结果相关误报。
- 需要执行一次真实搜索，检查结果物品名、属性、词缀和漏译 ID 收集。

## 已确认的架构调整

- `trade.js` 只能作为历史参考，不是扩展逻辑或正式构建依赖。
- 构建器和运行文件已经完全解除对它的依赖。
- 迁移后的基础译文由 `sources/translations.zh-TW.json` 统一维护，并保留一次性迁移说明。
- 详细方案见 `docs/TRANSLATION-ARCHITECTURE.md`。

## 下次继续的建议顺序

1. 在 `chrome://extensions` 刷新 `0.3.1`，刷新 POE2 市集。
2. 用 Chrome 控制连接真实页面，检查所有左侧筛选组及动态下拉框。
3. 打开漏译管理页，审核 `ui` 类型记录是否有误报。
4. 对真实搜索结果检查 `/fetch` 翻译与数值占位符替换。
5. 按 `reports/review-queue.json` 优先审核台服占位符拒绝项和 132 条名称冲突。
6. 继续接入 `poe-game-data` modifier 数据，提高剩余 1,042 条缺失词缀的自动候选覆盖。
7. 用户提供 GitHub 仓库地址后创建 Actions，发布远程 `manifest.json`、`dataset.json`。
8. 将设置页的更新地址改为固定项目地址，再考虑 Chrome 商店发布。

## 关键文件

- `extension/manifest.json`：扩展声明和权限。
- `extension/content/bridge.js`：词库桥接、DOM 翻译和界面漏译扫描。
- `extension/page/trade-hook.js`：交易接口翻译和稳定 ID 漏译检测。
- `extension/background/service-worker.js`：词库合并、更新、自检存储和本地修正。
- `extension/health/`：漏译管理页。
- `extension/data/bundled.json`：当前内置词库。
- `sources/manual-overrides.json`：人工校正层。
- `sources/glossary.zh-TW.json`：领域术语及审核状态。
- `sources/phrase-exceptions.zh-TW.json`：禁止拆分的完整短语。
- `sources/source-lock.json`：外部来源 commit 和哈希锁定。
- `reports/review-queue.json`：构建生成的人工审核队列。
- `scripts/build-data.mjs`：词库生成程序。
- `scripts/review-translation.mjs`：审核结果写入程序。
- `scripts/smoke-test.mjs`：接口翻译冒烟测试。
- `scripts/background-smoke-test.mjs`：漏译存储与人工修正测试。

## 安装和恢复开发

1. 打开 `chrome://extensions` 并开启开发者模式。
2. 加载已解压的 `extension` 目录，或刷新已经加载的扩展。
3. 刷新 POE2 市集页面。
4. 点击浏览器工具栏中的“流亡译镜”。
5. 通过“查看漏译与修正”打开管理页，不要直接双击 `health.html`。
