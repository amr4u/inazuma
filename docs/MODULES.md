# 模組契約與後續開發分工

## 核心模組（彼此可獨立測試）

| 模組 | 實作 | 對外契約 | 依賴範圍 |
|---|---|---|---|
| Page Capture | `src/browser/capture.ts` | `capturePage(): PageSnapshot` | DOM |
| Decision Engine | `src/decision/provider.ts` | `DecisionProvider.decide(snapshot, schema)` | 共通型別 |
| Clef Adapter | `src/providers/clef-omni.ts` | 實作 `DecisionProvider` | Cloudflare REST API |
| Action Resolver | `src/decision/resolve.ts` | `resolveActions(snapshot,plan,profile)` | 共通型別 |
| Action Executor | `src/browser/filler.ts` | `applyActions(actions): FillReport` | DOM |
| Profile Service | `src/profile/service.ts` | `list/get/getSchema/resolve/save/remove/select` | Vault |
| Profile Vault | `src/profile/vault.ts` | `create/unlock/lock/read/update/import/export` | KeyProvider + Repository |
| Key Provider | `src/profile/key-provider.ts` | `protect/recover` | Web Crypto |
| Profile Repository | `src/profile/repository.ts` | `read/write` | Firefox storage.local |
| Background Orchestrator | `src/app/background.ts` | WebExtensions RPC | 全部核心模組 |
| UI | `entrypoints/popup/`, `entrypoints/options/` | `src/app/rpc.ts` | 背景 RPC |

## 相依方向

- `common` 不可依賴 browser、profile、provider。
- `profile` 不依賴 DOM，也不依賴 Decision API。
- `providers` 不可存取 Profile 真實值，不可操作 DOM。
- `browser` 不可知道 Cloudflare API 或 Vault 的加密方法。
- `app/background` 是唯一協調者，負責把上述模組接起來。

## 未來功能必須符合的驗收條件

1. 新增 Decision API：只需要新的 `DecisionProvider` 實作及 Provider 設定。
2. 新增金鑰解鎖方式：新增 `KeyProvider`；既有加密資料格式用 `kind` 區分，需安排資料遷移。
3. 修改 Profile 欄位：不改 Decision Provider；模型只看有值的欄位定義。
4. Desktop / Android：相同 TypeScript 核心，差異留在 Firefox UI 與 Manifest。
5. 真實 API 壓力測試：>64 題分批、錯誤回應、timeout、重試、輸入 token 消耗。
6. DOM 測試：分欄姓名、動態表單、受控 React 輸入、隱藏元素、Shadow DOM、iframe。

## 已知尚未完成（請勿誤認為正式版）

- Clef-omni 真實帳號端到端測試（需使用者 API Token）。
- Firefox Desktop／Firefox Android 的真實瀏覽器測試及手機 UI 微調。
- 複雜自訂日期選擇器與 React Select、Shadow DOM、iframe 支援。
- 手機上中斷後自動重新分析頁面、選項的第二階段 AI 判斷。
- 低信心配對的互動式預覽、使用者校正回饋及跨站學習。
- 密碼變更與復原方式、KDF 成本及儲存格式升級測試。
- AMO 審查、簽署與對外發行。
