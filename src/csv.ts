import { categories, heatCount, type CategoryId } from "./domain";
import type { ImportTeam } from "./data";
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
export function parseTeams(text: string): ImportTeam[] {
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
    "組別",
    "category_id",
    "梯次",
    "heat",
  ];
  if (
    headers.some((h) => !allowed.includes(h)) ||
    new Set(headers).size !== headers.length
  )
    throw new Error("請使用新版範本，只保留參賽編號、姓名、組別、梯次四個欄位");
  const ni = index("參賽編號", "participant_number", "team_number"),
    na = index("姓名", "name"),
    hi = index("梯次", "heat"),
    ci = index("組別", "category_id");
  if ([ni, na, ci, hi].some((i) => i < 0) || headers.length !== 4)
    throw new Error("需要「參賽編號、姓名、組別、梯次」四個欄位");
  const seen = new Set<string>();
  return rows.map((row, i) => {
    const number = row[ni],
      name = row[na],
      raw = row[ci];
    const c = categories.find((c) => c.id === raw || c.name === raw);
    if (!number || !name || !c)
      throw new Error("第 " + (i + 2) + " 列：參賽編號、姓名或組別不正確");
    if (number.length > 32 || name.length > 100)
      throw new Error("第 " + (i + 2) + " 列：參賽編號或姓名過長");
    const heat = Number(row[hi]);
    if (
      row.length !== 4 ||
      !Number.isInteger(heat) ||
      heat < 1 ||
      heat > heatCount(c.id)
    )
      throw new Error(
        "第 " + (i + 2) + " 列：" + c.name + " 的梯次須為 1–" + heatCount(c.id),
      );
    if (seen.has(number)) throw new Error("重複參賽編號：" + number);
    seen.add(number);
    return {
      number,
      name,
      heat,
      categoryId: c.id as CategoryId,
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
