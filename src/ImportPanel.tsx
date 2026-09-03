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
import { categories, type Team } from "./domain";
import { parseTeams, downloadCSV } from "./csv";
import type { ImportTeam } from "./data";
export function ImportPanel({
  teams,
  onImport,
  disabled,
}: {
  teams: Team[];
  onImport: (rows: ImportTeam[]) => Promise<void>;
  disabled: boolean;
}) {
  const [rows, setRows] = useState<ImportTeam[]>([]),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [busy, setBusy] = useState(false);
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
      const parsed = parseTeams(await file.text());
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
      setSuccess("已匯入 " + rows.length + " 人");
      setRows([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel form-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">ROSTER IMPORT</p>
          <h2>賽前參賽者名單</h2>
        </div>
        <Button
          variant="outline"
          onClick={() =>
            downloadCSV("TTRA-參賽者名單範本.csv", [
              ["參賽編號", "姓名", "組別", "梯次"],
              ["101", "陳宥安", "幼兒簡易機械組", 1],
            ])
          }
        >
          <Download />
          下載範本
        </Button>
      </div>
      <div className="form-body">
        <p className="hint">
          使用 UTF-8 CSV。Excel 可另存為「CSV
          UTF-8」。每列一位參賽者，以參賽編號區分同名者。姓名與成績會公開，請確認可公開後再匯入；不要上傳電話、家長聯絡方式等資料。範本姓名為虛構，匯入前請替換。
        </p>
        <p className="hint">
          梯次請填數字：程式機械組 1–3，其餘組別
          1–2。梯次只分隔名單，不分開排名。
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
            <p>預覽 {rows.length} 人，確認後才會寫入。</p>
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
  );
}
