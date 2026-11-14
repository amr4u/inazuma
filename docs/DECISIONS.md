# 架構決策紀錄

這份文件記錄**產品與架構決策**，避免後續擴充時遺失最初的需求。以下狀態是設計決策，不代表功能均已完成實機驗證。

| ID | 決策 | 理由／影響 |
|---|---|---|
| D-001 | 專案定位為通用自動填寫表單，而非只用於會員註冊 | 可涵蓋註冊、配送、報名、問卷等用途 |
| D-002 | **Firefox-only**，支援 Desktop 與 Android | Android Firefox 支援 WebExtensions，不需要為 Chrome 維護相容層 |
| D-003 | 不依賴瀏覽器原生 Autofill | 一般 Extension 無法取得原生 Autofill 儲存的完整個人資料 |
| D-004 | Decision API 從頁面語意分析階段就參與 | 避免退化成純粹欄位 `name` → 資料鍵對照器 |
| D-005 | Decision Provider 可替換；第一版 Clef-omni、BYOK | 支援未來不同 Decision API；不用自建後端 |
| D-006 | Profile 獨立模組，支援多份與自訂欄位 | 領域資料管理不依賴 DOM 或雲端模型 |
| D-007 | ProfileVault 的 KeyProvider 和 Repository 分離 | 日後可替換儲存與解鎖機制，避免重寫整體表單引擎 |
| D-008 | 第一版使用者主密碼加密 Profile | Firefox Desktop／Android 可用 Web Crypto；不預設 Passkey 或原生程式 |
| D-009 | 純 Extension：無後端、Native Messaging、本機輔助程式 | 維持 Android 可用與安裝簡單 |
| D-010 | 只填入欄位、不自動提交 | 讓使用者確認內容後再送出 |
| D-011 | Profile 實際值不傳送給 Decision Provider | 模型只選擇欄位語意與 Profile key，實際值在 Extension 內解析 |

## 未定事項

- Firefox Android 上是否需要專用 Popup、Options 導覽方式。
- 高階表單（複雜選單、Shadow DOM、iframe）支援範圍及優先順序。
- Provider 的信心分數如何校準，以及多階段決策流程的契約。
- Vault 主密碼變更、KDF 更新與復原策略。
- 本機測試穩定後的 AMO 發布與隱私權揭露文件。
