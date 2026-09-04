import { useState } from "react";
import { Upload, Download } from "./icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { categories, type CategoryId, type Team } from "./domain";
import { parseTeams, downloadCSV, challengeRosterTemplate } from "./csv";
import type { ImportTeam } from "./data";
import { CategoryTabs } from "./CategoryTabs";
export function ImportPanel({
  teams,
  categoryId,
  onCategoryChange,
  onImport,
  disabled,
}: {
  teams: Team[];
  categoryId: CategoryId;
  onCategoryChange: (categoryId: CategoryId) => void;
  onImport: (rows: ImportTeam[]) => Promise<void>;
  disabled: boolean;
}) {
  const [rows, setRows] = useState<ImportTeam[]>([]),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [busy, setBusy] = useState(false);
  const category = categories.find((c) => c.id === categoryId)!;
  async function read(file?: File) {
    setRows([]);
    setError("");
    setSuccess("");
    if (!file) return;
    if (file.size > 1000000) {
      setError("檔案上限 1 MB");
      return;
    }
    try {
      const parsed = parseTeams(await file.text(), categoryId);
      const duplicate = parsed.find((r) =>
        teams.some((t) => t.number === r.number),
      );
      if (duplicate)
        throw new Error(
          "參賽編號 " + duplicate.number + " 已存在，匯入不會覆蓋現有參賽者",
        );
      setRows(parsed);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function submit() {
    setBusy(true);
    try {
      await onImport(rows);
      setSuccess("已匯入「" + category.name + "」" + rows.length + " 人");
      setRows([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <CategoryTabs value={categoryId} onChange={onCategoryChange} />
      <section className="panel form-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">ROSTER IMPORT</p>
            <h2>賽前參賽者名單</h2>
          </div>
          <Button
            variant="outline"
            onClick={() =>
              downloadCSV(
                "TTRA-" + category.name + "名單範本-參賽編號姓名.csv",
                challengeRosterTemplate(categoryId),
              )
            }
          >
            <Download />
            下載範本
          </Button>
        </div>
        <div className="form-body">
          <p className="hint">
            請先用上方按鈕選擇比賽項目。CSV
            不必填組別或梯次；系統會從幼／動／程／機與 A／B／C
            自動判斷，編號不符會整批拒絕。使用 UTF-8 CSV。Excel 可另存為「CSV
            UTF-8」。每列一位參賽者，以參賽編號區分同名者。姓名與成績會公開，請確認可公開後再匯入；不要上傳電話、家長聯絡方式等資料。範本姓名為虛構，匯入前請替換。
          </p>
          <label className="field">
            <span>選擇參賽者 CSV 檔案</span>
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void read(e.target.files?.[0])}
            />
          </label>
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          {success && (
            <p role="status" className="success-message">
              {success}
            </p>
          )}
          {rows.length > 0 && (
            <>
              <p>
                即將匯入「{category.name}」共 {rows.length} 人，確認後才會寫入。
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>參賽編號</TableHead>
                    <TableHead>姓名</TableHead>
                    <TableHead>組別</TableHead>
                    <TableHead>梯次</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.number}>
                      <TableCell>{r.number}</TableCell>
                      <TableCell>{r.name}</TableCell>
                      <TableCell>
                        {categories.find((c) => c.id === r.categoryId)?.name}
                      </TableCell>
                      <TableCell>第 {r.heat} 梯</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <Button
                className="primary-action"
                disabled={disabled || busy}
                onClick={submit}
              >
                <Upload />
                {busy ? "匯入中…" : "確認匯入 " + rows.length + " 人"}
              </Button>
            </>
          )}
        </div>
      </section>
    </>
  );
}
