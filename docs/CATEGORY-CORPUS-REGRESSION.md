# 道具分类语料与整体验证

## 目标

以交易站 `Item Category` 的完整选项为测试锚点，每个分类只采集首批 10 件物品，覆盖物品名、
基底、固有属性、需求、自带技能和各类词缀。该流程用于发现“整个领域缺失”，不再依赖用户逐张
截图指出单词。

## 数据流

```text
data/trade-api.json 中的 category option ID
  -> 国际服 /search + /fetch 首批 10 件
  -> 台服 /search + /fetch 首批 10 件
  -> 脱敏语料 data/corpus/category-pages.*.json
  -> 英文语料对当前构建数据做可解析性审计
  -> 英台语料按领域稳定键生成候选差异报告
  -> 回归门禁与人工审查
```

采集器不保存 `listing`、卖家、价格、Cookie、访问令牌或原始结果 ID。结果 ID 只保留单向
SHA-256 摘要，作为诊断辅助。语料是回归输入，不是通用翻译词典。

## 为什么不能自动把英台样本直接写进词库

国际服和台服是独立市场，同一分类抓到的不是同一批物品。`stat ID` 虽然稳定，但同一 ID 可能
根据数值、条件或物品上下文产生多个渲染模板。因此以下做法被禁止：

- 用国际服某件物品的第 N 条词缀与台服另一件物品的第 N 条词缀配对。
- 看到两边只有一个采样值，就假定它们必然是同一渲染变体。
- 将候选差异报告直接作为浏览器运行数据。

可以自动进入正式数据的仍然只有：官方目录相同 ID 的成对数据、同版本 GGPK 稳定结构、或有
完整英台模板证据的已审核变体。`reports/category-corpus-alignment.json` 明确标记
`promotionEligible: false`，只用于定位值得继续查证的领域。

## 命令

```powershell
node scripts/collect-category-corpus.mjs --locale en --page-size 10
node scripts/collect-category-corpus.mjs --locale zh-TW --page-size 10
node scripts/audit-category-corpus.mjs --locale en --strict
node scripts/align-category-corpus.mjs
```

采集按分类原子落盘，遇到限流或中断后可以直接重跑；已完成且 schema 相同的分类会跳过。

## 门禁

- 分类任务必须全部进入 `complete`，无结果的合法分类以 `0/0 complete` 计入。
- 英文语料的结构观测翻译覆盖率不得低于 80%。
- 未解析签名必须保留英文并进入报告，禁止混合翻译或猜测。
- 物品、过滤项、属性/词缀的既有确定性回归仍必须全部通过。

报告：

- `reports/category-corpus-coverage.en.json`：按分类与字段签名统计当前运行数据覆盖率。
- `reports/category-corpus-alignment.json`：独立英台样本的候选差异，仅用于审查。
