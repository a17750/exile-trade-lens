# 詞組與詞條翻譯對照規範

最後更新：2026-08-29

本文件定義「英文詞組如何找到繁中對照」以及「交易結果如何安全套用對照」。目標不是把所有英文切成單字再逐一翻譯，而是在保留遊戲語義、詞條數值和物品命名規則的前提下，使用可追溯的證據完成翻譯。

## 1. 先分辨四種資料

| 領域 | 例子 | 穩定鍵 | 主要來源 | 運行時處理 |
|---|---|---|---|---|
| 交易站 UI、篩選器 | `Clear Filter Group`、`Weapon` | UI/篩選器 ID 或完整英文 | Trade API、專案 UI 詞庫 | 完整文字或穩定 ID |
| 數值詞條模板 | `#% increased Spirit` | `explicit.stat_3984865854` | 英文/台服 Trade API | ID 與英文模板雙重校驗，再填入實際數值 |
| 基礎物品與固定名稱 | `Slim Mace`、暗金名稱 | GGPK 行 ID 或完整英文 | `Content.ggpk`（只讀） | 完整名稱匹配 |
| 隨機名稱組件 | `Golem`、`Crack` | GGPK Words 行 ID/英文組件 | `Words.datc64` | 僅在魔法/稀有名稱域做組件拼接 |

`trade.js` 只作歷史參考，不是本專案的運行時資料來源或邏輯依賴。

## 2. 對照資料的格式

### 2.1 穩定 ID 詞條

`extension/data/bundled.json` 的 `stats.entries` 儲存一個 stat ID 的繁中和英文模板：

```json
{
  "explicit.stat_3984865854": {
    "english": "#% increased Spirit",
    "text": "增加#%精魂",
    "type": "explicit"
  }
}
```

`english` 是當前官方英文模板，`text` 是對照模板。兩者的 `#` 佔位符數量必須一致。`options` 只用於有選項的篩選器或詞條。

### 2.2 完整英文對照

`exact` 用於 UI、物品和詞條模板的完整英文對照，例如：

```json
{
  "# to Level of all Minion Skills": "全部召喚物技能等級#",
  "#% increased Spirit": "增加#%精魂"
}
```

它是反查和兜底索引，不取代 stat ID。相同中文可能對應多個 ID 時，必須優先使用 ID 及英文模板校驗。

### 2.3 詞組組件

`wordComponents` 只收錄可獨立出現在隨機命名規則中的組件，例如：

```json
{
  "Golem": "魔像",
  " Crack": " 裂骨錘"
}
```

前導空格、後綴空格和大小寫是組件邊界的一部分，不能在匯入時隨意 `trim`。組件翻譯只允許套用於 GGPK/Trade API 判定的隨機名稱域，不能把 `Slim Mace` 這類基礎類型拆成一般單字翻譯。

## 3. 資料來源優先級

每一筆翻譯都要保留來源和版本，合併順序如下：

1. 台服官方 Trade API：`stats`、`static`、`filters` 按穩定 ID 對齊。
2. 本機 `Content.ggpk`：基礎物品和命名組件，只讀解析，不修改遊戲檔案。
3. 專案人工覆蓋：`sources/manual-overrides.json`，必須寫 `expectedEnglish`。
4. 專案詞庫與受鎖定版本的第三方名稱表：只作缺口補全和衝突審計。
5. 組件拼接或未翻譯回退：只在證據不足時使用，並進入漏譯報告。

如果高優先級來源和人工資料衝突，建置會產生 conflict/review 記錄；不得用一次性的整表覆蓋掩蓋衝突。

## 4. 運行時匹配流程

### 4.1 UI、篩選器和資料目錄

先以 API 穩定 ID 找到翻譯，再用完整英文作顯示校驗。選項使用 option ID，不按選項在陣列中的位置配對。

### 4.2 `/fetch` 物品名稱

- `baseType`：只查基礎物品表。
- 固定暗金名稱：只查固定名稱表。
- 魔法/稀有名稱：先查完整名稱，再嘗試 GGPK 組件的最少片段拼接。
- `typeLine`：先查完整類型；確認是名稱加基礎類型後，才替換基礎類型部分。

因此 `Slim Mace -> 纖細之錘` 不應影響 `Golem Crack -> 魔像 裂骨錘`。

### 4.3 `/fetch` 數值詞條

交易 API 同時返回具體詞條文字（如 `36% increased Spirit`）和 `extended.hashes`。目前採用以下安全順序：

1. 讀取該 ID 對應的英文模板，確認模板能匹配當前完整英文詞條。
2. 若 hash 的位置與英文模板不一致，使用完整英文模板反查，而不是相信陣列位置。
3. 僅有一個候選模板時才填入繁中模板。
4. 從當前英文詞條提取數值，再填入 `#`；不重用相鄰詞條的數值。
5. 無法確認時保留英文並上報 `association-mismatch`，禁止猜翻。

例如：

```text
36% increased Spirit
  -> 增加36%精魂

+1 to Level of all Minion Skills
  -> 全部召喚物技能等級+1
```

即使 `hashes` 兩筆資料的陣列順序反了，也必須得到上面的結果。

## 5. 佔位符和數值規則

- `#` 表示一個動態數值；英文和繁中模板數量必須相同。
- `+`、`-`、小數點屬於數值的一部分，例如 `+1`、`-20%`、`1.5%` 都要保留。
- 固定數字不是佔位符，例如 `per 10 Spirit` 中的 `10` 不可被當成物品當前數值。
- 顯示模式為雙語時，格式是「繁中（英文原文）」；純中文模式才移除英文。
- 不對已經包含中文的結果再次套用通用英文對照，避免結果卡片被錯誤 DOM 替換。

## 6. 自檢與品質門檻

建置和測試至少檢查：

- 英文/繁中佔位符數量一致。
- stat ID 的英文模板未過期；人工覆蓋的 `expectedEnglish` 仍與官方快照一致。
- `/fetch` 測試包含故意打亂 `hashes` 順序的案例。
- 未翻譯、來源衝突和 association mismatch 分別進入報告，不混成普通詞彙缺失。
- 結果卡片、輸入框和篩選器使用不同翻譯域，禁止扁平字典跨域覆蓋。

本地驗證命令：

```text
node scripts/build-data.mjs
node scripts/check-quality.mjs
node scripts/pipeline-test.mjs
node scripts/smoke-test.mjs
node scripts/background-smoke-test.mjs
```

## 7. 新增或修正一筆翻譯

1. 先確認它屬於哪個領域，不要直接把結果文字塞進 `exact`。
2. 可用官方 ID 時，優先修改對應的 ID 記錄。
3. 人工修正必須附 `expectedEnglish`、原因和來源；不要直接改生成檔 `bundled.json`。
4. 若是詞組組件，確認空格、大小寫、可組合位置和適用的 `frameType`。
5. 執行建置、品質門檻和回歸測試，再提交生成資料和報告。

生成的 `bundled.json` 可以被瀏覽器擴展自動更新；源文件和建置報告則是校對、回滾及版本追蹤的依據。
