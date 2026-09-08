import { describe, expect, it } from "vitest";
import {
  academicLevel,
  academicLevelRows,
  academicRosterTemplate,
} from "../src/academic-levels";
import {
  AcademicDemoStore,
  academicScore,
  parseAcademicCSV,
} from "../src/academic";
describe("學科登分與手動公布", () => {
  it("兩級編號完整辨識：一級 36 位、二級 11 位，邊界之外不誤判", () => {
    const first = Array.from({ length: 36 }, (_, i) => ({
      number: `機5811151004${String(i + 1).padStart(2, "0")}`,
    }));
    const second = Array.from({ length: 11 }, (_, i) => ({
      number: `機5821151004${String(i + 1).padStart(2, "0")}`,
    }));
    expect(first.every((r) => academicLevel(r.number) === 1)).toBe(true);
    expect(second.every((r) => academicLevel(r.number) === 2)).toBe(true);
    const mixed = [...second, ...first].reverse();
    expect(academicLevelRows(mixed, 1)).toEqual(first);
    expect(academicLevelRows(mixed, 2)).toEqual(second);
    for (const number of [
      "機581115100400",
      "機581115100437",
      "機582115100400",
      "機582115100412",
      "機583115100401",
      "機5811151004010",
      "581115100401",
      "機58111510041",
      "機5811151004A1",
      "E001",
    ])
      expect(academicLevel(number)).toBeNull();
  });
  it("等級範本不新增欄位；選錯等級、越界編號與全形重複均被匯入預覽拒絕", () => {
    expect(academicRosterTemplate(1)).toEqual([
      ["參賽編號", "姓名"],
      ["機581115100401", "王小明"],
    ]);
    expect(academicRosterTemplate(2)[1]).toEqual(["機582115100401", "王小明"]);
    expect(
      parseAcademicCSV("參賽編號,姓名\n機５８１１１５１００４０１,王小明", 1)[0]
        .number,
    ).toBe("機581115100401");
    expect(() =>
      parseAcademicCSV("參賽編號,姓名\n機582115100401,王小明", 1),
    ).toThrow("不屬於一級檢定");
    expect(() =>
      parseAcademicCSV("參賽編號,姓名\n機582115100412,王小明", 2),
    ).toThrow("不屬於二級檢定");
    expect(() =>
      parseAcademicCSV(
        "參賽編號,姓名\n機581115100401,王小明\n機５８１１１５１００４０１,王小明",
        1,
      ),
    ).toThrow("重複");
  });
  it("既有未知編號保留，不猜測等級或修改原資料；分組不改公布範圍", () => {
    const legacy = { number: "E001", name: "王小明" };
    expect(academicLevelRows([legacy], "unassigned")).toEqual([legacy]);
    const store = new AcademicDemoStore([
      { number: "機581115100401", name: "王小明" },
      { number: "機582115100401", name: "王小明" },
    ]);
    for (const candidate of store.readWorkspace().candidates)
      store.save({
        id: candidate.id,
        score: 80,
        expected_revision: 0,
        reason: "",
        request_id: candidate.id,
      });
    expect(academicLevelRows(store.readWorkspace().candidates, 1)).toHaveLength(
      1,
    );
    store.publish(store.readWorkspace().version, "both-levels");
    expect(store.readPublic().results).toHaveLength(2);
  });
  it("0 與未登錄不同，公布前不能從公開快照取得分數", () => {
    const store = new AcademicDemoStore([
      { number: "001", name: "陳宥安" },
      { number: "002", name: "林芷晴" },
    ]);
    const first = store.readWorkspace().candidates[0];
    store.save({
      id: first.id,
      score: 0,
      reason: "",
      expected_revision: 0,
      request_id: "save-1",
    });
    expect(store.readPublic()).toEqual({
      version: 0,
      publishedAt: null,
      results: [],
    });
    expect(store.readWorkspace().candidates.map((c) => c.score)).toEqual([
      0,
      null,
    ]);
    store.publish(store.readWorkspace().version, "publish-1");
    expect(store.readPublic().results.map((c) => c.score)).toEqual([0]);
  });
  it("更正不更動已公開快照，重複公布不新增紀錄", () => {
    const store = new AcademicDemoStore([{ number: "001", name: "陳宥安" }]);
    const id = store.readWorkspace().candidates[0].id;
    store.save({
      id,
      score: 80,
      reason: "",
      expected_revision: 0,
      request_id: "s1",
    });
    const version = store.readWorkspace().version;
    store.publish(version, "p1");
    store.publish(version, "p1");
    expect(
      store.readWorkspace().audit.filter((a) => a.action === "publish"),
    ).toHaveLength(1);
    store.save({
      id,
      score: 90,
      reason: "複核",
      expected_revision: 1,
      request_id: "s2",
    });
    expect(store.readPublic().results[0].score).toBe(80);
    store.publish(store.readWorkspace().version, "p2");
    expect(store.readPublic().results[0].score).toBe(90);
  });
  it("拒絕過期確認及衝突寫入，請求重送只寫入一次", () => {
    const store = new AcademicDemoStore([{ number: "001", name: "陳宥安" }]);
    const input = {
      id: store.readWorkspace().candidates[0].id,
      score: 100,
      reason: "",
      expected_revision: 0,
      request_id: "s1",
    };
    store.save(input);
    store.save(input);
    expect(store.readWorkspace().candidates[0].revision).toBe(1);
    expect(() => store.publish(0, "p1")).toThrow("已更新");
    expect(() => store.save({ ...input, request_id: "s2" })).toThrow(
      "成績已被更新",
    );
    expect(() => store.save({ ...input, score: 99 })).toThrow("其他內容");
  });
  it("空白不是 0 分，接受 0–100 與一位小數", () => {
    for (const v of ["0", "100", "99.5"])
      expect(academicScore(v)).toBe(Number(v));
    for (const v of ["", " ", "101", "-1", "NaN", "89.25"])
      expect(() => academicScore(v)).toThrow();
  });
  it("學科名單只接受編號及姓名，重複匯入整批拒絕", () => {
    const rows = parseAcademicCSV(
      "\uFEFF姓名,參賽編號\r\n陳宥安,001\r\n陳宥安,002",
    );
    expect(rows.map((r) => r.number)).toEqual(["001", "002"]);
    expect(() => parseAcademicCSV("參賽編號,姓名,學校\n1,陳宥安,學校")).toThrow(
      "兩欄",
    );
    const store = new AcademicDemoStore(rows);
    expect(() =>
      store.import([{ number: "003", name: "張語彤" }, rows[0]]),
    ).toThrow("重複");
    expect(store.readWorkspace().candidates).toHaveLength(2);
  });
});
