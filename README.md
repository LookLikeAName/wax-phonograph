# 蠟筒留聲機 · Le Phonographe à Cylindre

一台在瀏覽器裡運作的 3D 愛迪生式蠟筒留聲機，也可以當成桌面音樂播放器使用。

錄音時，聲音驅動刻刀，在蠟筒表面的高度場上刻出溝槽；播放時，球形唱針沿著溝槽滑動，再把位移轉回聲音。你聽到的失真與雜音都是這個物理過程算出來的——針尖大小、循跡失敗、磨損、溝壁切穿的回音、灰塵與刮痕——而不是事後疊上去的音效。

線上版：<https://wax-phonograph.pages.dev>

## 功能

- **錄音**：匯入音檔、麥克風、內建旋律或測試訊號，即時刻進蠟筒；也可以「直接刻成蠟筒」，不必等實際時間。
- **播放**：唱針物理、喇叭與振膜共鳴、轉速與音高的關係；錄音與播放各有一組驅動與失真設定，可分開調整。
- **三種蠟材**：棕蠟、黑蠟（每吋 100 圈）與琥珀蠟（每吋 200 圈，約 4 分鐘）。
- **蠟筒架**：多支蠟筒分組、拖曳排序、同組無縫接續播放。
- **剖面視窗**：即時顯示溝槽縱剖面、橫剖面、唱頭機構與能量路徑。
- **輪播模式**：只留播放列，循環播放架上所有蠟筒，鏡頭自動巡覽留聲機各部件並附上說明字卡。
- **存檔與匯出**：`.waxrack` 保存刻痕、磨損、群組與設定；也可匯出 WAV。匯出前可選擇是否包含轉速調整與失真。
- **離線版**：整個程式建置成單一 HTML 檔，雙擊就能用，不需要網路。
- **桌面版（Windows）**：存檔對話框、從檔案總管開啟檔案、系統匣、關閉視窗後繼續在背景播放。

### 快捷鍵

| 按鍵 | 動作 |
|---|---|
| 空白鍵 | 播放／停止 |
| R | 錄音 |
| M | 靜音 |
| T | 輪播模式 |
| Esc | 結束輪播（播放繼續）；不在輪播時停止 |

拉桿可以用滑鼠滾輪逐格微調（按住 Shift 一次 10 格），雙擊拉桿恢復預設值。

## 開始使用

需要 Node.js 22 以上。

```bash
npm install
npm run dev      # 開發用 dev server
npm run build    # 建置成 dist/index.html
```

`dist/index.html` 是單一檔案，JS、CSS 與 three.js 都已內嵌：可以直接雙擊用 `file://` 開、離線使用，也可以放到任何靜態網站主機。專案根目錄的 `index.html` 只是 Vite 的入口，不能直接開啟。

字型從 Google Fonts 載入；沒有網路時會改用系統的襯線字體，功能不受影響。

### 桌面版（Electron）

```bash
npm run electron   # 建置後用 Electron 開啟
npm run dist:win   # 打包 Windows 版到 release/
```

打包出兩種免安裝版本：

- `WaxPhonograph-<版本>-win-x64.zip`：解壓縮後執行 `WaxPhonograph.exe`，啟動較快。
- `WaxPhonograph-<版本>-portable.exe`：單一執行檔，每次啟動會先解壓到暫存資料夾。

桌面版的額外功能：

- 把 `.waxrack` 或音檔拖到 exe 上、或用「開啟檔案 → 選擇其他應用程式」指定本程式，就會載入。若還沒按「開啟留聲機」，檔案會先排隊，開啟後才載入。
- 只會執行一個實例：再次開啟時，檔案會交給已開著的視窗。
- 系統匣選單：顯示視窗、播放／停止、停止、結束。關閉視窗只會縮到系統匣，播放不中斷。
- 記住視窗大小與上次存檔的資料夾。

主程序支援兩個環境變數：`PHONO_DEV_URL`（改載入 Vite dev server）與 `PHONO_TEST_SAVE_DIR`（測試用，跳過存檔對話框，直接寫入這個資料夾）。

