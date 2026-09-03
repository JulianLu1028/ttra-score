import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { leaderboard, type Team, type Attempt } from "../src/domain";
import { demoTeams } from "../src/demo";
let db: PGlite;
const admin = "00000000-0000-4000-8000-000000000001",
  judge = "00000000-0000-4000-8000-000000000002",
  checkin = "00000000-0000-4000-8000-000000000003",
  outsider = "00000000-0000-4000-8000-000000000004",
  examiner = "00000000-0000-4000-8000-000000000005";
async function asUser(id: string | null, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    id ?? "",
  ]);
  await db.exec("set role " + role);
}
async function createTeam(category = "power", number = "101") {
  await asUser(admin);
  await db.query("select public.import_teams($1)", [
    JSON.stringify([
      {
        team_number: number,
        name: "陳宥安",
        heat: 1,
        category_id: category,
      },
    ]),
  ]);
  const { rows } = await db.query<{ id: string }>(
    "select id from public.teams where team_number=$1",
    [number],
  );
  await db.query("select public.set_checkin($1,'checked_in')", [rows[0].id]);
  return rows[0].id;
}
function input(
  team_id: string,
  category_id = "power",
  slot_key = "pull-1",
  score_data: Record<string, unknown> = { bottles: 7, seconds: 20 },
) {
  return {
    team_id,
    category_id,
    slot_key,
    attempt_no: 1,
    status: "valid",
    reason: "",
    score_data,
    request_id: crypto.randomUUID(),
    expected_revision: 0,
  };
}
async function submit(p: ReturnType<typeof input>) {
  const { rows } = await db.query<{ result: any }>(
    "select public.submit_attempt($1) result",
    [JSON.stringify(p)],
  );
  return rows[0].result;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;",
  );
  for (const id of [admin, judge, checkin, outsider, examiner])
    await db.query("insert into auth.users values($1)", [id]);
  await db.exec(
    readFileSync(
      new URL("../supabase/migrations/001_competition.sql", import.meta.url),
      "utf8",
    ),
  );
  await db.query(
    "insert into private.staff_roles(user_id,role,category_ids) values($1,'admin','{}'),($2,'judge','{power}'),($3,'checkin','{}')",
    [admin, judge, checkin],
  );
  for (const migration of ["002_heats_and_privacy.sql", "003_academic.sql"])
    await db.exec(
      readFileSync(
        new URL("../supabase/migrations/" + migration, import.meta.url),
        "utf8",
      ),
    );
  await db.query(
    "insert into private.staff_roles(user_id,role,can_grade_academic) values($1,'judge',true)",
    [examiner],
  );
}, 30000);
beforeEach(async () => {
  await db.exec(
    "reset role; truncate public.teams,public.attempts,private.audit_log,private.requests,private.academic_candidates,private.academic_audit,public.academic_results cascade; update private.academic_state set version=0; update public.academic_publication set version=0,published_at=null",
  );
});
async function academicSetup() {
  await asUser(admin);
  await db.query("select public.import_academic($1)", [
    JSON.stringify([
      { number: "E001", name: "陳宥安" },
      { number: "E002", name: "林芷晴" },
      { number: "E003", name: "張語彤" },
    ]),
  ]);
  return academicWorkspace();
}
async function academicWorkspace(): Promise<any> {
  return (
    await db.query<{ value: any }>(
      "select public.get_academic_workspace() value",
    )
  ).rows[0].value;
}
async function academicPublic(): Promise<any> {
  return (
    await db.query<{ value: any }>("select public.get_academic_results() value")
  ).rows[0].value;
}
async function academicSave(
  c: any,
  score: unknown,
  requestId = crypto.randomUUID(),
) {
  const input = {
    id: c.id,
    score,
    expected_revision: c.revision,
    reason: c.score !== null ? "複核" : "",
    request_id: requestId,
  };
  return (
    await db.query<{ value: any }>(
      "select public.save_academic_score($1) value",
      [JSON.stringify(input)],
    )
  ).rows[0].value;
}
describe("學科私有登分與公開快照資料庫", () => {
  it("只有管理員及獲授權學科評審能讀寫草稿", async () => {
    const w = await academicSetup();
    for (const id of [judge, checkin, outsider]) {
      await asUser(id);
      await expect(academicWorkspace()).rejects.toThrow("學科成績操作權限");
      await expect(academicSave(w.candidates[0], 90)).rejects.toThrow(
        "學科成績操作權限",
      );
      await expect(
        db.query("select public.publish_academic(0,$1)", [crypto.randomUUID()]),
      ).rejects.toThrow("學科成績操作權限");
    }
    await asUser(examiner);
    expect((await academicWorkspace()).candidates).toHaveLength(3);
    await academicSave(w.candidates[0], 90);
    await expect(
      db.query("select public.import_academic('[]')"),
    ).rejects.toThrow("操作權限");
    await asUser(null, "anon");
    await expect(academicWorkspace()).rejects.toThrow("permission denied");
    await expect(
      db.query("select * from private.academic_candidates"),
    ).rejects.toThrow("permission denied");
    await expect(
      db.query("select * from private.academic_audit"),
    ).rejects.toThrow("permission denied");
    expect((await academicPublic()).results).toEqual([]);
    expect((await academicPublic()).publishedAt).toBeNull();
  });
  it("0 分與空白不同，公布前沒有分數外洩，一次公布同一批快照", async () => {
    const w = await academicSetup();
    await academicSave(w.candidates[0], 0);
    await academicSave(w.candidates[1], 100);
    expect((await academicPublic()).results).toEqual([]);
    await asUser(null, "anon");
    const board = (
      await db.query<{ value: any }>("select public.get_scoreboard() value")
    ).rows[0].value;
    expect(JSON.stringify(board)).not.toContain("E001");
    await asUser(examiner);
    const ready = await academicWorkspace();
    expect(ready.candidates.map((c: any) => c.score)).toEqual([0, 100, null]);
    const request = crypto.randomUUID();
    await db.query("select public.publish_academic($1,$2)", [
      ready.version,
      request,
    ]);
    await db.query("select public.publish_academic($1,$2)", [
      ready.version,
      request,
    ]);
    expect(
      (await academicWorkspace()).audit.filter(
        (a: any) => a.action === "publish",
      ),
    ).toHaveLength(1);
    await asUser(null, "anon");
    const published = await academicPublic();
    expect(published.results.map((c: any) => c.score)).toEqual([0, 100]);
    expect(
      new Set(published.results.map((c: any) => c.published_at)).size,
    ).toBe(1);
    expect(Object.keys(published.results[0]).sort()).toEqual([
      "id",
      "name",
      "number",
      "published_at",
      "score",
    ]);
    await expect(
      db.query("update public.academic_results set score=1"),
    ).rejects.toThrow("permission denied");
  });
  it("修改留在草稿，再次公布才更新；过期确认不接受", async () => {
    const w = await academicSetup();
    await academicSave(w.candidates[0], 80);
    const staleVersion = w.version;
    await expect(
      db.query("select public.publish_academic($1,$2)", [
        staleVersion,
        crypto.randomUUID(),
      ]),
    ).rejects.toThrow("已更新");
    const ready = await academicWorkspace();
    await db.query("select public.publish_academic($1,$2)", [
      ready.version,
      crypto.randomUUID(),
    ]);
    await academicSave(ready.candidates[0], 90);
    expect((await academicPublic()).results[0].score).toBe(80);
    const revised = await academicWorkspace();
    await db.query("select public.publish_academic($1,$2)", [
      revised.version,
      crypto.randomUUID(),
    ]);
    expect((await academicPublic()).results[0].score).toBe(90);
  });
  it("分數邊界、重送及版本衝突由後端驗證", async () => {
    const w = await academicSetup();
    for (const score of [-1, 100.1, null, "90"])
      await expect(academicSave(w.candidates[0], score)).rejects.toThrow();
    const request = crypto.randomUUID();
    await academicSave(w.candidates[0], 88.5, request);
    await academicSave(w.candidates[0], 88.5, request);
    expect((await academicWorkspace()).candidates[0].revision).toBe(1);
    await expect(academicSave(w.candidates[0], 90, request)).rejects.toThrow(
      "其他內容",
    );
    await expect(academicSave(w.candidates[0], 90)).rejects.toThrow(
      "成績已被更新",
    );
  });
  it("名單整批回滾，沒有分數不能公布，額外欄位不儲存", async () => {
    await academicSetup();
    await expect(
      db.query("select public.publish_academic($1,$2)", [
        (await academicWorkspace()).version,
        crypto.randomUUID(),
      ]),
    ).rejects.toThrow("尚無");
    await expect(
      db.query("select public.import_academic($1)", [
        JSON.stringify([
          { number: "E004", name: "許家佑" },
          { number: "E001", name: "陳宥安" },
        ]),
      ]),
    ).rejects.toThrow("duplicate");
    expect((await academicWorkspace()).candidates).toHaveLength(3);
    await expect(
      db.query("select public.import_academic($1)", [
        JSON.stringify([
          { number: "E004", name: "許家佑", organization: "不得儲存" },
        ]),
      ]),
    ).rejects.toThrow("只接受");
  });
  it("挑戰賽梯次有後端限制且學校欄位確實移除", async () => {
    await asUser(admin);
    for (const heat of [0, 3, 1.5])
      await expect(
        db.query("select public.import_teams($1)", [
          JSON.stringify([
            { team_number: "X", name: "陳宥安", category_id: "creative", heat },
          ]),
        ]),
      ).rejects.toThrow();
    await db.query("select public.import_teams($1)", [
      JSON.stringify([
        { team_number: "X", name: "陳宥安", category_id: "program", heat: 3 },
      ]),
    ]);
    const row = (await db.query("select * from public.teams")).rows[0];
    expect(row.heat).toBe(3);
    expect(row).not.toHaveProperty("organization");
    await expect(
      db.query("select public.import_teams($1)", [
        JSON.stringify([
          {
            team_number: "Y",
            name: "陳宥安",
            category_id: "program",
            heat: 1,
            organization: "不得儲存",
          },
        ]),
      ]),
    ).rejects.toThrow("不接受");
  });
  it("科創 40 秒有效，40.01 秒拒絕；動力仍是 30 秒", async () => {
    const id = await createTeam("creative");
    const data = { regular: 5, red: "none", blue: "none", seconds: 40 };
    expect(
      (await submit(input(id, "creative", "left", data))).score_data.seconds,
    ).toBe(40);
    await expect(
      submit(input(id, "creative", "right", { ...data, seconds: 40.01 })),
    ).rejects.toThrow("有效範圍");
    const power = await createTeam("power", "102");
    await expect(
      submit(input(power, "power", "pull-1", { bottles: 7, seconds: 40 })),
    ).rejects.toThrow("有效範圍");
  });
});
afterAll(async () => {
  await db.close();
});
describe("Supabase/Postgres 整合與權限", () => {
  it("匿名只能讀取公開成績，不能直接寫入", async () => {
    await createTeam();
    await asUser(null, "anon");
    expect(
      (await db.query("select public.get_scoreboard()")).rows,
    ).toHaveLength(1);
    await expect(
      db.query("update public.teams set name='Hacked'"),
    ).rejects.toThrow(/permission denied/);
    await expect(db.query("select * from private.audit_log")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      db.query("select public.import_teams($1)", ["[]"]),
    ).rejects.toThrow(/permission denied/);
  });
  it("已登入但不在白名單不能送分", async () => {
    const id = await createTeam();
    await asUser(outsider);
    await expect(submit(input(id))).rejects.toThrow("沒有操作權限");
  });
  it("報到人員不能計分、裁判不能匯入且不能跨組", async () => {
    const id = await createTeam("creative");
    await asUser(checkin);
    await expect(
      submit(
        input(id, "creative", "left", {
          regular: 1,
          red: "none",
          blue: "none",
          seconds: 10,
        }),
      ),
    ).rejects.toThrow("沒有操作權限");
    await asUser(judge);
    await expect(
      db.query("select public.import_teams($1)", ["[]"]),
    ).rejects.toThrow("沒有操作權限");
    await expect(
      submit(
        input(id, "creative", "left", {
          regular: 1,
          red: "none",
          blue: "none",
          seconds: 10,
        }),
      ),
    ).rejects.toThrow("沒有此組別");
  });
  it("未報到拒絕，錯誤回合與超時拒絕", async () => {
    const id = await createTeam();
    await asUser(admin);
    await db.query("select public.set_checkin($1,'pending')", [id]);
    await expect(submit(input(id))).rejects.toThrow("尚未報到");
    await db.query("select public.set_checkin($1,'checked_in')", [id]);
    await expect(submit(input(id, "power", "left"))).rejects.toThrow(
      "回合不正確",
    );
    await expect(
      submit(input(id, "power", "pull-1", { bottles: 7, seconds: 31 })),
    ).rejects.toThrow("超出有效範圍");
  });
  it("重送相同請求只記一次；舊版本與修改無原因拒絕", async () => {
    const id = await createTeam();
    await asUser(judge);
    const p = input(id),
      a = await submit(p),
      b = await submit(p);
    expect(a.id).toBe(b.id);
    expect(b.revision).toBe(1);
    expect((await db.query("select * from public.attempts")).rows).toHaveLength(
      1,
    );
    await expect(
      submit({ ...p, request_id: crypto.randomUUID() }),
    ).rejects.toThrow("已被更新");
    await expect(
      submit({ ...p, request_id: crypto.randomUUID(), expected_revision: 1 }),
    ).rejects.toThrow("請填寫");
    const changed = await submit({
      ...p,
      request_id: crypto.randomUUID(),
      expected_revision: 1,
      reason: "輸入修正",
      score_data: { bottles: 9, seconds: 21 },
    });
    expect(changed.revision).toBe(2);
    await asUser(admin);
    const audit = await db.query<{ result: any }>(
      "select public.read_audit() result",
    );
    expect(
      audit.rows[0].result.filter((r: any) => r.action.startsWith("score")),
    ).toHaveLength(2);
  });
  it("相同識別碼不同內容拒絕；內部理由不出現在公开資料", async () => {
    const id = await createTeam();
    const p = { ...input(id), reason: "內部備註 ABC" };
    await submit(p);
    await expect(
      submit({ ...p, score_data: { bottles: 8, seconds: 20 } }),
    ).rejects.toThrow("其他內容");
    await asUser(null, "anon");
    expect(
      JSON.stringify((await db.query("select public.get_scoreboard()")).rows),
    ).not.toContain("內部備註");
  });
  it("同一參賽者程式組重量不得不一致", async () => {
    const id = await createTeam("program");
    await submit(
      input(id, "program", "round-1", {
        completed: 1,
        seconds: 20,
        weight: 500,
      }),
    );
    await expect(
      submit(
        input(id, "program", "round-2", {
          completed: 1,
          seconds: 19,
          weight: 501,
        }),
      ),
    ).rejects.toThrow("須與另一回合一致");
  });
  it("動力 SQL 與前端計算一致", async () => {
    const id = await createTeam();
    for (const [slot, bottles, seconds] of [
      ["pull-1", 10, 25],
      ["pull-2", 7, 5],
      ["push-1", 9, 20],
      ["push-2", 9, 18],
    ])
      await submit(input(id, "power", String(slot), { bottles, seconds }));
    const { rows } = await db.query<any>("select * from public.results");
    expect(Number(rows[0].primary_score)).toBe(19);
    expect(Number(rows[0].secondary_score)).toBe(43);
  });
  it("四組資料完整性及排名與前端一致", async () => {
    for (const category of [
      "preschool",
      "power",
      "program",
      "creative",
    ] as const)
      for (let i = 1; i <= 4; i++) {
        const id = await createTeam(category, category + i);
        if (category === "preschool")
          await submit(
            input(id, category, "round-1", { childGoals: 2, parentGoals: 1 }),
          );
        if (category === "power") {
          await submit(
            input(id, category, "pull-1", { bottles: 7, seconds: 20 }),
          );
          await submit(
            input(id, category, "push-1", { bottles: 7, seconds: 20 }),
          );
        }
        if (category === "program")
          await submit(
            input(id, category, "round-1", {
              completed: 1,
              seconds: 15,
              weight: [400, 500, 500, 600][i - 1],
            }),
          );
        if (category === "creative")
          await submit(
            input(id, category, "left", {
              regular: i,
              red: "correct",
              blue: "wrong",
              seconds: 20,
            }),
          );
      }
    const {
      rows: [{ board }],
    } = await db.query<{ board: any }>("select public.get_scoreboard() board");
    const teams: Team[] = board.teams.map((t: any) => ({
      id: t.id,
      number: t.team_number,
      name: t.name,
      heat: t.heat,
      categoryId: t.category_id,
      checkinStatus: t.checkin_status,
    }));
    const attempts: Attempt[] = board.attempts.map((a: any) => ({
      id: a.id,
      teamId: a.team_id,
      categoryId: a.category_id,
      slotKey: a.slot_key,
      attemptNo: a.attempt_no,
      status: a.status,
      data: a.score_data,
      submittedAt: a.submitted_at,
    }));
    for (const category of [
      "preschool",
      "power",
      "program",
      "creative",
    ] as const)
      for (const client of leaderboard(teams, attempts, category)) {
        const sql = board.results.find(
          (r: any) => r.team_id === client.team.id,
        );
        expect(client.primary).toEqual(sql.primary_score);
        expect(client.secondary).toEqual(sql.secondary_score);
        expect(client.rank).toEqual(sql.rank);
        expect(client.qualified).toEqual(sql.qualified);
      }
  });
  it("匯入重複會整批回滾，不覆蓋既有資料", async () => {
    await createTeam();
    await expect(
      db.query("select public.import_teams($1)", [
        JSON.stringify([
          { team_number: "102", name: "New", category_id: "power", heat: 1 },
          {
            team_number: "101",
            name: "Overwrite",
            category_id: "power",
            heat: 2,
          },
        ]),
      ]),
    ).rejects.toThrow(/duplicate key/);
    expect((await db.query("select * from public.teams")).rows).toHaveLength(1);
  });
  it("120 人快照、版本檢查與更新通知", async () => {
    await asUser(admin);
    const rows = Array.from({ length: 120 }, (_, i) => ({
      team_number: String(i + 1).padStart(3, "0"),
      name: demoTeams[i % demoTeams.length].name,
      category_id: ["preschool", "power", "program", "creative"][i % 4],
      heat: 1,
    }));
    await db.query("select public.import_teams($1)", [JSON.stringify(rows)]);
    const snapshot = (
      await db.query<{ b: any }>("select public.get_scoreboard() b")
    ).rows[0].b;
    expect(snapshot.teams).toHaveLength(120);
    expect(snapshot.results).toHaveLength(120);
    const unchanged = (
      await db.query<{ b: any }>("select public.get_scoreboard($1) b", [
        snapshot.version,
      ])
    ).rows[0].b;
    expect(unchanged.unchanged).toBe(true);
    expect(unchanged.teams).toBeUndefined();
    await db.query("select public.set_checkin($1,'checked_in')", [
      snapshot.teams[0].id,
    ]);
    const changed = (
      await db.query<{ b: any }>("select public.get_scoreboard($1) b", [
        snapshot.version,
      ])
    ).rows[0].b;
    expect(changed.version).toBeGreaterThan(snapshot.version);
    expect(changed.teams[0].checkin_status).toBe("checked_in");
  });
  it("無效回合不會洩漏未驗證的任意欄位", async () => {
    const id = await createTeam();
    await submit({
      ...input(id),
      status: "invalid",
      reason: "掉落",
      score_data: { secret: "do not publish" },
    });
    await asUser(null, "anon");
    const s = (await db.query<{ b: any }>("select public.get_scoreboard() b"))
      .rows[0].b;
    expect(s.attempts[0].score_data).toEqual({});
    expect(s.results[0].rank).toBeNull();
  });
});
