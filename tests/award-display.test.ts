import { describe, it, expect } from "vitest";
import { awardLabel, validAwardQuotas } from "../src/award-display";

describe("名次與佳作顯示", () => {
  it("佳作永不顯示順位，既有名次保持相容", () => {
    expect(awardLabel({ rank: 4, award_type: "merit" })).toBe("佳作");
    expect(awardLabel({ rank: null, award_type: "merit" })).toBe("佳作");
    expect(awardLabel({ rank: 3, award_type: "rank" })).toBe("第 3 名");
    expect(awardLabel({ rank: 1 })).toBe("第 1 名");
  });
  it("名額可單項為零，但不可留白、負數、小數或合計超額", () => {
    for (const pair of [
      ["3", "2"],
      ["0", "2"],
      ["3", "0"],
      ["250", "250"],
    ])
      expect(validAwardQuotas(...(pair as [string, string]))).toBe(true);
    for (const pair of [
      ["", "2"],
      ["3", ""],
      ["0", "0"],
      ["-1", "2"],
      ["1.5", "2"],
      ["300", "300"],
      [" ", "2"],
    ])
      expect(validAwardQuotas(...(pair as [string, string]))).toBe(false);
  });
});
