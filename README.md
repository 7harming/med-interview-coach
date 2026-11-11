# 醫學系模擬面試

給準備台灣醫學系個人申請、繁星二階的高中生。可以練單題、三到五題的短場面試，或一站有閱讀時間的 MMI。

面試進行中，教授只提問，不給提示、稱讚或示範答案。結束後才由教練依公開簡章的評分方向寫回饋，並引用你自己說過的話。這是練習，不是錄取預測。

題目是依 2016–2026 年公開考生回憶與 115 學年度簡章改寫的練習題，不是各校原題。研究怎麼整理、尺規怎麼訂，見 `docs/research-summary.md` 與 `docs/rubric.md`。

## 本地開發

需要 Node.js 22 以上。

```bash
npm install
npm test
npx wrangler pages dev public --port 8788
```

打開 `http://127.0.0.1:8788/interview/`。網站根目錄會轉到這裡。沒有設定 `GEMINI_API_KEY` 時是示範模式：文字回答會得到依你打的內容產生的回饋；若送出錄音，逐字稿是預設例句，不是你的聲音。畫面上方會標明這一點。

## 接上 Gemini

金鑰只放在伺服器。瀏覽器看不到。

本地：

```bash
cp .dev.vars.example .dev.vars
```

在 `.dev.vars` 填入 `GEMINI_API_KEY`。不要把這個檔案提交進 git。

預設模型（可在 `.dev.vars` 或 Cloudflare 環境變數覆寫）：

| 變數 | 預設 | 用途 |
| --- | --- | --- |
| `GEMINI_MODEL` | `gemini-3.8-flash` | 面試官與教練。`thinking_level` 面試官為 low，教練為 medium |
| `GEMINI_TRANSCRIBE_MODEL` | `gemini-3.8-flash` | 把音檔轉成繁體中文逐字稿，並請模型回傳段落時間 |

`gemini-3.8-flash` 是目前一般可用、可直接吃音檔的模型，因此預設用它轉寫，才能明確要求繁體中文並保留「嗯、那個、就是」。若改成 `gemini-3.5-transcribe`，後端會改走專用轉寫介面與字級時間戳；該模型公開語言表沒有 `zh-TW`（有簡體華語與粵語），不適合當這個產品的預設。

`GEMINI_MODEL` 與 `GEMINI_TRANSCRIBE_MODEL` 若要覆寫，在 Pages 專案的環境變數設定即可，它們不是密鑰。

## 部署到 Cloudflare Pages

這個專案自己一個 Pages 專案，預期名稱是 `med-interview-coach`，網址是 `https://med-interview-coach.pages.dev`。應用程式一律放在 `/interview/`，根目錄會轉址過去。`drcharming.net` 是另一個專案（`7harming/Oncall-simulation`），由那邊的 Pages Function 把 `/interview/*` 反代過來。

在 Cloudflare 儀表板用 Git 接上這個儲存庫：

1. Workers & Pages → Create → Pages → Connect to Git，選 `7harming/med-interview-coach`。
2. 專案名稱填 `med-interview-coach`。Production branch 填 `main`。
3. Build command 留空。Build output directory 填 `public`。
4. 儲存並部署。沒有建置步驟；`functions/` 會跟著 Pages 一起部署。

金鑰在儀表板設定，不要寫進 git：

1. 打開該 Pages 專案 → Settings → Variables and Secrets。
2. 新增加密的 secret，名稱 `GEMINI_API_KEY`，貼上 Gemini 金鑰。Production 要勾。
3. 可選的純文字變數：`GEMINI_MODEL`、`GEMINI_TRANSCRIBE_MODEL`。

可選的速率限制 KV：

1. 在 Workers & Pages → KV 建立一個 namespace。
2. 回到這個 Pages 專案 → Settings → Bindings → Add → KV namespace。
3. Variable name 必須是 `RATE_LIMIT_KV`，選剛建立的 namespace。Production 要綁。
4. 重新部署後才會生效。

## 給 drcharming.net 反代的路徑

