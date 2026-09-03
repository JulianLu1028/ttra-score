import { categories, heatCount, type CategoryId } from "./domain";
import type { ImportTeam } from "./data";
export const categoryPrefixes: Record<CategoryId, string> = {
  preschool: "A",
  power: "B",
  program: "C",
  creative: "D",
};
export function participantNumber(categoryId: CategoryId, sequence: number) {
  return categoryPrefixes[categoryId] + String(sequence).padStart(3, "0");
}
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw new Error("CSV 引號未關閉");
  row.push(field);
  if (row.some(Boolean)) rows.push(row);
  return rows.map((r) => r.map((v) => v.replace(/^\uFEFF/, "").trim()));
}
export function parseTeams(text: string, categoryId: CategoryId): ImportTeam[] {
  const [headers, ...rows] = parseCSV(text);
  if (!headers || rows.length === 0) throw new Error("名單沒有資料");
  if (rows.length > 500) throw new Error("每次最多匯入 500 人");
  const index = (...names: string[]) =>
    headers.findIndex((h) => names.includes(h));
  const allowed = [
    "參賽編號",
    "participant_number",
    "team_number",
    "姓名",
    "name",
    "梯次",
    "heat",
  ];
  if (
    headers.some((h) => !allowed.includes(h)) ||
    new Set(headers).size !== headers.length
  )
    throw new Error("請使用目前項目的範本，只保留參賽編號、姓名、梯次三個欄位");
  const ni = index("參賽編號", "participant_number", "team_number"),
    na = index("姓名", "name"),
    hi = index("梯次", "heat");
  if ([ni, na, hi].some((i) => i < 0) || headers.length !== 3)
    throw new Error(
      "需要「參賽編號、姓名、梯次」三個欄位；組別由目前頁面自動帶入",
    );
  const category = categories.find((c) => c.id === categoryId)!;
  const expectedPrefix = categoryPrefixes[categoryId];
  const seen = new Set<string>();
  return rows.map((row, i) => {
    const number = row[ni],
      name = row[na];
    if (!number || !name)
      throw new Error("第 " + (i + 2) + " 列：參賽編號或姓名不可空白");
    if (!/^[A-D][0-9]{3}$/.test(number))
      throw new Error(
        "第 " + (i + 2) + " 列：參賽編號須為 A001、B001、C001、D001 這類格式",
      );
    if (!number.startsWith(expectedPrefix)) {
      const actual = categories.find(
        (c) => categoryPrefixes[c.id] === number[0],
      )!;
      throw new Error(
        "第 " +
          (i + 2) +
          " 列：編號 " +
          number +
          " 屬於「" +
          actual.name +
          "」，目前選擇的是「" +
          category.name +
          "」",
      );
    }
    if (number.length > 32 || name.length > 100)
      throw new Error("第 " + (i + 2) + " 列：參賽編號或姓名過長");
    const heat = Number(row[hi]);
    if (
      row.length !== 3 ||
      !Number.isInteger(heat) ||
      heat < 1 ||
      heat > heatCount(categoryId)
    )
      throw new Error(
        "第 " +
          (i + 2) +
          " 列：" +
          category.name +
          "的梯次須為 1–" +
          heatCount(categoryId),
      );
    if (seen.has(number)) throw new Error("重複參賽編號：" + number);
    seen.add(number);
    return {
      number,
      name,
      heat,
      categoryId,
    };
  });
}
export function toCSV(rows: (string | number | null)[][]) {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((v) => {
            let value = String(v ?? "");
            if (/^[=+@\-\t\r]/.test(value)) value = "'" + value;
            return '"' + value.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n")
  );
}
export function downloadCSV(
  filename: string,
  rows: (string | number | null)[][],
) {
  const url = URL.createObjectURL(
    new Blob([toCSV(rows)], { type: "text/csv;charset=utf-8;" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
