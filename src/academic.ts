import { parseCSV } from "./csv";
import { isDemoMode, supabase } from "./supabase";

export type AcademicRosterRow = { number: string; name: string };
export type AcademicCandidate = AcademicRosterRow & {
  id: string;
  score: number | null;
  revision: number;
  updated_at: string;
  published_score: number | null;
};
export type AcademicResult = AcademicRosterRow & {
  id: string;
  score: number;
  published_at: string;
};
export type AcademicAudit = {
  id: number;
  number?: string;
  action: string;
  actor_id: string;
  reason?: string;
  created_at: string;
  old_value?: unknown;
  new_value?: unknown;
};
export type AcademicWorkspace = {
  version: number;
  publishedAt: string | null;
  candidates: AcademicCandidate[];
  audit: AcademicAudit[];
};
export type AcademicPublic = {
  version: number;
  publishedAt: string | null;
  results: AcademicResult[];
};
export type AcademicSave = {
  id: string;
  score: number;
  reason: string;
  expected_revision: number;
  request_id: string;
};
export function parseAcademicCSV(text: string): AcademicRosterRow[] {
  const [headers, ...rows] = parseCSV(text);
  if (!headers || rows.length < 1 || rows.length > 500)
    throw new Error("每次請匯入 1–500 位參賽者");
  const ni = headers.findIndex((x) => ["參賽編號", "number"].includes(x));
  const na = headers.findIndex((x) => ["姓名", "name"].includes(x));
  if (headers.length !== 2 || ni < 0 || na < 0)
    throw new Error("學科名單只接受「參賽編號、姓名」兩欄，請使用新版範本");
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const number = row[ni],
      name = row[na];
    if (
      row.length !== 2 ||
      !number ||
      !name ||
      number.length > 32 ||
      name.length > 100
    )
      throw new Error(`第 ${index + 2} 列：請檢查參賽編號及姓名`);
    if (seen.has(number)) throw new Error("重複參賽編號：" + number);
    seen.add(number);
    return { number, name };
  });
}
export function academicScore(value: string): number {
  if (!value.trim() || !/^\d+(\.\d)?$/.test(value.trim()))
    throw new Error("請輸入 0–100 分，最多一位小數；空白不代表 0 分");
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100)
    throw new Error("學科成績須介於 0–100 分");
  return n;
}
// Ephemeral demonstration only. Real grades are fetched through protected RPCs.
export class AcademicDemoStore {
  private workspace: AcademicWorkspace;
  private publicSnapshot: AcademicPublic = {
    version: 0,
    publishedAt: null,
    results: [],
  };
  private receipts = new Map<string, string>();
  constructor(rows: AcademicRosterRow[] = []) {
    this.workspace = {
      version: 0,
      publishedAt: null,
      audit: [],
      candidates: rows.map((r, i) => ({
        ...r,
        id: "academic-demo-" + i,
        score: null,
        published_score: null,
        revision: 0,
        updated_at: new Date().toISOString(),
      })),
    };
  }
  readWorkspace() {
    return structuredClone(this.workspace);
  }
  readPublic() {
    return structuredClone(this.publicSnapshot);
  }
  import(rows: AcademicRosterRow[]) {
    const seen = new Set(this.workspace.candidates.map((c) => c.number));
    for (const r of rows) {
      if (seen.has(r.number)) throw new Error("重複參賽編號：" + r.number);
      seen.add(r.number);
    }
    const candidates = rows.map((r) => ({
      ...r,
      id: crypto.randomUUID(),
      score: null,
      published_score: null,
      revision: 0,
      updated_at: new Date().toISOString(),
    }));
    this.workspace.candidates.push(...candidates);
    for (const c of candidates)
      this.audit("import", c.number, "", undefined, c);
    this.workspace.version++;
  }
  save(input: AcademicSave) {
    const signature = JSON.stringify({ operation: "score", ...input });
    if (this.replayed(input.request_id, signature)) return;
    const c = this.workspace.candidates.find((c) => c.id === input.id);
    if (!c) throw new Error("找不到學科參賽者");
    if (c.revision !== input.expected_revision)
      throw new Error("成績已被更新，請重新載入後核對");
    if (c.score !== null && !input.reason.trim())
      throw new Error("請填寫修改原因");
    const score = academicScore(String(input.score));
    const before = structuredClone(c);
    c.score = score;
    c.revision++;
    c.updated_at = new Date().toISOString();
    this.audit("score", c.number, input.reason, before, c);
    this.workspace.version++;
    this.receipts.set(input.request_id, signature);
  }
  publish(version: number, requestId: string) {
    const signature = JSON.stringify({ operation: "publish", version });
    if (this.replayed(requestId, signature)) return;
    if (version !== this.workspace.version)
      throw new Error("名單或分數已更新，請重新確認公布人數與成績");
    const graded = this.workspace.candidates.filter((c) => c.score !== null);
    if (!graded.length) throw new Error("尚無可公布的學科成績");
    const stamp = new Date().toISOString();
    this.workspace.version++;
    this.publicSnapshot = {
      version: this.workspace.version,
      publishedAt: stamp,
      results: graded.map((c) => ({
        id: c.id,
        number: c.number,
        name: c.name,
        score: c.score!,
        published_at: stamp,
      })),
    };
    for (const c of graded) c.published_score = c.score;
    this.workspace.publishedAt = stamp;
    this.audit("publish", undefined, "", undefined, {
      count: graded.length,
      publishedAt: stamp,
    });
    this.receipts.set(requestId, signature);
  }
  private replayed(id: string, signature: string) {
    if (!id) throw new Error("缺少送出識別碼");
    const previous = this.receipts.get(id);
    if (previous && previous !== signature)
      throw new Error("送出識別碼已用於其他內容");
    return Boolean(previous);
  }
  private audit(
    action: string,
    number?: string,
    reason = "",
    old_value?: unknown,
    new_value?: unknown,
  ) {
    this.workspace.audit.unshift({
      id: this.workspace.audit.length + 1,
      number,
      action,
      reason,
      actor_id: "示範管理員",
      created_at: new Date().toISOString(),
      old_value: structuredClone(old_value),
      new_value: structuredClone(new_value),
    });
  }
}
const demoAcademic = new AcademicDemoStore([
  { number: "E001", name: "陳宥安" },
  { number: "E002", name: "林芷晴" },
  { number: "E003", name: "黃品睿" },
  { number: "E004", name: "張語彤" },
]);
export async function getAcademicWorkspace(): Promise<AcademicWorkspace> {
  if (isDemoMode) return demoAcademic.readWorkspace();
  const { data, error } = await supabase!.rpc("get_academic_workspace");
  if (error) throw error;
  return data;
}
export async function getAcademicPublic(): Promise<AcademicPublic> {
  if (isDemoMode) return demoAcademic.readPublic();
  const { data, error } = await supabase!.rpc("get_academic_results");
  if (error) throw error;
  return data;
}
export async function importAcademic(rows: AcademicRosterRow[]) {
  if (isDemoMode) return demoAcademic.import(rows);
  const { error } = await supabase!.rpc("import_academic", { p_rows: rows });
  if (error) throw error;
}
export async function saveAcademic(input: AcademicSave) {
  if (isDemoMode) return demoAcademic.save(input);
  const { error } = await supabase!.rpc("save_academic_score", {
    p_input: input,
  });
  if (error) throw error;
}
export async function publishAcademic(version: number, requestId: string) {
  if (isDemoMode) return demoAcademic.publish(version, requestId);
  const { error } = await supabase!.rpc("publish_academic", {
    p_expected_version: version,
    p_request_id: requestId,
  });
  if (error) throw error;
}