反代要保留 `/interview` 前綴，不要拿掉。瀏覽器打 `https://drcharming.net/interview/...` 時，上游是同一個路徑的 `https://med-interview-coach.pages.dev/interview/...`。

| 瀏覽器 | 上游 |
| --- | --- |
| `https://drcharming.net/interview/` | `https://med-interview-coach.pages.dev/interview/` |
| `https://drcharming.net/interview/app.js` | `https://med-interview-coach.pages.dev/interview/app.js` |
| `https://drcharming.net/interview/styles.css` | `https://med-interview-coach.pages.dev/interview/styles.css` |
| `https://drcharming.net/interview/favicon.svg` | `https://med-interview-coach.pages.dev/interview/favicon.svg` |
| `https://drcharming.net/interview/paths.js` | `https://med-interview-coach.pages.dev/interview/paths.js` |
| `GET /interview/api/health` | 同上，pages.dev |
| `GET /interview/api/questions` | 同上 |
| `POST /interview/api/transcribe` | 同上 |
| `POST /interview/api/interview` | 同上 |
| `POST /interview/api/coach` | 同上 |

`https://med-interview-coach.pages.dev/` 會 302 到 `/interview/`。方法、query、body 與 `Content-Type` 要原樣轉送。

速率限制只認 `CF-Connecting-IP`。反代必須把訪客連到 drcharming.net 時的那個 `CF-Connecting-IP` 抄到上游請求。有這個標頭時，`X-Forwarded-For` 不會被拿來分桶，避免別人自己改標頭繞過限制。本機沒有 `CF-Connecting-IP` 時才退回 `X-Forwarded-For` 的第一個位址。

## 速率限制

每個 IP、每小時大約：

- 轉寫 20 次
- 面試官 40 次
- 教練 12 次

音檔最長 3 分鐘、解碼後最大約 6 MB。超過會被拒絕。

沒有綁定 `RATE_LIMIT_KV` 時，次數記在該 isolate 的記憶體。重新啟動、或請求落到另一個節點，次數就歸零，擋不住分散式濫用。這是本機開發與尚未綁 KV 時的行為。

正式環境請用上一節的儀表板綁定。KV 只存 IP 的雜湊與次數，不存逐字稿。它是最終一致，短時間爆量可能略為超過上限。沒有使用 Durable Objects。分桶用的是上游看到的 `CF-Connecting-IP`，所以反代一定要轉送訪客原本的那個值。

## 隱私

使用者可能是未成年人。

- 音檔與逐字稿只在那一次請求裡處理，用完即丟，不寫入資料庫、檔案或日誌。
- 有金鑰時，音檔會由後端傳給 Google Gemini，不會由瀏覽器直接呼叫。
- 完成的練習紀錄（逐字稿與回饋，不含音檔）只放在這台裝置的 `localStorage`。清除網站資料或按紀錄頁的清除就會刪掉。
- 請不要在回答裡說出身分證字號、病歷號或其他不必分享的資料。

## 限制

- 真實 MMI 一站常常是 5–7 分鐘。這裡每次錄音最長 3 分鐘，畫面上會同時標建議時間與上限。
- 沒有英文朗讀站、圖片題、生物化學實作、團體討論或演戲關。
- 題庫約 72 題，團隊合作略高於考古題裡單獨成類的比例，因為很多合作衝突原本被記在情境題。
- 示範模式的錄音逐字稿不是你的聲音。文字模式的回饋是規則產生的，不是 Gemini。
- 教練分數不是任何學校的官方給分，也不能用來預測錄取。
- `gemini-3.8-flash` 的時間戳是模型估計，不是強制對齊。語助詞次數是字面統計。

## 改提示詞

可讀的提示詞在 `prompts/interviewer.md`、`prompts/coach.md`、`prompts/transcribe.md`。Pages 無法直接打包 Markdown，所以執行：

```bash
npm run sync-prompts
```

會更新 `functions/_lib/prompt-texts.js`。測試會確認兩邊相同。

## 測試

```bash
npm test
```

涵蓋題庫結構、提示詞組裝、示範模式的 API、證據必須來自逐字稿，以及記憶體與 KV 形狀的速率限制。
