# 2026 TTRA 檢定與挑戰賽成績系統

提供「檢定專區」與「挑戰賽專區」，由主辦人的 Linkt 分別連入，不另做總首頁。React + TypeScript + Vite 靜態前端部署於 GitHub Pages；Supabase 負責登入、PostgreSQL、權限、即時同步。

本賽事為單人賽。挑戰賽名單使用「參賽編號、姓名、組別、梯次」，學科名單使用「參賽編號、姓名」。不顯示或記錄學校，匯入時拒絕額外欄位。為測試 CSV 匯入，幼兒簡易機械組示範名單維持空白，其餘三組各有 6 位虛構參賽者；學科另有 4 位尚未登分的虛構參賽者。

## 本機操作

需要 Node.js 22.13 以上：

    npm ci
    npm run dev

沒有 Supabase 設定時顯示「示範模式」，可體驗挑戰賽計分、報到、梯次、CSV 匯入，以及學科登分和手動公布。**示範資料在同一頁切換專區時保留，但重新整理即重設，不能跨裝置或分頁同步，不可用於正式計分。**

複製 .env.example 為 .env.local，填入專案 URL 與 publishable key 即使用正式後端。不得放入 secret、service-role 或資料庫密碼。

## 入口與功能

- /#/challenge：挑戰賽家長端，無需登入。
- /#/challenge/staff：挑戰賽工作台。舊 /#/、/#/staff 仍可使用。
- /#/exam：檢定學科成績公告，無需登入。
- /#/exam/staff：學科登分與公布，正式模式以 Email 登入連結登入。
- 幼兒、動力、科創各 2 梯，程式 3 梯；兩端依梯次分段，也可篩選。各梯合併排名，畫面保留全組名次。
- 頂端人數統計只計目前組別的全部梯次，不因搜尋或梯次篩選改變。
- 四組固定計分、回合明細、排名、合格與未完成狀態。
- 報到、未報到、缺席、取消參賽；未報到不得送分。
- Realtime 加 10 秒補抓，離線禁止送分。
- CSV 匯入預覽、重複檢查、整批交易、不覆蓋原名單。
- 分組成績 CSV 匯出，防試算表公式注入。
- 分組裁判、報到人員與管理員；後端驗證權限。
- 原值、新值、操作者、原因與時間的修改紀錄。
- 唯一請求 ID 防重送、預期版本防止並行覆寫。

## 學科成績公布

- 僅記錄 0–100 分（最多一位小數），不包含術科、線上考試、排名或合格判定。
- 管理員匯入獨立學科名單；管理員及獲授學科權限的裁判可以登分與公布。
- 預計 2026/10/04（日）10:00 公布僅為提示，不會到點自動公開。
- 按「公布全部學科成績」後先確認已登分／未登分人數，再一次公開全部已登分資料。
- 未登分不是 0 分；未登分者不列入公告。草稿存放於私有資料表，家長 API 無法取得。
- 公布後的修正仍先存草稿，須再次按公布才更新家長端，保留操作與修改紀錄。
- 挑戰賽維持送分即公開，不受學科公布按鈕影響。

## 上線與測試

長期 repository：[JulianLu1028/ttra-score](https://github.com/JulianLu1028/ttra-score)。GitHub Pages 初期以明確啟用的 `demo` 模式展示；正式上線仍使用同一個 repository 與網址，改為 `production` 模式並接入已驗收的 Supabase。

參閱 [DEPLOYMENT.md](DEPLOYMENT.md) 與 [RULES.md](RULES.md)。

    npm test
    npm run build

測試使用 PGlite 執行真正 PostgreSQL / PLpgSQL、RLS 與權限情境，不需要 Docker。正式 Supabase Auth、SMTP、Realtime 與兩支手機賽前演練仍必須另外完成。

資料庫 public.results 是正式排名來源，前端 domain.ts 為示範與比對實作。公開資料不含裁判身份、內部備註或聯絡資料。

內部沿用 Team／teams／team_id 等初版識別名稱以維持介面相容，每筆實際代表個人，沒有團體或隊員資料。同名參賽者以不同參賽編號區分。舊版含學校或缺少梯次的 CSV 必須改用新版範本。

## 檔案

- src/App.tsx：家長與工作人員介面。
- src/Root.tsx：兩個專區的 hash 路由。
- src/AcademicApp.tsx、src/academic.ts：學科工作台、公告及獨立示範資料。
- src/ScoreForm.tsx：裁判表單、確認與修正。
- src/domain.ts：計分與驗證對照。
- src/data.ts：Supabase RPC 與訂閱。
- supabase/migrations/001_competition.sql：資料、權限、稽核與排名。
- supabase/migrations/002_heats_and_privacy.sql：梯次、移除學校、科創 40 秒。
- supabase/migrations/003_academic.sql：私有學科草稿與原子公布快照。
- tests/：計分、CSV 與資料庫測試。
- .github/workflows/pages.yml：測試及部署。

本版不含公式自訂、多賽事模板、電子證書、獎品核銷、賽程自動安排與網頁碼表。

分享封面以內建影像生成工具製作，檔案為 public/og.png。提示詞：深森林綠、米白與萊姆色，極簡機器人競賽分享卡，文字為「2026 TTRA」「主題挑戰賽」「即時成績」。設定 VITE_SITE_URL 後才輸出絕對分享圖片網址。
