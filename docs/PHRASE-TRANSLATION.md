# 詞組與詞條翻譯對照規範

最後更新：2026-08-29

本文件定義「英文詞組如何找到繁中對照」以及「交易結果如何安全套用對照」。目標不是把所有英文切成單字再逐一翻譯，而是在保留遊戲語義、詞條數值和物品命名規則的前提下，使用可追溯的證據完成翻譯。

## 1. 先分辨七種資料

| 領域 | 例子 | 穩定鍵 | 主要來源 | 運行時處理 |
|---|---|---|---|---|
| 交易站 UI、篩選器 | `Clear Filter Group`、`Weapon` | UI/篩選器 ID 或完整英文 | Trade API、專案 UI 詞庫 | 完整文字或穩定 ID |
| 數值詞條模板 | `#% increased Spirit` | `explicit.stat_3984865854` | 英文/台服 Trade API | ID 與英文模板雙重校驗，再填入實際數值 |
| 詞條特殊渲染 | `Always Poison on Hit with this Weapon` | `explicit.stat_3885634897` + 完整渲染文字 | 英服/台服 `/fetch` 同一物品字段 | 先按 ID 限域，再精確匹配該 ID 的已驗證變體 |
| 基礎物品與固定名稱 | `Slim Mace`、暗金名稱 | GGPK 行 ID 或完整英文 | `Content.ggpk`（只讀） | 完整名稱匹配 |
| 稀有名稱組件 | `Golem`、`Crack` | GGPK Words 行 ID/英文組件 | `Words.datc64` | 僅在稀有名稱域做組件拼接 |
| 魔法裝備前後綴 | `Frosted`、`of the Fletcher` | `Mods.Id` + `Domain` + `GenerationType` | 英繁 `Mods.datc64` | 僅在魔法 `typeLine` 按前綴/底材/後綴組合 |
| 普通品質展示模板 | `Superior {0}` | `ClientStrings.Id=QualityItem` | 英繁 `ClientStrings.datc64` | 僅在 `frameType=0` 的 `typeLine` 完整套用 |

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

### 2.2 同一 stat ID 的官方特殊渲染

官方 `/data/stats` 只提供篩選器模板，但 `/fetch` 可能根據數值或顯示規則改寫句子。例如
`explicit.stat_3885634897` 的目錄模板是 `#% chance to Poison on Hit with this weapon`，數值為
100% 的物品卻顯示 `Always Poison on Hit with this weapon`。這兩句形狀不同，不能用一般 `#` 替換處理。

這類資料寫入 `sources/verified-stat-renderings.zh-TW.json`，並保留英服與台服 `/fetch` 的
query ID、item ID、原始 description 和相同 hash。構建後只把運行所需內容掛在原 stat ID 下：

```json
{
  "explicit.stat_3885634897": {
    "english": "#% chance to Poison on Hit with this weapon",
    "text": "用此武器擊中時有#%機率造成中毒",
    "renderings": [
      {
        "english": "Always Poison on Hit with this weapon",
        "text": "用此武器擊中時會造成中毒",
        "source": "official-trade-fetch-pair"
      }
    ]
  }
}
```

`renderings` 不是全局 `exact`。即使另一個 stat ID 返回同一句英文，也不得借用這筆翻譯。

### 2.3 完整英文對照

`exact` 用於 UI、物品和詞條模板的完整英文對照，例如：

```json
{
  "# to Level of all Minion Skills": "全部召喚物技能等級#",
  "#% increased Spirit": "增加#%精魂"
}
```

它是反查和兜底索引，不取代 stat ID。相同中文可能對應多個 ID 時，必須優先使用 ID 及英文模板校驗。

### 2.4 詞組組件

`wordComponents` 只收錄可獨立出現在隨機命名規則中的組件，例如：

```json
{
  "Golem": "魔像",
  " Crack": " 裂骨錘"
}
```

前導空格、後綴空格和大小寫是組件邊界的一部分，不能在匯入時隨意 `trim`。組件翻譯只允許套用於 GGPK/Trade API 判定的隨機名稱域，不能把 `Slim Mace` 這類基礎類型拆成一般單字翻譯。

### 2.5 魔法裝備前後綴

`affixNames.prefixes` 和 `affixNames.suffixes` 來自同一遊戲版本的英文/繁中 `Mods` 表。建置只接受 `Domain=ITEM`，並按穩定 `Mods.Id` 校驗兩種語言的行；同一英文若對應多個繁中結果，整個英文鍵進入 conflict，不加入運行詞庫。

```json
{
  "prefixes": { "Frosted": "結霜的" },
  "suffixes": {
    "of Osmosis": "逆滲透之",
    "of the Fletcher": "製箭者之"
  }
}
```

### 2.6 普通品質展示模板

`itemDisplayTemplates.quality` 只保存經過穩定 ID 審核的 `ClientStrings.QualityItem`：

```json
{
  "sourceId": "QualityItem",
  "english": "Superior {0}",
  "text": "精良的 {0}"
}
```

它與 `Mods` 中名稱同為 `Superior` 的魔法詞綴不是同一領域，不能互相借用譯文。構建器會檢查
英文模板和中譯都保留唯一 `{0}`；模板結構變化時直接中止構建，等待重新審核。

