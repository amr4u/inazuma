# Decision Formfill — Firefox 專用表單自動填寫 Extension

**狀態：v0.1.0 技術原型。已通過離線自動化測試；尚未完成 Firefox 真機與 Cloudflare API 實測。**

使用 Cloudflare Clef-omni Decision API 分析頁面 DOM 的欄位語意，從使用者加密的多份 Profile 取得資料，一鍵填寫網頁表單。**目標支援 Firefox Desktop 140+ 與 Firefox for Android 142+，不使用瀏覽器內建 Autofill。**

## 設計要求

- **純 Extension**：沒有後端、Native Messaging、原生輔助程式，也不依賴其他瀏覽器。
- **Decision-driven**：AI 從 DOM 語意理解階段參與，而不只是根據欄位 `name` 分類。
- **多 Provider**：`DecisionProvider` 可替換，第一版實作 `CloudflareClefOmniProvider`。
- **多 Profile**：Profile 含自訂欄位；每份 Profile 可切換。
- **加密**：主密碼 PBKDF2-SHA-256 產生 KEK，包裝隨機 DEK，AES-256-GCM 加密 Profile、Cloudflare API Token 及設定；僅儲存密文。
- **後續金鑰方案**：`KeyProvider` 為獨立介面，未來可換成 Firefox 實際支援的系統金鑰方案。
- **不自動提交**：只填寫欄位，提交由使用者操作。

## 在 Firefox Desktop 試用

先在本機建置套件。正式開發建議使用 WXT；若已有全域 TypeScript 編譯器，也可執行 `npm run build:offline`。離線備援建置器僅供原型測試，不應取代正式建置流程。

**Firefox Desktop**：

1. 執行 `npm install && npm run build`，或使用離線備援方式 `npm run build:offline`；找到輸出目錄中的 `manifest.json`。
2. 前往 `about:debugging#/runtime/this-firefox`。
3. 按「Load Temporary Add-on」，選擇建置輸出的 `manifest.json`。
4. 開啟 Extension 的設定頁，建立主密碼；新增 Profile、填入個人資料及 Cloudflare Account ID／API Token。
5. 開啟一般網站表單，按 Extension 按鈕 → 解鎖 → 選 Profile →「智慧填寫目前頁面」。

> 臨時載入只適合開發與測試，重新啟動 Firefox 後可能需要再次載入。Firefox Android 正常安裝通常需要 AMO 簽署或開發者除錯流程；目前沒有提供已簽署的正式手機套件。

本機測試頁面：在專案根目錄執行 `python3 -m http.server 8765`，再開啟 `http://localhost:8765/fixtures/japanese-form.html`。

## 開發與測試

環境：Node.js 22+、TypeScript 5.8+。

```bash
npm install
npm test                   # 單元測試 + 背景程序整合模擬
npm run dev                # WXT Firefox 開發模式（需 npm install）
npm run build              # WXT Firefox MV2 正式建置
npm run build:offline      # 無 npm 網路時，用 TypeScript 打包到 dist-firefox-offline/
```

`build:offline` 是僅供本專案使用的簡易備援建置器，不是通用 bundler。官方 WXT 建置流程因本次環境無法連線 npm，**尚未實際執行驗證**。已使用離線工具檢查建置輸出 JavaScript 語法。

## 目錄結構

```text
src/common/         PageSnapshot、DecisionPlan、Profile 契約
src/browser/        DOM 擷取、表單值套用、content script bridge
src/decision/       DecisionProvider 介面、驗證及本機值解析
src/providers/      Cloudflare Clef-omni Adapter
src/profile/        ProfileService、ProfileVault、KeyProvider、Repository
src/app/            Firefox background 協調器與 UI RPC
entrypoints/        WXT Firefox content/background/popup/options
scripts/            離線 Firefox MV2 建置器
tests/              單元測試、模擬 API、背景程序整合測試
fixtures/           本機日文表單測試頁
```

參考 [架構設計](docs/ARCHITECTURE.md)、[模組契約與後續開發分工](docs/MODULES.md)、[架構決策紀錄](docs/DECISIONS.md)。

## Cloudflare API

使用者自備 Cloudflare Account ID 與 Workers AI API Token（BYOK）。

- Endpoint: `POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/@cf/cloudflare/clef-omni`
- 模型欄位：`model: "clef-omni"`
- 格式：`state` 搭配 `questions`，每次最多 64 題。
- 第一版每個 DOM 欄位提出一個 `choice` 決策，候選答案為 Profile key／`skip`。
- 表單語意描述與 Profile key 送往 Decision API；**Profile 真實值不在決策請求主體內**；但網頁欄位的文字、標籤和網址路徑會傳送到 Cloudflare。
- 加密的 API Token 由背景程序在解鎖狀態下讀取，作為 Authorization Bearer 使用。Firefox 權限宣告涵蓋傳送的網站內容、瀏覽資訊和 API 認證資訊（`websiteContent`、`browsingActivity`、`authenticationInfo`）。
- 下拉選單與 radio 先採用本機值／選項文字比對，尚無第二階段 AI 選項判斷。

官方參考：
- https://developers.cloudflare.com/workers-ai/models/clef-omni/
- https://www.extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/
- https://wxt.dev/guide/essentials/target-different-browsers

## 已知限制

1. **目前仍是原型**：沒有用真實 Firefox／Cloudflare 帳戶做端到端測試，請勿用於關鍵資料的正式作業。
2. 不支援 iframe、Shadow DOM、複雜自訂選單；動態重繪的表單可能需要重新分析。
3. 只實作一個 Provider，雖然架構允許增加其他 Decision API。
4. 加密 Vault 預設約 15 分鐘閒置後在下一次操作時鎖定。忘記密碼無法直接復原；請定期下載**加密備份**。
5. 密碼加密能保護離線檔案外洩，但不能保護已解鎖的 Extension 執行環境。
6. 跨裝置資料不會自動同步，可下載加密 JSON 備份後在另一台 Firefox 匯入。
7. `storage.local` 可能隨解除安裝而被刪除，因此備份很重要。
