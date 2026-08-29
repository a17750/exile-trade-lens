# `trade.js` 歷史處理方式備忘

最後更新：2026-08-29

## 定位與來源痕跡

`trade.js` 是使用者提供的歷史參考腳本，不是 Exile Trade Lens 的運行時程式、建置輸入或自動更新來源。根目錄 `.gitignore` 明確排除 `/trade.js`，擴展包不會攜帶或執行它。

- 腳本名稱：`POE2 trade 繁体`
- 參考版本：`4.27`
- 參考檔 SHA-256：`588984b2562b489ca28b934fb3177ba1fd25a36eabdb928bc38df9880182d1e6`
- 原作者標示：放课后

本文件只記錄其策略，方便日後比較或設計離線回退；禁止直接複製整份詞庫或把腳本重新接入專案。

## 物品名稱策略

腳本維護大型 `typeTransMap`，並對 `/fetch` 返回的 `baseType`、`name`、`typeLine` 分別執行完整鍵查找：

```js
if (item.item[field] && typeTransMap[item.item[field]]) {
  item.item[field] = typeTransMap[item.item[field]];
}
```

因此它的實際規則是「整個字段精確命中才替換」。例如：

```text
baseType: Composite Bow                 -> 合成弓
typeLine: Composite Bow of the Fletcher -> 無完整鍵，保留英文
```

這個策略的優點是簡單，而且不會在 `typeLine` 中只替換底材而產生中英混排；缺點是無法翻譯動態組合的魔法物品名稱，也不能自行跟隨遊戲版本更新。

其 `/data/items` 邏輯會把命中的 `name` 和 `type` 直接拼接，但沒有先證明兩部分都存在，因此不能照搬。Exile Trade Lens 已改為所有存在的組成部分全部命中才允許組合。

## 詞條與屬性策略

- `stats`：內嵌英文與台服快照，主要按 group/entry/option ID 對接。穩定 ID 對接的方向值得保留。
- 具體 `/fetch` 詞條：利用 `extended.hashes` 尋找翻譯模板並回填數值，但舊實作曾依賴陣列關係；本專案已增加英文模板形狀校驗。
- properties/requirements：`trans4twProps` 先按整句查表，失敗後會拆空格和做 `includes` 子串替換。這種猜測式回退不得用於物品名稱或正式詞條翻譯。
- UI：遍歷 DOM 文本並做字符串替換。這可作少量固定 UI 的最後兜底，但不能進入結果卡片或使用跨領域扁平詞庫。

## 未來允許借鑑的部分

如果未來需要極端離線模式，可以借鑑「整字段精確命中、未命中保留英文」作最低層回退，但必須滿足：

1. 對照已遷移到本專案正式來源並保留來源指紋；不得在運行時載入 `trade.js`。
2. 優先級低於官方 Trade ID、同版本 GGPK 穩定鍵和人工審核資料。
3. 禁止子串替換、普通分詞猜譯和殘缺組合。
4. 命中只代表顯示回退，不能反向證明官方語義或覆蓋高優先級衝突。

## 社群下拉搜尋方案對照

2026-08-29 核對 [`Hsiung-Shao/poe-market-zh` 的 `page/stat-search.js`](https://github.com/Hsiung-Shao/poe-market-zh/blob/main/page/stat-search.js)。它不改寫官方選項的 `name/type/id`，而是在 MAIN world 對官網 Vue multiselect 的 `filteredOptions` watcher 增補顯示標籤命中的原始選項。這避免了中文或自訂 ID 被送進官方搜索 API。

Exile Trade Lens 曾試做同類 `page/dropdown-search.js`，但 2026-08-29 真頁驗證發現目前官網生產構建沒有在物品輸入框或祖先節點暴露 `__vue__`。這條依賴框架私有欄位的路線已完整撤除，不作靜默兼容層保留。

目前改為可逆資料邊界：本地目錄的已確認 `name/type` 使用「繁中（官方英文）」別名供官網原生過濾；發出 `/api/trade2/search/` 前僅按精確映射還原 `query.name/query.type`。這與社群 watcher 方案的共同安全邊界仍是“不把中文或自訂 ID 送給官方”，但不再依賴 Vue 內部結構，也不實作模糊評分、縮寫或猜測匹配。

## 本次實現的差異

本次沒有沿用 `typeTransMap`。魔法裝備名稱改由同版本英文/繁中 `Mods.datc64` 按 `Mod ID` 配對，僅採用 `Domain=ITEM` 且 `GenerationType=PREFIX/SUFFIX` 的無衝突名稱；運行時再與 `BaseItemTypes` 底材對照組合。任一部分缺失或多義時仍整段保留英文。
