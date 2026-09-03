import React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/supabase", () => ({
  isDemoMode: false,
  backendConfigured: false,
  supabase: null,
}));
import Root from "../src/Root";
import App from "../src/App";
import AcademicApp from "../src/AcademicApp";
import {
  getStaff,
  importTeams,
  loadAudit,
  readDemoChallenge,
} from "../src/data";

afterEach(() => vi.unstubAllGlobals());
describe("production access is closed without configuration or session", () => {
  it.each(["#/challenge", "#/challenge/staff", "#/exam", "#/exam/staff"])(
    "closes %s when unconfigured",
    (hash) => {
      vi.stubGlobal("location", { hash });
      const html = renderToString(<Root />);
      expect(html).toContain("系統尚未開放");
      expect(html).not.toContain("示範模式");
      expect(html).not.toContain('type="password"');
    },
  );
  it("does not invent an administrator or silently accept an import", async () => {
    await expect(getStaff()).rejects.toThrow("正式連線尚未設定");
    await expect(importTeams([])).rejects.toThrow("正式連線尚未設定");
    await expect(loadAudit()).rejects.toThrow("正式連線尚未設定");
    expect(readDemoChallenge().teams).toEqual([]);
    expect(readDemoChallenge().attempts).toEqual([]);
  });
  it("does not render challenge tools before authentication", () => {
    vi.stubGlobal("location", { hash: "#/challenge/staff" });
    vi.stubGlobal("navigator", { onLine: true });
    const html = renderToString(<App />);
    expect(html).not.toContain("匯入名單");
    expect(html).not.toContain("修正紀錄");
    expect(html).not.toContain("確認並發布成績");
  });
  it("does not render academic tools before authentication", () => {
    vi.stubGlobal("navigator", { onLine: true });
    const html = renderToString(<AcademicApp staffView />);
    expect(html).not.toContain("公布全部學科成績");
    expect(html).not.toContain("目前分數（內部）");
  });
});
