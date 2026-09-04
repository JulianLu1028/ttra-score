import { describe, it, expect } from "vitest";
import {
  leaderboard,
  teamResult,
  creativeScore,
  validateScore,
  normalizeScore,
  categoryStats,
  heatNumbers,
  compareParticipantNumbers,
  type Team,
  type Attempt,
  type CategoryId,
} from "../src/domain";
import {
  normalizeParticipantNumber,
  parseCSV,
  parseTeams,
  participantNumber,
  challengeRosterTemplate,
  toCSV,
} from "../src/csv";
import { demoTeams, demoAttempts } from "../src/demo";
const team = (categoryId: CategoryId, id = "1"): Team => ({
  id,
  categoryId,
  number: id,
  name: "陳宥安",
  heat: 1,
  checkinStatus: "checked_in",
});
const attempt = (
  categoryId: CategoryId,
  data: Attempt["data"],
  slotKey = "round-1",
  status: Attempt["status"] = "valid",
  teamId = "1",
): Attempt => ({
  id: crypto.randomUUID(),
  teamId,
  categoryId,
  slotKey,
  status,
  attemptNo: 1,
  submittedAt: "2026-10-04T01:00:00Z",
  data,
});
describe("四組規則", () => {
  it("選手顯示順序依參賽編號，不受名次影響", () => {
    const entrants = [team("creative", "機A010"), team("creative", "機A002")];
    expect(
      [...entrants].sort(compareParticipantNumbers).map((row) => row.number),
    ).toEqual(["機A002", "機A010"]);
  });
  it("幼兒取最佳回合且不排名", () => {
    const ts = [team("preschool")],
      as = [
        attempt("preschool", { childGoals: 2, parentGoals: 1 }),
        attempt("preschool", { childGoals: 1, parentGoals: 0 }, "round-2"),
      ];
    expect(leaderboard(ts, as, "preschool")[0]).toMatchObject({
      primary: 3,
      qualified: true,
      rank: null,
    });
  });
  it("動力先按瓶數挑選，秒數必須屬於同一最佳回合", () => {
    const as = [
      attempt("power", { bottles: 10, seconds: 25 }, "pull-1"),
      attempt("power", { bottles: 7, seconds: 5 }, "pull-2"),
      attempt("power", { bottles: 9, seconds: 20 }, "push-1"),
      attempt("power", { bottles: 9, seconds: 18 }, "push-2"),
    ];
    expect(teamResult(team("power"), as)).toMatchObject({
      primary: 19,
      secondary: 43,
      qualified: true,
    });
  });
  it("動力缺少方向時不排名，但單次可合格", () =>
    expect(
      leaderboard(
        [team("power")],
        [attempt("power", { bottles: 7, seconds: 30 }, "pull-1")],
        "power",
      )[0],
    ).toMatchObject({ primary: null, qualified: true, rank: null }));
  it("掉落回合無效，不得選為最佳", () =>
    expect(
      teamResult(team("power"), [
        attempt("power", { bottles: 99, seconds: 1 }, "pull-1", "invalid"),
      ]).qualified,
    ).toBe(false));
  it("程式取有效最快，20 秒內合格、40 秒內有效", () => {
    expect(
      teamResult(team("program"), [
        attempt("program", { completed: 1, seconds: 20, weight: 500 }),
      ]),
    ).toMatchObject({ primary: 20, qualified: true });
    expect(
      teamResult(team("program"), [
        attempt("program", { completed: 1, seconds: 40, weight: 500 }),
      ]),
    ).toMatchObject({ primary: 40, qualified: false });
  });
  it("同時間以重量比序，完全相同採 1,2,2,4", () => {
    const ts = ["1", "2", "3", "4"].map((id) => team("program", id)),
      as = ts.map((t, i) =>
        attempt(
          "program",
          { completed: 1, seconds: 15, weight: [400, 500, 500, 600][i] },
          "round-1",
          "valid",
          t.id,
        ),
      );
    expect(leaderboard(ts, as, "program").map((r) => r.rank)).toEqual([
      1, 2, 2, 4,
    ]);
  });
  it("科創特殊瓶最高 120 分；錯區得 5 分", () => {
    expect(
      creativeScore(
        attempt("creative", { regular: 8, red: "correct", blue: "correct" }),
      ),
    ).toBe(120);
    expect(
      creativeScore(
        attempt("creative", { regular: 3, red: "correct", blue: "wrong" }),
      ),
    ).toBe(55);
  });
  it("科創提前終止保留得分，同分採該回合較短時間", () => {
    const as = [
      attempt(
        "creative",
        { regular: 5, red: "none", blue: "none", seconds: 10 },
        "left",
        "terminated",
      ),
      attempt(
        "creative",
        { regular: 5, red: "none", blue: "none", seconds: 20 },
        "right",
      ),
    ];
    expect(teamResult(team("creative"), as)).toMatchObject({
      primary: 50,
      secondary: 10,
      qualified: true,
    });
  });
  it("驗證拒絕空值、負數、超時、過多球數", () => {
    expect(
      validateScore("power", "valid", { bottles: 7, seconds: "" }, ""),
    ).toBeTruthy();
    expect(
      validateScore(
        "program",
        "valid",
        { completed: 1, seconds: 41, weight: 300 },
        "",
      ),
    ).toBeTruthy();
    expect(
      validateScore(
        "preschool",
        "valid",
        { childGoals: 5, parentGoals: 0 },
        "",
      ),
    ).toBeTruthy();
    expect(
      validateScore(
        "creative",
        "valid",
        { regular: -1, red: "none", blue: "none", seconds: 2 },
        "",
      ),
    ).toBeTruthy();
  });
  it("無效與修改必須有原因；四捨五入到一位", () => {
    expect(validateScore("power", "invalid", {}, "")).toBeTruthy();
    expect(normalizeScore("valid", { seconds: 12.35, weight: 100.25 })).toEqual(
      { seconds: 12.4, weight: 100.3 },
    );
    expect(normalizeScore("invalid", { seconds: 30 })).toEqual({});
  });
  it("未出場參賽者不應列名次", () =>
    expect(leaderboard([team("creative")], [], "creative")[0].rank).toBeNull());
});
describe("CSV", () => {
  it("支援 BOM、引號、逗號、換行、前置零及全形英數正規化", () => {
    const rows = parseTeams(
      '\uFEFF參賽編號,姓名\r\n幼Ａ００１,"Chen, An"',
      "preschool",
    );
    expect(rows[0]).toMatchObject({
      number: "幼A001",
      name: "Chen, An",
      heat: 1,
      categoryId: "preschool",
    });
    expect(normalizeParticipantNumber(" 程ｃ０１２ ")).toBe("程C012");
  });
  it("編號自動帶入梯次，同名參賽者仍以不同編號區分", () => {
    const rows = parseTeams(
      "參賽編號,姓名\n動A001,王小明\n動B001,王小明",
      "power",
    );
    expect(rows.map((r) => [r.number, r.heat])).toEqual([
      ["動A001", 1],
      ["動B001", 2],
    ]);
    expect(rows.every((r) => !("organization" in r))).toBe(true);
  });
  it("拒絕含學校、組別或梯次的額外欄位", () => {
    expect(() =>
      parseTeams(
        "參賽編號,姓名,學校／單位,組別\n001,陳宥安,學校,power",
        "power",
      ),
    ).toThrow("目前項目的範本");
    expect(() =>
      parseTeams("參賽編號,姓名,梯次\n動A001,王小明,1", "power"),
    ).toThrow("兩個欄位");
  });
  it("拒絕重複編號", () =>
    expect(() =>
      parseTeams("team_number,name\n動A001,A\n動Ａ００１,B", "power"),
    ).toThrow("重複"));
  it("依編號前綴阻擋選錯組別", () => {
    expect(() => parseTeams("參賽編號,姓名\n機A001,王小明", "power")).toThrow(
      "科創機器人組",
    );
    expect(() => parseTeams("參賽編號,姓名\n動A1,王小明", "power")).toThrow(
      "幼A001、動A001、程A001、機A001",
    );
  });
  it("拒絕仍包含組別與梯次欄的範本", () =>
    expect(() =>
      parseTeams(
        "參賽編號,姓名,組別,梯次\n動A001,王小明,動力機械組,1",
        "power",
      ),
    ).toThrow("兩個欄位"));
  it("產生含組別、梯次與三位流水號的參賽編號", () => {
    expect(participantNumber("preschool", 2, 1)).toBe("幼B001");
    expect(participantNumber("program", 3, 27)).toBe("程C027");
    expect(() => participantNumber("creative", 3, 1)).toThrow("範圍");
  });
  it("四個項目的下載範本固定只有編號與姓名兩欄", () => {
    expect(challengeRosterTemplate("preschool")).toEqual([
      ["參賽編號", "姓名"],
      ["幼A001", "王小明"],
      ["幼B001", "王小明"],
    ]);
    expect(challengeRosterTemplate("power")).toEqual([
      ["參賽編號", "姓名"],
      ["動A001", "王小明"],
      ["動B001", "王小明"],
    ]);
    expect(challengeRosterTemplate("program")).toEqual([
      ["參賽編號", "姓名"],
      ["程A001", "王小明"],
      ["程B001", "王小明"],
      ["程C001", "王小明"],
    ]);
    expect(challengeRosterTemplate("creative")).toEqual([
      ["參賽編號", "姓名"],
      ["機A001", "王小明"],
      ["機B001", "王小明"],
    ]);
    for (const category of categories)
      expect(
        challengeRosterTemplate(category.id).every((row) => row.length === 2),
      ).toBe(true);
  });
  it("匯出防止試算表公式注入", () =>
    expect(parseCSV(toCSV([["=1+1", "@evil", "正常"]]))[0]).toEqual([
      "'=1+1",
      "'@evil",
      "正常",
    ]));
});
describe("梯次與組別統計", () => {
  it("各梯次單獨計算名次", () => {
    const entrants = [
      { ...team("program", "A1"), heat: 1 },
      { ...team("program", "A2"), heat: 1 },
      { ...team("program", "B1"), heat: 2 },
      { ...team("program", "B2"), heat: 2 },
    ];
    const seconds: Record<string, number> = {
      A1: 15,
      A2: 18,
      B1: 20,
      B2: 10,
    };
    const attempts = entrants.map((entrant) =>
      attempt(
        "program",
        { completed: 1, seconds: seconds[entrant.id], weight: 600 },
        "round-1",
        "valid",
        entrant.id,
      ),
    );
    const ranks = Object.fromEntries(
      leaderboard(entrants, attempts, "program").map((r) => [
        r.team.id,
        r.rank,
      ]),
    );
    expect(ranks).toEqual({ A1: 1, A2: 2, B1: 2, B2: 1 });
  });
  it("統計只計本組並要求所有回合；無效回合仍算已登錄", () => {
    const entrants = [
      { ...team("preschool", "a"), heat: 2 },
      team("program", "b"),
    ];
    const attempts = [
      attempt("preschool", {}, "round-1", "invalid", "a"),
      attempt("preschool", {}, "round-2", "invalid", "a"),
    ];
    expect(categoryStats(entrants, attempts, "preschool")).toEqual({
      total: 1,
      checkedIn: 1,
      completed: 1,
    });
    expect(categoryStats(entrants, attempts, "program").completed).toBe(0);
  });
  it("程式三梯、其餘兩梯，匯入拒絕超出梯次", () => {
    expect(heatNumbers("program")).toEqual([1, 2, 3]);
    expect(heatNumbers("creative")).toEqual([1, 2]);
    expect(parseTeams("參賽編號,姓名\n程C001,王小明", "program")[0].heat).toBe(
      3,
    );
    expect(() =>
      parseTeams("參賽編號,姓名\n機C001,王小明", "creative"),
    ).toThrow("只有 A–B 梯");
  });
  it("科創 40.0 秒保留得分，超過 40 秒拒絕", () => {
    const data = { regular: 5, red: "none", blue: "none", seconds: 40 };
    expect(validateScore("creative", "valid", data, "")).toBeNull();
    expect(validateScore("creative", "terminated", data, "翻覆")).toBeNull();
    expect(
      validateScore("creative", "valid", { ...data, seconds: 40.01 }, ""),
    ).toBeTruthy();
    expect(
      teamResult(team("creative"), [attempt("creative", data, "left")]),
    ).toMatchObject({ primary: 50, secondary: 40, qualified: true });
    expect(
      validateScore("power", "valid", { bottles: 7, seconds: 40 }, ""),
    ).toBeTruthy();
  });
});
describe("單人賽示範資料", () => {
  it("幼兒組為空，其餘三組各六位虛構姓名，成績仍連結本人", () => {
    expect(demoTeams).toHaveLength(18);
    expect(new Set(demoTeams.map((t) => t.name)).size).toBe(18);
    expect(new Set(demoTeams.map((t) => t.number)).size).toBe(18);
    expect(demoTeams.filter((t) => t.categoryId === "preschool")).toHaveLength(
      0,
    );
    for (const category of ["power", "program", "creative"])
      expect(demoTeams.filter((t) => t.categoryId === category)).toHaveLength(
        6,
      );
    for (const t of demoTeams) expect(t.name).toMatch(/^[\p{Script=Han}]{3}$/u);
    for (const a of demoAttempts)
      expect(
        demoTeams.some(
          (t) => t.id === a.teamId && t.categoryId === a.categoryId,
        ),
      ).toBe(true);
  });
});