### 部署

建置產物只有 `dist/index.html` 一個檔案，放上任何靜態主機即可。`tools/deploy_pages.sh` 是部署到 Cloudflare Pages 的範例腳本：會先建置，再用 wrangler 上傳（需要先 `npx wrangler login`）。

## 測試

測試讀取建置好的 `dist/index.html`，所以要先 `npm run build`。瀏覽器測試需要 Python 3 與 Playwright（`pip install playwright`、`python -m playwright install chromium`）。

```bash
python3 tools/check_syntax.py                                  # 對 src/ 下的 JS 做語法檢查
python3 tests/make_test_audio.py                               # 產生 8 秒測試音檔（~/phono-test/tone.wav）
python3 tests/smoke_test.py ~/phono-test/tone.wav out/         # 端對端：刻錄 → 群組 → 存檔 → 載入 → 換排
python3 tests/offline_check.py                                 # 斷網用 file:// 開啟離線版
python3 tests/layout_check.py                                  # 多種解析度下面板是否重疊（含截圖）
node tests/electron_check.mjs                                  # 桌面版端對端（Linux 無頭環境用 xvfb-run -a 執行）
```

無頭 Chromium 以軟體算繪 3D 很慢，所以測試會把畫質預設成「關閉 3D」。桌面版測試在無 GPU 的環境用 SwiftShader 軟體 WebGL；不要加 `--disable-gpu`，那會讓 WebGL 無法建立。

## 專案結構

| 路徑 | 說明 |
|---|---|
| `index.html` | Vite 入口（HTML 外殼） |
| `src/main.js` | 主程式：3D 場景、介面、音源、蠟筒架、存檔與匯出 |
| `src/style.css` | 樣式 |
| `src/worklet/phono.js` | AudioWorklet：刻錄與播放的物理模擬。以字串匯入，執行時用 Blob URL（`file://` 下改用 data URL）載入 |
| `src/platform/` | 平台層：網頁版（`web.js`）與桌面版（`electron.js`）共用同一份程式，差異只在這裡 |
| `electron/main.js` | Electron 主程序：視窗、存檔對話框、開檔、單一實例、系統匣 |
| `electron/preload.cjs` | preload：在 `contextIsolation` 與 `sandbox` 下提供 `window.phonoDesktop` |
| `build/` | App 與系統匣圖示 |
| `tools/` | 語法檢查、部署腳本 |
| `tests/` | 端對端、離線、版面與桌面版測試 |

### 平台層

`src/platform/index.js` 偵測到 `window.phonoDesktop` 時使用桌面版實作，否則使用網頁版。所有檔案讀寫都要經過它：

| 方法 | 說明 |
|---|---|
| `saveFile(blob, 檔名)` | 回傳存檔路徑；使用者取消時回傳 `null`。網頁版是觸發下載，無法得知是否取消，一律回傳檔名 |
| `onOpenFile(cb)` | 僅桌面版：從外部開啟檔案時收到 `{name, data}` |
| `onCommand(cb)` | 僅桌面版：系統匣選單的指令（`'toggle-play'`、`'stop'`） |

## 架構

```
┌──────────── 主執行緒（src/main.js） ──────────────────────┐
│ P：物理參數（送進 worklet）   U：介面與效能設定            │
│ SPEC → buildPanel()：設定面板全部由這張表產生              │
│ rack[]：蠟筒架（量化成 Int16 存在主執行緒）                │
│ three.js 場景：留聲機、房間、桌上的蠟筒架                  │
│ 2D 畫布：剖面視窗、唱頭剖面、深度圖、音檔控制台            │
└──────────────┬───────────────────────────────▲─────────────┘
     port.postMessage                          │ st / tex / swapped …
┌──────────────▼───────────────────────────────┴─────────────┐
│ AudioWorklet `Phono`（src/worklet/phono.js）                │
│ z[]：刻痕高度（µm，負值是切入深度）   wear[]：磨損          │
│ 錄音：輸入 → 錄音號角濾波 → 蠟材低通 → 刻刀寫入 z          │
│ 播放：球針包絡 → 單邊接觸＋循跡加速度上限                  │
│       → 振膜／號角濾波 → 輸出，同時累積磨損                 │
│ 驅動：發條馬達（含抖動）或手搖曲柄（飛輪、齒輪比、限速）  │
└─────────────────────────────────────────────────────────────┘
```

