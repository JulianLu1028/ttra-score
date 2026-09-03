import { describe, expect, it } from "vitest";
import {
  AcademicDemoStore,
  academicScore,
  parseAcademicCSV,
} from "../src/academic";
describe("學科登分與手動公布", () => {
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
