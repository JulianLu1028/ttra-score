import React from "react";
import { renderToString } from "react-dom/server";
import { describe, it, expect, vi, afterEach } from "vitest";
import App, { Login } from "../src/App";
import { ScoreForm } from "../src/ScoreForm";
import { ImportPanel } from "../src/ImportPanel";
import { categories, type Team } from "../src/domain";
import AcademicApp from "../src/AcademicApp";

afterEach(() => vi.unstubAllGlobals());
describe("非瀏覽器渲染檢查", () => {
  it("家長入口可渲染且示範模式清楚標示", () => {
    vi.stubGlobal("location", { hash: "#/" });
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("localStorage", { getItem: () => null });
    const html = renderToString(<App />);
    expect(html).toContain("示範模式");
    expect(html).not.toContain("工作人員入口");
    expect(html).not.toMatch(/href="[^"]*\/staff"/);
    expect(html).toContain("科創機器人組");
    expect(html).toContain("姓名與成績皆為虛構");
    expect(html).toContain("參賽人數");
    expect(html).toContain("搜尋姓名或參賽編號");
    expect(html).toContain("全部梯次");
    expect(html).toContain('aria-label="第 1 梯名單"');
    expect(html).toContain('aria-label="第 2 梯名單"');
    expect(html).toContain("名次為全組總排名");
    expect(html).not.toContain("學校");
    expect(html).not.toContain("academic-theme");
    expect(html).not.toMatch(/隊伍|隊名|TEAM CHECK-IN/);
  });
  it("裁判入口使用相同梯次分段", () => {
    vi.stubGlobal("location", { hash: "#/challenge/staff" });
    vi.stubGlobal("navigator", { onLine: true });
    vi.stubGlobal("localStorage", { getItem: () => null });
    const html = renderToString(<App />);
    expect(html).toContain("挑戰賽工作台");
    expect(html).toContain('aria-label="第 1 梯名單"');
    expect(html).toContain('aria-label="第 2 梯名單"');
    expect(html).toContain("名次為全組總排名");
  });
  it("匯入介面使用單人賽用詞並提醒姓名將公開", () => {
    const html = renderToString(
      <ImportPanel
        teams={[]}
        categoryId="preschool"
        onImport={async () => {}}
        disabled={false}
      />,
    );
    expect(html).toContain("賽前參賽者名單");
    expect(html).toContain("每列一位參賽者");
    expect(html).toContain("CSV 不必填組別");
    expect(html).toContain("下載新版三欄範本");
    expect(html).toContain("新版範本固定只有三欄");
    expect(html).toContain("姓名與成績會公開");
    expect(html).not.toMatch(/隊伍|隊名/);
  });
  for (const c of categories)
    it(c.name + " 表單可渲染", () => {
      const team: Team = {
        id: "test",
        number: "001",
        name: "陳宥安",
        heat: 1,
        categoryId: c.id,
        checkinStatus: "checked_in",
      };
      const html = renderToString(
        <ScoreForm
          team={team}
          attempts={[]}
          onSave={async () => {}}
          disabled={false}
        />,
      );
      expect(html).toContain("陳宥安");
      expect(html).toContain("確認並發布成績");
      expect(html).not.toContain("NaN");
    });
});
it("學科家長入口不渲染內部登分功能", () => {
  vi.stubGlobal("navigator", { onLine: true });
  const html = renderToString(<AcademicApp staffView={false} />);
  expect(html).toContain("檢定學科成績");
  expect(html).toContain('class="academic-theme academic-shell"');
  expect(html).not.toContain("公布全部學科成績");
  expect(html).not.toContain("目前分數（內部）");
  expect(html).not.toContain("工作人員入口");
  expect(html).not.toMatch(/href="[^"]*\/staff"/);
});
it("工作台只要求密碼，不顯示帳號或 Email 欄位", () => {
  const html = renderToString(<Login />);
  expect(html).toContain('type="password"');
  expect(html).toContain("工作人員密碼");
  expect(html).not.toContain('type="email"');
  expect(html).not.toContain("staff@ttra-score.invalid");
  expect(html).not.toContain("登入連結");
});
it("學科裁判入口與家長入口使用相同的獨立配色", () => {
  vi.stubGlobal("navigator", { onLine: true });
  const html = renderToString(<AcademicApp staffView={true} />);
  expect(html).toContain('class="academic-theme academic-shell"');
  expect(html).toContain("學科成績工作台");
});