錄音與播放各有一組驅動設定（方式、轉速、齒輪比、限速器、抖動）與喇叭共鳴開關：錄音用 `r` 開頭的 key（`rDrive`、`rRpm`、`rRatio`、`rCrankGov`、`rFlutter`、`rFlutterAmt`、`rHorn`），播放用沒有前綴的同名 key。worklet 依目前模式選用；主程式用 `pm(k)` 取得目前實際使用的值。

### 空間模型

- 每圈 `N = 18000` 格，格距約 9.7 µm（周長 174.7 mm）。
- 每支蠟筒有 `T` 圈，資料長度為 `T × N`。
- 圈距：棕蠟、黑蠟 254 µm（每吋 100 圈）；琥珀蠟 127 µm（每吋 200 圈）。
- 刻紋區長 81.28 mm，容量為 `round(81280 / 圈距)`：棕蠟、黑蠟 320 圈，琥珀蠟 640 圈。
- 播放位置 `s` 以格為單位（浮點數）。轉速決定每個取樣前進幾格，時間完全由轉速推得。

### Worklet 訊息協定

**主執行緒 → worklet**

| type | 用途 |
|---|---|
| `params` | 更新物理參數（`WK` 集合裡的 key） |
| `record` / `play` / `stop` | 切換模式 |
| `seek` | 移動唱頭到位置 `s` |
| `crank` | 手搖輸入的角速度 |
| `setCylinder` | 換整支蠟筒：`id, T, z, wear` |
| `setNext` / `clearNext` | 預先交付下一支，用於無縫換筒 |
| `playEnd` | 內容終點，用於自動抬針或換筒 |
| `stopAt` | 錄到指定位置就停止 |
| `clearWear` | 清除磨損 |
| `snapshot` | 要求回傳 `z` 與 `wear` 的複本 |
| `fullTex` | 要求完整的貼圖資料 |
| `region` | 要求一段全解析度深度資料（深度圖用） |

**worklet → 主執行緒**

| type | 用途 |
|---|---|
| `st` | 狀態：位置、速度、模式、電平等，約 30 Hz |
| `tex` | 已更新的溝槽貼圖列 |
| `headDown` | 唱頭已放下 |
| `ended` | 結束；`reason` 為 `source` 或 `blank` |
| `swapped` | 已換到下一支蠟筒 |
| `snapshot` / `region` | 回應對應的請求 |
| `offCyl` | 離線刻錄時，每刻滿一支送出一次 |

### 離線渲染

匯出 WAV 與「直接刻成蠟筒」都使用同一份 worklet，跑在 `OfflineAudioContext` 裡：

- **匯出 WAV**：`renderRange()` 傳入 `processorOptions: {offline:true, T, z, wear, params, startS, endS}`。
- **快速刻錄**：`quickBurn()` 傳入 `processorOptions: {offline:true, offRec:true, T, params, recFrames, startS}`，worklet 每刻滿一支就送出 `offCyl`。速度遠快於實際時間（150 秒的音檔約數秒就能刻完）。

### 蠟筒架資料

```js
rack = [{ id, T, zq: Int16Array|null, wq: Int16Array|null, used, wax: 'brown'|'black'|'amber',
          group, name?, rec: { acc, n, set: {stylusR, tipOn, volume, cutterR, baseDepth, inGain, drive, targetRpm} } }]
groupMeta = { [gid]: { name } }                          // 群組名稱
groupOv   = { [gid]: { rpm, stylusR, tipOn, volume } }   // 使用者對整組的播放覆寫
```

