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

打開 `http://127.0.0.1:8788/interview/`。網站根目錄會轉到這裡。沒有設定 `OPENROUTER_API_KEY` 時是示範模式：文字回答會得到依你打的內容產生的回饋；若送出錄音，逐字稿是預設例句，不是你的聲音。畫面上方會標明這一點。

## 接上 OpenRouter

金鑰只放在伺服器。瀏覽器看不到。模型呼叫走 OpenRouter 的 OpenAI 相容 Chat Completions：`POST https://openrouter.ai/api/v1/chat/completions`。每個請求帶 `HTTP-Referer: https://drcharming.net` 與 `X-Title: med-interview-coach`。舊的 `GEMINI_API_KEY` 不再使用。

本地：

```bash
cp .dev.vars.example .dev.vars
```

在 `.dev.vars` 填入 `OPENROUTER_API_KEY`。不要把這個檔案提交進 git。

預設模型（`wrangler.toml` 的 `[vars]`、`.dev.vars`，或 Cloudflare 的純文字變數都可以覆寫。儀表板若只能新增 secret，不設這兩個變數也會用程式裡的預設）：

| 變數 | 預設 | 用途 |
| --- | --- | --- |
| `OPENROUTER_MODEL` | `google/gemini-3.8-flash` | 面試官與教練。OpenRouter `reasoning.effort` 對應 Gemini `thinkingLevel`：面試官與反思為 low，教練報告為 medium |
| `OPENROUTER_TRANSCRIBE_MODEL` | `google/gemini-3.8-flash` | 把音檔轉成繁體中文逐字稿，並請模型回傳段落時間 |

