# 流亡译镜（Exile Trade Lens）

这是独立维护的 Manifest V3 测试版。旧脚本仅保留为历史参考，不参与扩展运行或数据构建。目前提供：

- 交易站物品、词缀、静态数据和筛选器繁中化
- 仅中文/中英双语模式
- 中文词缀搜索（通过翻译交易站数据实现）
- 搜索结果物品名、属性和词缀翻译
- 内置词库和远程 JSON 自动更新框架
- SHA-256 校验、失败保留旧版词库
- 漏译自动检测、去重和插件角标提示
- 漏译管理页、手工修正、忽略和安全导出
- 远程词库更新后的漏译自动消解
- 页面环境与扩展环境之间的可靠词库桥接
- 接口拦截状态标记和物品/UI 文本 DOM 兜底翻译
- 按官方接口稳定 ID 生成动态下拉菜单中英对照
- 自动收集筛选区域、按钮和下拉菜单中残留的英文 UI 文本
- 修正上游数据仍为英文的终局筛选项，并友好处理管理页上下文失效
- 构建时自动读取台服官方交易接口，按稳定 ID 优先采用官方繁中译文
- 已翻译的双语文本不会再次被 DOM 自检当作漏译上报
- `sources/manual-overrides.json` 保存第三方数据缺失或语义过期时的人工校正

完整说明：

- [功能说明](docs/FEATURES.md)
- [当前进度与后续交接](docs/PROGRESS.md)
- [中英对照与目标数据架构](docs/TRANSLATION-ARCHITECTURE.md)
- [翻译获取、候选生成与审核流程](docs/TRANSLATION-WORKFLOW.md)
- [权限说明](docs/PERMISSIONS.md)
- [隐私说明草案](docs/PRIVACY-DRAFT.md)

## 构建数据

```powershell
node scripts/sync-external-sources.mjs
node scripts/build-data.mjs
node scripts/check-quality.mjs
```

这会读取项目词库、锁定版本的外部名称、人工修正、国际服英文接口和台服官方繁中接口，生成运行词库以及 `reports/` 下的覆盖率、差异、质量和审核报告：

- `extension/data/bundled.json`
- `extension/data/bundled-manifest.json`
- `reports/official-tw-current.json`
- `reports/official-tw-source-report.json`

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

在扩展设置页填写托管于 GitHub Raw 或 jsDelivr 的清单地址。清单示例：

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
- 尚未接入 GitHub Actions 数据生成仓库，所以默认使用内置词库。
- 官方交易站改变 API 或页面内部结构时，扩展适配代码仍需升级。
- 简体中文、别名词典、匿名漏译上报和自动候选译文将在下一阶段加入。

This product isn't affiliated with or endorsed by Grinding Gear Games in any way.
