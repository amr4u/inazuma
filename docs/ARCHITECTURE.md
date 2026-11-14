# 系統架構

## 目標與邊界

- 平台：Firefox Desktop／Firefox for Android，純 WebExtension，不使用 Chrome 內建 Autofill、後端或 Native Messaging。
- 功能：使用者手動啟動表單分析，從選取的本機 Profile 填入欄位；**不自動送出表單**。
- 模組化：Decision API Provider、ProfileVault KeyProvider、Profile Repository 均可獨立替換。
- 第一版：Cloudflare Clef-omni、密碼解鎖的加密 Vault、單頁 DOM 的原生表單控制項。

## 資料流

```text
[Firefox content script]
    Page Capture (DOM → PageSnapshot)
         │
         ▼
[Firefox background orchestration]
    ProfileService.getSchema(activeProfile)
         │                          │
         ▼                          ▼
    DecisionEngine ──→ DecisionProvider Adapter ──→ Cloudflare API
         │                              （只傳欄位語意與 Profile key）
         ▼
    DecisionPlan → validate → Action Resolver ← ProfileService.get(activeProfile)
         │                                          │
         ▼                                          ▼
[Firefox content script]                        [ProfileVault]
    Action Executor                                 │
         │                                encrypted storage.local
         ▼
    DOM fill report
```

- Capture 負責蒐集可操作候選欄位、附近文字、型別與選項；不把特定網站欄位名稱寫死。
- Decision Provider 在整張表單上下文中選擇對應的 Profile 資料鍵或略過。未來可擴增多階段頁面分析、控制項選項決策。
- Decision API **不取得 Profile 實際值**。欄位說明、頁面標題、網址（去除 query 與 fragment）、DOM 上下文會提供給遠端 Provider；網頁文字本身也可能包含個人資料，部署前需評估。
- Resolve/Executor 只在本地從解鎖的 Profile 取值並操作 DOM。填寫完畢不自動提交。

## 模組相依方向

```text
src/common          （純型別，不依賴其他模組）
  ├─ src/browser     （DOM 操作；不存取憑證）
  ├─ src/decision    （共通決策／驗證）
  │    └─ src/providers/cloudflare-clef-omni
  └─ src/profile     （資料、密碼加密與儲存；不依賴 DOM／Provider）

src/app/background   （組合模組、持有 Vault 與 Cloudflare 設定）
entrypoints          （WXT 背景／內容／Popup／Options 入口）
```

## 主要契約

| 契約 | 輸入／輸出 | 變更時應影響的範圍 |
|---|---|---|
| `PageSnapshot` | 頁面 URL、標題與表單欄位清單 | 內容擷取及相容的 Provider |
| `DecisionProvider.decide` | `PageSnapshot` + `ProfileSchema` → `DecisionPlan` | Provider Adapter |
| `ProfileService` | 列出／切換／儲存 Profile；產生 Schema；解鎖後取得值 | Profile 子系統 |
| `KeyProvider` | 保護／還原隨機 DEK | 特定金鑰實作與資料遷移 |
| `ProfileRepository` | 持久化 Vault 密文 Envelope | 儲存後端 |
| `applyActions` | DOM 元素識別碼 + 值 → 填寫回報 | Content Script |

## 加密與威脅邊界

- 使用 Web Crypto：PBKDF2-HMAC-SHA-256 從主密碼衍生 KEK；隨機 AES-256-GCM DEK 加密 Vault；KEK 再保護 DEK。
- `storage.local` 保存密文及 KDF salt、IV、版本等必要資訊，不能自行視為加密儲存。
- 不保存主密碼；解鎖後的資料和金鑰存在背景執行環境記憶體，重新鎖定時放棄參照，但不保證 GC 立即清除。
- 此方案主要降低 Firefox 設定檔／備份被離線複製後的資料外洩風險，**不能**防止已解鎖狀態、惡意擴充功能或遭入侵的執行環境造成的外洩。
- API Token 保存在同一 Vault。Profile 實際值不用於 Decision API 請求，但內容頁面的上下文會傳送到使用者指定的遠端 API。
- 忘記密碼且沒有額外復原機制時，無法還原資料；Encrypted Backup 不等於解密復原金鑰。

## 擴充方式

1. **新 Decision API**：實作 `DecisionProvider`，由 Adapter 處理 API 的批次與回應差異；共通決策介面不預設一定有機率分數。
2. **新金鑰方案**：實作 `KeyProvider`，並提供既有 Envelope 轉移／重新包裝流程，避免綁死 Passkey 或 OS KeyStore。
3. **新 Profile 格式**：升級文件版本與遷移程式；保留自訂欄位和多份 Profile。
4. **複雜 DOM**：在 Page Capture 與 Action Executor 擴充 Shadow DOM、iframe、多步驟表單；不修改 Vault 邏輯。

## 測試與已知限制

- `npm test`：單元測試與模擬背景程序填寫流程；不等於 Firefox 實機驗證。
- 尚需驗證：Firefox Desktop、Firefox Android、真實 Cloudflare Clef-omni 請求格式、相容性、AMO 簽署。
- 不含目前無法證實穩定支援的系統級加密／Passkey 解鎖功能。