`google/gemini-3.8-flash` 是 OpenRouter 上目前的 Gemini Flash（[模型頁](https://openrouter.ai/google/gemini-3.8-flash)），接受文字、圖片、音檔、影片與 PDF，只回文字。預設用它轉寫，才能明確要求繁體中文並保留「嗯、那個、就是」。不要改成只做語音轉文字的模型；這條路徑一律是 Chat Completions，不是 Gemini 舊的 Interactions API，也不是 OpenRouter 的 `/audio/transcriptions`。

上游等候時間：轉寫 120 秒，面試官與教練 60 秒。用量（`prompt_tokens`、`completion_tokens`、有回傳時的 `cost`）會寫進該次 JSON 的 `usage`，並 `console.log`。OpenRouter 會在每次回應自動附上用量，不需要再送 `usage.include`。

### 音檔格式

瀏覽器的 `MediaRecorder` 在 Chrome 會錄成 `audio/webm;codecs=opus`。後端去掉 codec 參數，把容器標成 `webm`，以 Chat Completions 的內容片段送出：

```json
{ "type": "input_audio", "input_audio": { "data": "<raw base64>", "format": "webm" } }
```

`data` 是原始 base64，不是 data URL。依據 [OpenRouter 音檔文件](https://openrouter.ai/docs/guides/overview/multimodal/audio)：

- Responses API（`/api/v1/responses`）的 `format` 只接受 `wav` 與 `mp3`。
- Chat Completions 接受上游供應商支援的任何格式字串，文件舉例有 `wav`、`mp3`、`aiff`、`aac`、`ogg`、`flac`、`m4a`、`pcm16`、`pcm24`。
- Gemini 接受 `audio/webm`（也接受 opus、ogg、mp4、wav、aac、flac）。見 [Gemini audio](https://aistudio.google.com/docs/audio)。

因此 webm/opus 原檔直接標成 `webm`，不轉成 wav。三分鐘的 PCM wav 經 base64 會超過目前約 6 MB 的音檔上限。不要把 webm 標成 wav：格式標錯時，模型會忽略音檔內容。

若 OpenRouter 拒絕 `webm` 這個 format 字串，JSON 錯誤的 `detail` 會帶上游 HTTP 狀態與錯誤訊息。那時可改錄它文件裡有舉例、Gemini 也接受的格式：`audio/ogg;codecs=opus`（format `ogg`）或 `audio/mp4`（format `m4a`）。Safari 本來就常錄成 `audio/mp4`。

## 部署到 Cloudflare Pages

這個專案自己一個 Pages 專案，預期名稱是 `med-interview-coach`，網址是 `https://med-interview-coach.pages.dev`。應用程式一律放在 `/interview/`，根目錄會轉址過去。`drcharming.net` 是另一個專案（`7harming/Oncall-simulation`），由那邊的 Pages Function 把 `/interview/*` 反代過來。

在 Cloudflare 儀表板用 Git 接上這個儲存庫：

1. Workers & Pages → Create → Pages → Connect to Git，選 `7harming/med-interview-coach`。
2. 專案名稱填 `med-interview-coach`。Production branch 填 `main`。
3. Build command 留空。Build output directory 填 `public`。
4. 儲存並部署。沒有建置步驟；`functions/` 會跟著 Pages 一起部署。

金鑰在儀表板設定，不要寫進 git：

1. 打開該 Pages 專案 → Settings → Variables and Secrets。
2. 新增加密的 secret，名稱 `OPENROUTER_API_KEY`，貼上 OpenRouter 金鑰。Production 要勾。舊的 `GEMINI_API_KEY` 可以刪掉，程式不再讀它。
3. 再新增一個加密 secret，名稱 `INTERVIEW_PROXY_SECRET`。自己產生一組夠長的隨機字串，Production 要勾。同一個值也要設在 `drcharming.net` 那個 Pages 專案（Oncall-simulation）。兩邊不一致時，反代流量會被算成同一個邊緣 IP。
4. 可選的純文字變數：`OPENROUTER_MODEL`、`OPENROUTER_TRANSCRIBE_MODEL`。沒設時用 `wrangler.toml` 的 `[vars]`，或程式內建的 `google/gemini-3.8-flash`。

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

`https://med-interview-coach.pages.dev/` 會 302 到 `/interview/`。方法、query、body 與 `Content-Type` 要原樣轉送。頁面與 API 回應都帶 `Permissions-Policy: microphone=(self)`，反代請把這個標頭傳回瀏覽器，麥克風才不會被策略擋下。

Cloudflare 打到 `*.pages.dev` 的子請求會改寫 `CF-Connecting-IP`，所以不能靠它分辨反代後面的訪客。反代要另外做兩件事：

1. 把訪客的 IP 放在 `X-Forwarded-For` 的第一個值。
2. 加上標頭 `X-Interview-Proxy-Secret`，值是兩邊 Pages 專案共用的 `INTERVIEW_PROXY_SECRET`。

密鑰以固定時間比較。對上了，速率限制用 `X-Forwarded-For` 的第一個位址；沒設密鑰、沒帶標頭或值不對，就只用 `CF-Connecting-IP`，並忽略 `X-Forwarded-For`，避免訪客自己偽造。這個程式不會把密鑰寫進日誌或回應。

## 速率限制

每個 IP、每小時大約：

- 轉寫 20 次
- 面試官 40 次
- 教練 12 次

音檔最長 3 分鐘、解碼後最大約 6 MB。超過會被拒絕。

沒有綁定 `RATE_LIMIT_KV` 時，次數記在該 isolate 的記憶體。重新啟動、或請求落到另一個節點，次數就歸零，擋不住分散式濫用。這是本機開發與尚未綁 KV 時的行為。

正式環境請用上一節的儀表板綁定。KV 只存 IP 的雜湊與次數，不存逐字稿。它是最終一致，短時間爆量可能略為超過上限。沒有使用 Durable Objects。直接連到這個專案的人依 `CF-Connecting-IP` 分桶；從 drcharming.net 反代、且密鑰正確的請求改依 `X-Forwarded-For` 的第一個位址分桶。

## 隱私

使用者可能是未成年人。

- 音檔與逐字稿只在那一次請求裡處理，用完即丟，不寫入資料庫、檔案或日誌。
- 有金鑰時，音檔會由後端經 OpenRouter 傳給 Google Gemini，不會由瀏覽器直接呼叫。失敗時回應只帶上游狀態與錯誤訊息，不帶金鑰。
- 完成的練習紀錄（逐字稿與回饋，不含音檔）只放在這台裝置的 `localStorage`。清除網站資料或按紀錄頁的清除就會刪掉。
- 請不要在回答裡說出身分證字號、病歷號或其他不必分享的資料。

## 限制

- 真實 MMI 一站常常是 5–7 分鐘。這裡每次錄音最長 3 分鐘，畫面上會同時標建議時間與上限。
- 沒有英文朗讀站、圖片題、生物化學實作、團體討論或演戲關。
- 題庫約 72 題，團隊合作略高於考古題裡單獨成類的比例，因為很多合作衝突原本被記在情境題。
- 示範模式的錄音逐字稿不是你的聲音。文字模式的回饋是規則產生的，不是模型。
- 教練分數不是任何學校的官方給分，也不能用來預測錄取。
- 段落時間是模型估計，不是強制對齊。語助詞次數是字面統計。
- 反思問題若模型失敗，回應是 `fallback: true` 與備用題，不會把失敗標成 `mock: false` 的正式結果。

## 改提示詞或題庫

可讀的提示詞在 `prompts/`，題庫與尺規在 `data/questions.json`、`data/rubric.json`。Cloudflare 建置用的 Wrangler 3 不能打包 `with { type: "json" }` 或 Markdown，所以執行：

```bash
npm run sync-prompts
```

會更新 `functions/_lib/prompt-texts.js` 和 `functions/_lib/data.js`。測試會確認它們和原始檔相同。

## 測試

```bash
npm test
```

涵蓋題庫結構、提示詞組裝、示範模式的 API、證據必須來自逐字稿，以及記憶體與 KV 形狀的速率限制。