- `zq`、`wq` 以 0.005 µm 為單位，刻痕為負值。
- 使用中那一支的資料在 worklet 裡，換下來時才用 `storeActive()` 取回並量化。
- `rack` 的順序就是播放順序，同一組的蠟筒連續排列。
- 架上最多 24 支，因為所有資料都放在記憶體裡。

### `.waxrack` 檔案格式（v3）

```
[u32 LE 標頭長度][標頭 JSON][cyl0.z 位元組][cyl0.wear 位元組][cyl1.z]…
```

- 標頭：`{magic:'WAXRACK', v:3, codec:'lpc2-rice', step, quality, N, active, cyls:[{T,used,wax,rec,group,name,zB,wB}], groupOv, groupMeta, seed, scratchCount, defects, waxColor}`。`groupOv` 與 `defects` 依存檔時的選擇決定是否寫入。
- 量化步距 `step`：0.005 µm（無損）、0.02（高品質）、0.05（精簡）。
- 壓縮：二階線性預測 `r = x − (2x₁ − x₂)`，zigzag 轉成非負整數後，每 4096 個值一個區塊做自適應 Rice 編碼。整塊殘差為 0 時只寫 1 bit；商數 ≥ 32 時改用 32 位元跳脫碼。
- 無損模式通常約為原始資料的 10%。
- 檔案可以再用 gzip 包裝，載入時自動判斷；也能讀取舊版 v2（未壓縮 Int16）與單支的 `WAXCYL` 格式。

## 程式碼地圖（`src/main.js`）

| 區段 | 搜尋關鍵字 |
|---|---|
| 參數與預設值 | `const P=`、`const U=`、`DEF_P`、`PRESETS`、`PERF_KEYS`、`WK` |
| 音訊啟動與訊息 | `initAudio`、`doRecord`、`doPlay`、`doStop` |
| 設定面板 | `const SPEC=`、`buildPanel`、`placeRec`、`layoutDock`、`onChange` |
| 版面與 3D 取景 | `frameView`、`body.compact` |
| 3D 場景 | `WAX_HEAD`（蠟面 shader）、`applyPerf` |
| 桌上蠟筒架 | `updateShelf`、`shelfView`、`goShelf` |
| 剖面視窗 | `drawMag`、`drawLong`、`drawCross`、`drawRepro` |
| 音檔控制台 | `FC=`、`drawFileWave`、`fileCueAt` |
| 快速刻錄 | `burnPlan`、`quickBurn` |
| 蠟材 | `WAXSPEC`、`applyWax` |
| 蠟筒架與群組 | `renderRack`、`setCylGroup`、`dropCyl`、`prepareNext`、`onSwapped`、`mount` |
| 輪播模式 | `TOUR`、`startCarousel`、`tourStep` |
| 存檔與匯出 | `askExport`、`saveRack`、`loadAny`、`exportAll`、`renderRange`、`encodeWav` |
| 桌面版開檔 | `openExternal` |

Worklet 的主要進入點：`class Phono`、`tip(`、`getZ(`、`msg(`。

## 物理驗證

物理行為可以用離線渲染重現與驗證，例如：

- 以 1 kHz 錄音、同轉速播放得到 1 kHz；以一半轉速播放時音高降低八度。
- 針尖半徑越大，高頻衰減越多。
- 換筒的接縫是連續的。
- 「訊號相加」疊錄是乾淨的線性相加；「真實物理」疊錄只保留切得最深的部分，會產生互調失真。

## 發展方向

桌面版的目標是成為真正的音樂播放器：

1. **工作區**：可以加入整個資料夾或單一檔案，追蹤每首歌的轉檔狀態。
2. **批次轉檔**：把選取的音樂轉成 `.waxrack`，輸出到使用者指定的資料夾；已轉過的檔案自動略過，中斷後可以接續。
3. **純播放模式**：不載入 3D 場景的輕量播放介面，含播放佇列、隨機與重複播放、媒體鍵。
4. 只把目前與下一首放在記憶體，取代現在蠟筒架 24 支的上限。

## 授權

使用 [three.js](https://threejs.org/)（MIT）。
