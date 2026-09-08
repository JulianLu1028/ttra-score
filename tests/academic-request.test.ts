import { afterEach, describe, expect, it, vi } from "vitest";
import {
  academicImportError,
  academicRequest,
  AcademicRequestTimeout,
} from "../src/academic-request";

afterEach(() => vi.useRealTimers());

describe("學科匯入等待與結果提示", () => {
  it("登入等待或請求卡住時會結束等待，並中止網路請求", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const request = academicRequest((value) => {
      signal = value;
      return new Promise(() => {});
    });
    const rejected = expect(request).rejects.toBeInstanceOf(
      AcademicRequestTimeout,
    );
    await vi.advanceTimersByTimeAsync(20000);
    await rejected;
    expect(signal?.aborted).toBe(true);
    // A timed-out write may have committed; do not suggest blindly resubmitting.
    expect(academicImportError(new AcademicRequestTimeout())).toContain(
      "確認名單是否已匯入",
    );
  });

  it("及時收到結果後取消計時，不會中止已完成的請求", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const result = await academicRequest((value) => {
      signal = value;
      return Promise.resolve({ data: 45, error: null });
    });
    expect(result.data).toBe(45);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(20000);
    expect(signal?.aborted).toBe(false);
  });

  it("保留後端失敗原因，重複編號說明整批未新增", async () => {
    const failure = { code: "23505", message: "duplicate key" };
    await expect(academicRequest(() => Promise.reject(failure))).rejects.toBe(
      failure,
    );
    expect(academicImportError(failure)).toContain("整批未新增");
    expect(academicImportError(new Error("網路無法連線"))).toContain(
      "網路無法連線",
    );
  });
});
