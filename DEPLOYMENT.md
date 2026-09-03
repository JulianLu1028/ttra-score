# 上線與賽前演練

完成以下設定與演練後，才可用於正式比賽。

## Supabase

1. 建立專用專案，勿將 migration 套至其他正在使用的資料庫。
2. 新專案依序在 SQL Editor 執行 supabase/migrations/001_competition.sql、002_heats_and_privacy.sql、003_academic.sql，各一次。已套用 001 的專案先備份，再只執行 002、003；不要重跑 001。002 會移除既有學校欄及稽核中的學校資料，並將既有參賽者暫設第 1 梯，須依正式名單核對調整；之後的新匯入必須明確填寫梯次。
3. API Exposed schemas 保持 public，不要暴露 private。
4. Auth URL Configuration 設定 Site URL 及 Redirect URLs：
   - https://ACCOUNT.github.io/REPOSITORY/
   - 本機測試：http://127.0.0.1:5173/
5. 設定自訂 SMTP、測試寄信與配額。不要依賴未配置的測試寄信服務。
6. Auth / Users 建立或邀請工作人員，前端不開放自行註冊。
7. 由 SQL Editor 為已建立的 Auth user 加入角色，替換 UUID：

       insert into private.staff_roles(user_id,role,category_ids)
       values ('AUTH-USER-UUID','admin','{}');

   分組裁判：

       insert into private.staff_roles(user_id,role,category_ids)
       values ('AUTH-USER-UUID','judge',array['power']);

   報到人員：

       insert into private.staff_roles(user_id,role,category_ids)
       values ('AUTH-USER-UUID','checkin','{}');

   空 category_ids 表示全部組別；admin 有全部權限。角色由擁有者管理，前端不能自行升權。

   如需讓某位裁判操作學科成績，另外授權（保留其原挑戰賽分組權限）：

       update private.staff_roles set can_grade_academic=true
       where user_id='AUTH-USER-UUID' and role='judge';

   沒有此旗標的一般裁判、報到人員、匿名家長不能取得未公布的學科草稿。管理員不需另外開旗標。

8. 確認 event_state 已加入 supabase_realtime publication；migration 會自動加入。只推播版本變更，家長端再讀安全快照。內部表格不公開。
9. 取得 Project URL 與 publishable key，不將機密放入前端。

參考：[Email 登入](https://supabase.com/docs/guides/auth/auth-email-passwordless)、[SMTP](https://supabase.com/docs/guides/auth/auth-smtp)、[RLS](https://supabase.com/docs/guides/database/postgres/row-level-security)。

## GitHub Pages

長期使用的 repository 為 `JulianLu1028/ttra-score`，示範與正式版沿用同一個 repository 和網址。

1. 本資料夾內容放在 repository 根目錄，預設 branch 為 main；不提交 `.env.local`、真實參賽名單、私密金鑰或 `node_modules`。
2. Settings / Pages：Source 選 GitHub Actions。
3. Settings / Secrets and variables / Actions / Variables：
   - 現階段展示：新增 `DEPLOYMENT_MODE` = `demo`。工作流程不注入 Supabase 設定，只使用虛構的記憶體資料；重整即重設，不能跨分頁／裝置同步。
   - 正式上線：完成下方驗收後，新增 `VITE_SUPABASE_URL` 與 `VITE_SUPABASE_PUBLISHABLE_KEY`，將 `DEPLOYMENT_MODE` 改成 `production`。不需重建 repository。
4. Push main 或手動啟動工作流程，先測試與型別檢查再部署。未設定模式時預設正式模式；正式模式缺少連線設定會拒絕部署，未知模式也會拒絕。更改 Variables 後需重新執行工作流程才會生效。
5. 使用帳號根站台或自訂網域時，將 workflow 的 VITE_SITE_URL 改為正確網址。

Linkt 放入兩個家長端連結：

- 挑戰賽：https://JulianLu1028.github.io/ttra-score/#/challenge
- 檢定：https://JulianLu1028.github.io/ttra-score/#/exam

工作人員分別使用 /#/challenge/staff 與 /#/exam/staff。舊 /#/、/#/staff 保留相容。

## 賽前必要驗收

- 一支裁判手機與一支家長手機，使用 4G／5G。
- 名單匯入、報到、四組各送分，確認家長端同步。
- 確認兩端都依梯次分段，切換梯次仍保留全組合併名次，頂端人數僅屬於目前項目。
- 學科匯入、登錄 0 分與其他分數；未公布前，以匿名及未授權帳號確認 API 取不到草稿。
- 手動公布前核對已登分與未登分人數；公布後所有已登分者同時可見，未登分不顯示為 0。
- 公布後修正一人成績，家長仍看到舊版；再次手動公布後才更新。10/04 10:00 不會自動公布。
- 超限值、未報到、權限不足、重複編號必須拒絕。
- 修正成績、確認新排名與原始版本紀錄。
- 兩支裁判手機編輯同回合，後送者應提示版本衝突。
- 切飛航模式後禁止送出，恢復後重試不重複入帳。
- 重整、關閉再開、另一裝置均可讀到正式資料。
- 使用 120 位參賽者及至少 100 個並行讀取用戶做正式環境負載演練，監看 Supabase 配額與延遲。本地測試不等同公網容量保證。
- 賽前備份資料庫並保留紙本備援，競賽期間凍結程式與規則變更。

## 限制

無離線記分，完全斷網時須採現場備援。挑戰賽每 10 秒檢查版本，有變動才取完整快照；學科每 10 秒補抓，並以 Realtime 加速公布通知。正式容量仍須演練確認。
挑戰賽公開姓名／參賽編號／組別／梯次／報到／成績；學科只公開已公布的姓名／參賽編號／分數及公布時間。不記錄學校，勿上傳電話、家長聯絡方式等額外個資；匯入前須確認姓名可公開。示範與範本姓名皆為虛構，正式匯入前請替換。
已有成績的參賽者不能直接撤銷報到，需由管理員先處理成績。
取消資格、重賽等非常態事件由主辦人裁決，本版不自動處理。
PGlite 測試不取代正式 Supabase Email、JWT、Realtime、公網延遲驗證。
