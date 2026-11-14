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

先在本機建置套件。開發可使用 WXT；本專案的原型簽署流程刻意沿用已測試的 `npm run build:offline` 打包器，輸出 `dist-firefox-offline/`，不代表 WXT 建置已經驗證。兩者都需要先安裝 lockfile 中的開發依賴。

**Firefox Desktop**：

1. 執行 `npm ci --ignore-scripts && npm run build:offline`（簽署流程的同一個建置），或使用 WXT `npm run build`；找到輸出目錄中的 `manifest.json`。
2. 前往 `about:debugging#/runtime/this-firefox`。
3. 按「Load Temporary Add-on」，選擇建置輸出的 `manifest.json`。
4. 開啟 Extension 的設定頁，建立主密碼；新增 Profile、填入個人資料及 Cloudflare Account ID／API Token。
5. 開啟一般網站表單，按 Extension 按鈕 → 解鎖 → 選 Profile →「智慧填寫目前頁面」。

> 臨時載入只適合開發與測試，重新啟動 Firefox 後可能需要再次載入。正常安裝需要 Mozilla 簽署；只有下方手動簽署工作流程成功產出的 `*-signed.xpi` 才可當作已簽署套件。Android 安裝與實機行為仍待驗證。

本機測試頁面：在專案根目錄執行 `python3 -m http.server 8765`，再開啟 `http://localhost:8765/fixtures/japanese-form.html`。

## 開發與測試

環境：Node.js 22+（release 固定 22.23.5）、lockfile 中的 TypeScript。Release 安全測試另需 Python 3.11+ 與 Git。

```bash
npm ci --ignore-scripts    # 依 package-lock.json 安裝固定依賴
npm test                   # 單元測試 + 背景程序整合模擬 + release 安全檢查
npm run dev                # WXT Firefox 開發模式（需 npm install）
npm run build              # WXT Firefox MV2 正式建置
npm run build:offline      # 無 npm 網路時，用 TypeScript 打包到 dist-firefox-offline/
```

`build:offline` 是僅供本專案使用的簡易備援建置器，不是通用 bundler。原型 release 會執行 `npm test` 及固定版本 `web-ext@10.5.0` 的 `lint --self-hosted --warnings-as-errors`。**WXT 正式建置、Firefox 真機及 Cloudflare API 的端到端行為仍未驗證**。

## Mozilla unlisted 簽署與 GitHub 原型 release

這個流程只在 GitHub Release **published** 時自動簽署，支援 stable 與 prerelease（包含從 draft 發布），不會因 push、tag push、draft、編輯 release 或上傳資產而觸發；本機建置不使用 AMO 憑證。

1. Repository 需已有 **`FIREFOX_AMO_API_KEY`**、**`FIREFOX_AMO_API_SECRET`** Actions secrets；只有簽署步驟將它們映射到 `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET` 環境變數，不放進參數、log 或 source ZIP。
2. 將審核過的工作流程與 helper 放在 default branch（`main`），再從一般 GitHub UI 或使用者的 `gh` 發布 Release。tag 必須精確等於 `v<package.json version>`，且兩份 manifest 設定的版本和 add-on ID **`decision-formfill@local.example`** 必須一致。Prerelease 是 GitHub Release 的狀態，不是額外加在 manifest-version tag 上的後綴；歷史 `v0.1.0-alpha.1` 不會重用或移動。
3. Trusted automation 獨立 checkout default branch；打包原始碼則 checkout **release tag 解析後的精確 commit**，不是 main。依 lockfile 安裝、測試/建置、self-hosted lint，產生 source-review 與 unpacked ZIP。Source ZIP 僅取該 commit 的 allowlisted Git blobs，包含 lockfile、[審核說明](.github/AMO_REVIEW.md) 和實際工具/OS/commit 的 `BUILD_INFO.json`；不含 automation checkout、未追蹤檔、`.git`、依賴或憑證。
4. 使用 unlisted channel，向 Mozilla 提交同一次建置的 source ZIP 與 reviewer notes。驗證返回 XPI 的 signature markers、ID/版本及與已測試 payload 逐檔位元組一致後，才上傳四份資產到**同一個既有 Release ID**，並下載讀回核對。此路徑不建立 tag/release、不覆寫資產，也不修改 title/body/prerelease/latest 狀態。
5. 既有四份完整資產會先下載，驗證 checksum 清單/摘要、manifest、signed/unpacked payload，以及 source ZIP 與 tag commit 相符，然後**跳過全部建置、簽署和上傳**；舊 tag 無需包含新版 helper。缺少任一資產、重名、額外衝突資產或內容不符都會中止，避免重送 Mozilla。

**觸發限制：** 另一個 workflow 使用 repository `GITHUB_TOKEN` 建立/發布的 Release **不會再觸發此 release workflow**。這類自動發布者須在同一 job 呼叫 signer、使用 reusable signer，或使用經適當授權的 GitHub App/PAT；本次不建立或配置任何新 token。

手動重試僅接受**已發布的既有 release tag**：在 **Sign published Firefox release** 選 default branch，輸入 `tag`，或在此 repository 執行：

```sh
gh workflow run release.yml --ref main -f tag=v0.1.0
```

完整 `v0.1.0` 資產通過上述驗證時，這是只讀檢查，不會重新送 Mozilla；原有 `v0.1.0` 與 `v0.1.0-alpha.1` 的 tag/資產不會變動。缺憑證、驗證/簽署失敗或 15 分鐘內未取得簽署結果都會中止，不發布 unsigned 替代品。若 Mozilla 已接受 submission、簽署逾時或 GitHub 僅收到部分資產，先檢查 AMO submission 與保存的 Actions artifact，由維護者恢復；**不要盲目重送同版本或刪除資產來重試**。

成功時 Actions artifact `inazuma-signed-release` 及原 GitHub release 會有（`<version>` 為該 tag 的實際版本）：

- `inazuma-v<version>-signed.xpi`：Mozilla unlisted 簽署套件。
- `inazuma-v<version>-unpacked.zip`：未簽署、可臨時載入的相同 payload。
- `inazuma-v<version>-source.zip`：同一次提交給 Mozilla 的可重建原始碼。
- `SHA256SUMS.txt`：上述三個檔案的摘要。

本機不簽署的檢查：`npm test` 後執行 `npx --no-install web-ext lint --self-hosted --source-dir dist-firefox-offline --warnings-as-errors`。在精確版本 tag 的乾淨 checkout 執行 `python3 scripts/firefox-release.py prepare`，可產生 source/unpacked ZIP（需尚無 `release/`），不需憑證。

**簽章不是端到端功能證明**：本地檢查 signature markers 不等於獨立驗證憑證鏈；Firefox 安裝時才執行簽章驗證。即使 Mozilla 簽署成功，也不代表 Firefox Android、Cloudflare API 或真實表單填寫已實測。


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
