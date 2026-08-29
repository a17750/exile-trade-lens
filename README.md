# 流亡译镜（Exile Trade Lens）

这是独立维护的 Manifest V3 测试版。旧脚本仅保留为历史参考，不参与扩展运行或数据构建。目前提供：

- 交易站物品、词缀、静态数据和筛选器繁中化
- 仅中文/中英双语模式
- 中文词缀搜索（通过翻译交易站数据实现）
- 搜索结果物品名、属性和词缀翻译
- 内置词库和远程 JSON 自动更新框架
- SHA-256 校验、失败保留旧版词库
- 漏译自动检测、去重和插件角标提示
- 独立漏译采集守门模块：拒绝输入框、自动完成浮层、渲染片段和无可信来源的报告
- 扩展代码安装、升级或开发者模式重新加载时自动清空旧漏译，确保每轮验证只看当前代码产生的记录
- 漏译管理页、手工修正、忽略和安全导出
- 远程词库更新后的漏译自动消解
- 页面环境与扩展环境之间的可靠词库桥接
- 接口拦截状态标记和物品/UI 文本 DOM 兜底翻译
- 按官方接口稳定 ID 生成动态下拉菜单中英对照
- 自动收集筛选区域、按钮和下拉菜单中残留的英文 UI 文本
- 修正上游数据仍为英文的终局筛选项，并友好处理管理页上下文失效
- 构建时自动读取台服官方交易接口，按稳定 ID 优先采用官方繁中译文
- 只读提取本机客户端英/繁中 `BaseItemTypes`、`Words`、`Mods` 装备前后缀和 `ClientStrings` 展示模板，生成可审计的官方名称数据
- 基础类型、固定名称、稀有名称组件和魔法装备前后缀分域查找；仅在完整名称可由官方组件覆盖时组合翻译
- 已翻译的双语文本不会再次被 DOM 自检当作漏译上报
- `sources/manual-overrides.json` 保存第三方数据缺失或语义过期时的人工校正

完整说明：

- [功能说明](docs/FEATURES.md)
- [当前进度与后续交接](docs/PROGRESS.md)
- [中英对照与目标数据架构](docs/TRANSLATION-ARCHITECTURE.md)
- [翻译获取、候选生成与审核流程](docs/TRANSLATION-WORKFLOW.md)
- [漏译采集守门策略](docs/MISSING-REPORT-POLICY.md)
- [权限说明](docs/PERMISSIONS.md)
- [隐私说明草案](docs/PRIVACY-DRAFT.md)

## 构建数据

游戏更新后，维护者先在本机只读刷新官方名称数据：

```powershell
.\tools\ggpk\run.ps1 -GamePath 'D:\games\Path of Exile 2\Content.ggpk'
```

工具只以 `FileAccess.Read` 打开游戏文件，原始表只留在内存，规范化结果写入
`sources/generated/ggpk/`。随后运行仓库数据构建：

```powershell
node scripts/sync-external-sources.mjs
node scripts/build-data.mjs
node scripts/check-quality.mjs
```

这会读取 GGPK 规范化数据、项目词库、锁定版本的外部名称、人工修正、国际服英文接口和台服官方繁中接口，生成运行词库以及 `reports/` 下的覆盖率、差异、质量和审核报告：

- `extension/data/bundled.json`
- `extension/data/bundled-manifest.json`
- `reports/official-tw-current.json`
- `reports/official-tw-source-report.json`
- `reports/ggpk-source-report.json`

`extension/page/ajax-hooker.js` 是独立维护的本地运行文件，构建器不会生成或修改它。

## 安装测试

1. 打开 `chrome://extensions/`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目的 `extension` 目录。
5. 关闭已经打开的 POE2 交易站标签页，再重新打开交易站。

修改文件后，在扩展管理页点击此扩展的刷新按钮，并重新加载交易站页面。

页面根节点会写入 `data-poe2zh-bridge`、`data-poe2zh-hook`、
`data-poe2zh-dataset` 和 `data-poe2zh-last-endpoint`，用于判断词库、拦截器及
最近处理的接口是否正常，不包含账号或交易信息。

## 远程词库

扩展默认使用本仓库的 GitHub Raw 清单，也可在设置页改为其他 GitHub Raw 或 jsDelivr 地址。当前默认清单：

```text
https://raw.githubusercontent.com/a17750/exile-trade-lens/main/extension/data/remote-manifest.json
```

清单格式：

```json
{
  "schemaVersion": 1,
  "datasetVersion": "0.5.0-20260825",
  "dataUrl": "https://raw.githubusercontent.com/owner/repo/main/dataset.json",
  "sha256": "dataset.json 的小写十六进制 SHA-256"
}
```

远程内容只能是声明式翻译数据，不能包含或执行远程代码。

## 当前限制

- 当前基础译文已一次性迁移到 `sources/translations.zh-TW.json`，后续只在项目数据源中维护。
- GGPK `BaseItemTypes`、`Words`、`Mods` 的 `ITEM` 前后缀名称和经过明确 ID 审核的 `ClientStrings` 展示模板已并入正式构建；其他 Mods 领域以及 stat description 的完整关联仍未完成。
- 稀有名称只有在英文整段能被官方 `Words` 组件无缝覆盖时才翻译；魔法 `typeLine` 必须由官方前缀、底材、后缀全部覆盖。不完整或冲突的名称保留英文。
- 普通品质物品只接受官方 `ClientStrings.QualityItem` 的完整模板匹配，例如 `Superior Bombard Crossbow`；其他未知展示修饰词保留英文并进入漏译记录。
- `/data/items` 条目没有可选 `text` 字段时，会用 `name + type` 重建英文显示，不会再生成 `(undefined)`。
- GitHub Actions 不读取本机游戏文件，只消费仓库内已经生成并审核的规范化 GGPK JSON；游戏版本更新后仍需维护者本机运行一次只读提取。
- GitHub Actions 每日检查官方数据；只有质量门禁和测试通过后才会提交新的远程词库。
- 官方交易站改变 API 或页面内部结构时，扩展适配代码仍需升级。
- 简体中文、别名词典、匿名漏译上报和自动候选译文将在下一阶段加入。

This product isn't affiliated with or endorsed by Grinding Gear Games in any way.