## 3. 資料來源優先級

每一筆翻譯都要保留來源和版本，合併順序如下：

1. 英服/台服官方 Trade API：目錄資料按穩定 ID 對齊；特殊渲染必須由兩端 `/fetch` 的同 hash 證明。
2. 本機 `Content.ggpk`：基礎物品、技能名稱、客戶端標籤和命名組件，只讀解析，不修改遊戲檔案。
3. 專案人工覆蓋：`sources/manual-overrides.json`，必須寫 `expectedEnglish`。
4. 專案詞庫與受鎖定版本的第三方名稱表：只作缺口補全和衝突審計。
5. 組件拼接或未翻譯回退：只在證據不足時使用，並進入漏譯報告。

如果高優先級來源和人工資料衝突，建置會產生 conflict/review 記錄；不得用一次性的整表覆蓋掩蓋衝突。

## 4. 運行時匹配流程

### 4.1 UI、篩選器和資料目錄

先以 API 穩定 ID 找到翻譯，再用完整英文作顯示校驗。選項使用 option ID，不按選項在陣列中的位置配對。

物品資料目錄中的 `name` 和 `type` 是同一顯示名稱的組成部分。只要原文存在其中一部分而該部分沒有可靠譯文，就不組合殘缺中文，整個 `entry.text` 保留英文。

### 4.2 `/fetch` 物品名稱

- `baseType`：只查基礎物品表。
- 固定暗金名稱：只查固定名稱表。
- 稀有 `name`：先查完整名稱，再嘗試 GGPK `Words` 組件的唯一完整拼接。
- 魔法 `typeLine`：以原始 `baseType` 精確切分前綴和後綴，分別查 `affixNames.prefixes/suffixes`；前綴、底材、後綴全部命中才組合。
- 普通 `typeLine`：原文等於 `baseType` 時只翻譯底材；原文完整符合 `itemDisplayTemplates.quality` 時才套用官方品質模板。其他展示修飾不猜譯，保留英文並上報。
- 任一部分缺失或存在多解時，整段保留英文。禁止在完整名稱失敗後只替換其中的基礎類型。

因此 `Slim Mace -> 纖細之錘` 不應影響 `Golem Crack -> 魔像 裂骨錘`。

雙語模式的合法結果是「完整繁中（完整英文原文）」，例如 `結霜的反曲弓逆滲透之 (Frosted Recurve Bow of Osmosis)`。`Frosted 反曲弓 of Osmosis (...)` 這種中英文殘片混合屬於錯譯；在前綴、底材和後綴尚未全部可靠對齊時，應顯示完整英文。

### 4.3 `/fetch` 數值詞條

交易 API 同時返回具體詞條文字（如 `36% increased Spirit`）和 `extended.hashes`。目前採用以下安全順序：

1. 在該 ID 自己的 `renderings` 中精確匹配已驗證的特殊渲染；唯一命中時直接採用對應繁中。
2. 未命中特殊渲染時，讀取該 ID 對應的英文目錄模板，確認它能匹配當前完整英文詞條。
3. 若 hash 的位置與英文模板不一致，使用完整英文模板反查，而不是相信陣列位置。
4. 僅有一個候選模板時才填入繁中模板。
5. 從當前英文詞條提取數值，再填入 `#`；不重用相鄰詞條的數值。
6. 無法確認時保留英文並上報 `association-mismatch`，禁止猜翻。

例如：

```text
36% increased Spirit
  -> 增加36%精魂

+1 to Level of all Minion Skills
  -> 全部召喚物技能等級+1
```

即使 `hashes` 兩筆資料的陣列順序反了，也必須得到上面的結果。

### 4.4 單複數與其他官方渲染變體

同一個 stable stat ID 可能有不同的官方渲染文字，例如 `Has 1 Charm Slot` 與 `Has 2 Charm Slots`。這些不是新的詞條，也不能靠英語複數規則猜測；它們必須在 `sources/verified-stat-renderings.zh-TW.json` 以同一 ID 的 `variants` 獨立登記，並保留英服/台服官方 `/fetch` 的成對證據。

運行時先在該 ID 的已驗證 `renderings` 中匹配完整英文形狀，再回退到目錄主模板。變體只影響顯示和數值回填，不會進入全局 `exact` 詞典，也不會被其他 stat ID 借用。沒有證據或形狀不一致時保留英文並上報。

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
- 特殊渲染的 `expectedCatalogEnglish` 未漂移，英台證據 hash 均等於該 stable ID，且變體沒有重複衝突。
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
3. 一般人工修正必須附 `expectedEnglish`、原因和來源；官方特殊渲染必須附英台 `/fetch` 成對證據；不要直接改生成檔 `bundled.json`。
4. 若是詞組組件，確認空格、大小寫、可組合位置和適用的 `frameType`。
5. 執行建置、品質門檻和回歸測試，再提交生成資料和報告。

生成的 `bundled.json` 可以被瀏覽器擴展自動更新；源文件和建置報告則是校對、回滾及版本追蹤的依據。
