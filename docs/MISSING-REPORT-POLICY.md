# 漏译采集守门策略

最后更新：2026-08-29

`extension/shared/missing-report-policy.js` 是漏译采集边界的唯一策略模块。它不负责翻译，只判断一条
候选是否可以从页面进入本地漏译记录。页面 API、隔离环境 DOM 扫描和后台保存均执行来源校验，
避免任何单一入口误判后直接污染审核队列。

## 允许的来源

| `source` | 适用范围 | 是否接受 |
|---|---|---|
| `trade-api` | `/fetch` 中的物品、属性、词缀等结构化字段 | 接受非 UI 类型 |
| `dom-static-ui` | 稳定的按钮、标签、筛选面板和非输入型下拉选项 | 通过区域及稳定性检查后接受 |
| `dom-input-derived` | 输入建议、自动完成、输入事件派生浮层 | 永不保存 |
| 空或未知来源 | 无法证明来源的 DOM 文本 | 拒绝 |

后台不会仅凭 `type=ui` 接受报告。DOM 报告必须同时携带 `source=dom-static-ui` 和白名单区域；
结构化报告必须携带 `source=trade-api`，且不能伪装成 UI。

## 输入派生内容识别

策略模块在捕获阶段监听 `beforeinput`、`input`、`compositionstart` 和 `compositionupdate`，但只在
内存中保留发生事件的控件引用和时间，不读取、复制或持久化控件的 `value`。以下内容会被拒绝：

- 位于 `input`、`textarea`、`contenteditable`、`role=textbox` 或 `aria-autocomplete` 内的文字。
- 位于 autocomplete、typeahead、suggest 或可编辑 combobox 组件内的选项。
- 通过 `aria-controls`/`aria-owns` 与可编辑控件关联的浮层列表。
- 输入事件后 2.5 秒内出现的下拉选项。
- 包含 `undefined`、不完整右括号或异常开头的渲染片段。

普通静态下拉在没有可编辑控件关联和近期输入事件时仍可进入候选，不会因为使用 `role=option`
而被一刀切禁用。

## 稳定性门槛

DOM 候选不会立即上报。文本必须持续 1.2 秒不变、节点仍连接在页面中，并在结束时再次通过完整
策略检查。输入过程中逐字变化或框架中间态会取消前一条候选。

## 旧记录迁移

旧版本的 `ui + dropdown-option` 记录没有 `source`，无法再证明它来自静态选项还是玩家输入。
升级后后台会清理这些无来源记录。官方下拉翻译继续由 Trade API 的稳定 option ID 负责，因此
不依赖这些低可信旧记录。

## 数据边界

漏译记录可以保存标准英文、稳定 ID、来源、粗粒度区域、次数和数据版本，但不得保存：

- 输入框内容。
- 输入建议和自动完成候选。
- 搜索结果价格、卖家、账号或私聊。
- Cookie、POESESSID 或页面历史。

本模块不新增浏览器权限，记录仍只保存在本地，除非用户主动导出。

## 回归测试

```powershell
node scripts/missing-report-policy-test.mjs
node scripts/bridge-context-smoke-test.mjs
node scripts/background-smoke-test.mjs
```

测试必须覆盖输入型浮层、ARIA 控件关联、中文输入法组合事件、静态下拉、文本稳定性、后台来源
白名单和旧记录迁移。任何新采集入口都必须先接入本模块，不能在业务代码中自行保存报告。
