export type AcademicLevel = 1 | 2;
export type AcademicLevelFilter = AcademicLevel | "unassigned";
export const academicLevels = [
  {
    id: 1 as const,
    name: "一級檢定",
    first: "機581115100401",
    last: "機581115100436",
  },
  {
    id: 2 as const,
    name: "二級檢定",
    first: "機582115100401",
    last: "機582115100411",
  },
];
export function normalizeAcademicNumber(value: string) {
  return value.normalize("NFKC").trim();
}
// Classification is derived from the original identifier, never stored as a
// second editable field that could disagree with it. Unknown legacy rows stay visible.
export function academicLevel(number: string): AcademicLevel | null {
  const value = normalizeAcademicNumber(number);
  if (!/^機\d{12}$/.test(value)) return null;
  return (
    academicLevels.find((level) => value >= level.first && value <= level.last)
      ?.id ?? null
  );
}
export function academicLevelName(level: AcademicLevelFilter | null) {
  return academicLevels.find((item) => item.id === level)?.name ?? "待確認等級";
}
export function academicLevelRows<T extends { number: string }>(
  rows: T[],
  level: AcademicLevelFilter,
): T[] {
  return rows
    .filter((row) => (academicLevel(row.number) ?? "unassigned") === level)
    .sort((a, b) =>
      normalizeAcademicNumber(a.number).localeCompare(
        normalizeAcademicNumber(b.number),
        "zh-TW",
        { numeric: true },
      ),
    );
}
export function academicRosterTemplate(level: AcademicLevel) {
  return [
    ["參賽編號", "姓名"],
    [academicLevels.find((item) => item.id === level)!.first, "王小明"],
  ];
}
