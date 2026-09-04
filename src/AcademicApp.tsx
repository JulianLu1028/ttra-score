import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Bot, Download, RefreshCw, ShieldCheck, Upload } from "./icons";
import { isDemoMode, supabase } from "./supabase";
import { getStaff, subscribe, type Staff } from "./data";
import { Login } from "./App";
import { downloadCSV } from "./csv";
import {
  academicScore,
  getAcademicWorkspace,
  getAcademicPublic,
  importAcademic,
  parseAcademicCSV,
  publishAcademic,
  saveAcademic,
  type AcademicCandidate,
  type AcademicPublic,
  type AcademicRosterRow,
  type AcademicWorkspace,
} from "./academic";

export default function AcademicApp({ staffView }: { staffView: boolean }) {
  const [session, setSession] = useState<Session | null>(null);
  const [staff, setStaff] = useState<Staff | null>(
    isDemoMode
      ? { role: "admin", categoryIds: [], canGradeAcademic: true }
      : null,
  );
  const [authLoading, setAuthLoading] = useState(!isDemoMode);
  const [online, setOnline] = useState(navigator.onLine);
  const [workspace, setWorkspace] = useState<AcademicWorkspace | null>(null);
  const [publicData, setPublicData] = useState<AcademicPublic | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AcademicCandidate | null>(null);
  const [scoreText, setScoreText] = useState("");
  const [reason, setReason] = useState("");
  const [importRows, setImportRows] = useState<AcademicRosterRow[]>([]);
  const [publishConfirmation, setPublishConfirmation] = useState<{
    version: number;
    count: number;
    missing: number;
    requestId: string;
  } | null>(null);
  const saveReceipt = useRef({ signature: "", id: "" });
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const canGrade = Boolean(
    (isDemoMode || (session && !authLoading)) &&
    staff &&
    (staff.role === "admin" ||
      (staff.role === "judge" && staff.canGradeAcademic)),
  );
  const canImport = staff?.role === "admin";
  useEffect(() => {
    const on = () => {
        setOnline(true);
        void refreshRef.current();
      },
      off = () => setOnline(false);
    addEventListener("online", on);
    addEventListener("offline", off);
    return () => {
      removeEventListener("online", on);
      removeEventListener("offline", off);
    };
  }, []);
  useEffect(() => {
    if (!supabase) return;
    let live = true,
      authChanged = false;
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (live && !authChanged) {
          setSession(data.session);
          setAuthLoading(Boolean(data.session));
        }
      })
      .catch(() => {
        if (live && !authChanged) {
          setAuthLoading(false);
          setError("登入狀態確認失敗，請重新整理後再試。");
        }
      });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, next) => {
      authChanged = true;
      setStaff(null);
      setWorkspace(null);
      setSelected(null);
      setPublishConfirmation(null);
      setAuthLoading(Boolean(next));
      setSession(next);
    });
    return () => {
      live = false;
      subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (isDemoMode) return;
    setStaff(null);
    if (!session) {
      setAuthLoading(false);
      return;
    }
    let live = true;
    setAuthLoading(true);
    void getStaff()
      .then((value) => {
        if (live) setStaff(value);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setAuthLoading(false);
      });
    return () => {
      live = false;
    };
  }, [session]);
  useEffect(() => {
    let live = true,
      pending = false;
    setWorkspace(null);
    setPublicData(null);
    setLoading(true);
    setSelected(null);
    setPublishConfirmation(null);
    setImportRows([]);
    setError("");
    setNotice("");
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        if (staffView) {
          if (!canGrade) return;
          const value = await getAcademicWorkspace();
          if (live) setWorkspace(value);
        } else {
          const value = await getAcademicPublic();
          if (live) setPublicData(value);
        }
        if (live) setError("");
      } catch (e) {
        if (live) setError("更新失敗：" + (e as Error).message);
      } finally {
        pending = false;
        if (live) setLoading(false);
      }
    };
    refreshRef.current = refresh;
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    const stop = subscribe(
      () => void refresh(),
      () => {},
    );
    return () => {
      live = false;
      clearInterval(timer);
      stop();
    };
  }, [staffView, canGrade, session?.user.id]);
  const candidates = workspace?.candidates ?? [];
  const graded = candidates.filter((c) => c.score !== null).length;
  const matches = (c: AcademicRosterRow) =>
    (c.number + " " + c.name).toLowerCase().includes(query.toLowerCase());
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      await refreshRef.current();
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function readFile(file?: File) {
    setImportRows([]);
    setError("");
    if (!file) return;
    try {
      if (file.size > 1000000) throw new Error("檔案上限 1 MB");
      const rows = parseAcademicCSV(await file.text());
      if (rows.some((r) => candidates.some((c) => c.number === r.number)))
        throw new Error("名單含已存在的參賽編號；匯入不會覆蓋原名單");
      setImportRows(rows);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function save() {
    if (!selected) return;
    let value: number;
    try {
      value = academicScore(scoreText);
      if (selected.score !== null && !reason.trim())
        throw new Error("請填寫修改原因");
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    const signature = JSON.stringify([
      selected.id,
      selected.revision,
      value,
      reason,
    ]);
    if (saveReceipt.current.signature !== signature)
      saveReceipt.current = { signature, id: crypto.randomUUID() };
    await run(async () => {
      await saveAcademic({
        id: selected.id,
        score: value,
        reason,
        expected_revision: selected.revision,
        request_id: saveReceipt.current.id,
      });
      setSelected(null);
    }, "學科成績已儲存，尚未新增至公開成績；請確認後統一公布。");
  }
  return (
    <div className="academic-theme academic-shell">
      {isDemoMode && (
        <div className="demo-bar">
          示範模式 · 姓名與成績皆為虛構，重整後重設，尚未連接正式賽事
        </div>
      )}
      <header className="site-header">
        <a className="brand" href="#/exam">
          <span className="brand-mark">
            <Bot />
          </span>
          <span>
            TTRA<span className="brand-caption">2026 EXAMINATION</span>
          </span>
        </a>
        <div className="header-right">
          <a className="section-link" href="#/challenge">
            挑戰賽專區
          </a>
          {staffView && (
            <Button
              variant="outline"
              onClick={() => {
                location.hash = "/exam";
              }}
            >
              家長看成績
            </Button>
          )}
        </div>
      </header>
      <main className="page academic-page">
        <section className="page-intro">
          <div>
            <p className="eyebrow">2026 TTRA 機器人實作技能檢定</p>
            <h1>{staffView ? "學科成績工作台" : "檢定學科成績"}</h1>
            <p className="muted">
              學科成績 0–100 分 · 由裁判／評審確認後統一公布
            </p>
          </div>
          <Button
            variant="outline"
            disabled={loading || busy}
            onClick={() => void refreshRef.current()}
          >
            <RefreshCw />
            更新
          </Button>
        </section>
        {!online && (
          <p className="notice">
            網路中斷：目前為上次取得的資料，無法登分或公布。
          </p>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="success-message">
            {notice}
          </p>
        )}
        {staffView && !canGrade ? (
          <section className="panel auth-panel">
            {authLoading ? (
              <p>正在確認權限…</p>
            ) : !session ? (
              <Login />
            ) : (
              <>
                <ShieldCheck />
                <h2>尚未取得學科操作權限</h2>
                <p>
                  請主辦人授予學科評審權限；挑戰賽裁判不會自動取得學科權限。
                </p>
                <Button
                  variant="outline"
                  onClick={() =>
                    void supabase!.auth.signOut({ scope: "local" })
                  }
                >
                  登出
                </Button>
              </>
            )}
          </section>
        ) : staffView ? (
          <>
            <section className="academic-summary">
              <div>
                <span>學科參賽者</span>
                <strong>{candidates.length} 人</strong>
              </div>
              <div>
                <span>已登分</span>
                <strong>{graded} 人</strong>
              </div>
              <div>
                <span>未登分</span>
                <strong>{candidates.length - graded} 人</strong>
              </div>
              <div>
                <span>已公開</span>
                <strong>
                  {candidates.filter((c) => c.published_score !== null).length}{" "}
                  人
                </strong>
              </div>
            </section>
            <section className="panel publication-panel">
              <div>
                <h2>手動統一公布</h2>
                <p>
                  預計 10/04（日）10:00
                  公布，時間到不會自動發布。可等批改完成後再操作。
                </p>
                <p className="muted">
                  {workspace?.publishedAt
                    ? "最近公布：" +
                      new Date(workspace.publishedAt).toLocaleString("zh-TW")
                    : "尚未公布任何學科成績"}
                  。新登分及更正都需要再次公布。
                </p>
              </div>
              <Button
                className="primary-action"
                disabled={!online || busy || loading || !graded || !workspace}
                onClick={() =>
                  setPublishConfirmation({
                    version: workspace!.version,
                    count: graded,
                    missing: candidates.length - graded,
                    requestId: crypto.randomUUID(),
                  })
                }
              >
                公布全部學科成績
              </Button>
            </section>
            <section className="panel">
              <div className="panel-heading">
                <h2>學科登分名單</h2>
                {!isDemoMode && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void supabase!.auth.signOut({ scope: "local" })
                    }
                  >
                    登出
                  </Button>
                )}
              </div>
              <div className="toolbar">
                <Input
                  aria-label="搜尋學科參賽者"
                  placeholder="搜尋姓名或參賽編號"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {loading ? (
                <p className="empty-state">正在取得名單…</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>參賽編號</TableHead>
                      <TableHead>姓名</TableHead>
                      <TableHead>目前分數（內部）</TableHead>
                      <TableHead>公開分數</TableHead>
                      <TableHead>操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {candidates.filter(matches).map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>{c.number}</TableCell>
                        <TableCell>{c.name}</TableCell>
                        <TableCell>
                          {c.score === null ? "尚未登錄" : c.score + " 分"}
                          {c.score !== c.published_score &&
                            c.score !== null && (
                              <span className="academic-draft">待公布</span>
                            )}
                        </TableCell>
                        <TableCell>
                          {c.published_score === null
                            ? "尚未公布"
                            : c.published_score + " 分"}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="outline"
                            disabled={busy || !online}
                            onClick={() => {
                              setSelected(c);
                              setScoreText(
                                c.score === null ? "" : String(c.score),
                              );
                              setReason("");
                              setError("");
                            }}
                          >
                            {c.score === null ? "登分" : "修改"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {!loading && !candidates.filter(matches).length && (
                <p className="empty-state">沒有符合的參賽者。</p>
              )}
            </section>
            {canImport && (
              <section className="panel form-panel">
                <div className="panel-heading">
                  <h2>匯入學科名單</h2>
                  <Button
                    variant="outline"
                    onClick={() =>
                      downloadCSV("TTRA-學科名單範本.csv", [
                        ["參賽編號", "姓名"],
                        ["E101", "王小明"],
                      ])
                    }
                  >
                    <Download />
                    下載範本
                  </Button>
                </div>
                <div className="form-body">
                  <p className="hint">
                    使用 UTF-8
                    CSV，每列一位參賽者，只保留參賽編號、姓名。與挑戰賽名單分開管理。範本姓名為虛構；姓名與分數會在確認公布後公開。
                  </p>
                  <label className="field">
                    <span>學科名單 CSV</span>
                    <Input
                      type="file"
                      accept=".csv,text/csv"
                      disabled={busy || !online}
                      onChange={(e) => void readFile(e.target.files?.[0])}
                    />
                  </label>
                  {importRows.length > 0 && (
                    <>
                      <p>預覽 {importRows.length} 人；只新增，不覆蓋原名單。</p>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>參賽編號</TableHead>
                            <TableHead>姓名</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {importRows.map((r) => (
                            <TableRow key={r.number}>
                              <TableCell>{r.number}</TableCell>
                              <TableCell>{r.name}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      <Button
                        disabled={busy || !online}
                        onClick={() =>
                          void run(async () => {
                            await importAcademic(importRows);
                            setImportRows([]);
                          }, "學科名單已匯入，尚未公布。")
                        }
                      >
                        <Upload />
                        確認匯入 {importRows.length} 人
                      </Button>
                    </>
                  )}
                </div>
              </section>
            )}
            <section className="panel academic-audit">
              <div className="panel-heading">
                <h2>登分與公布紀錄</h2>
                <span>最近 200 筆</span>
              </div>
              {!workspace?.audit.length && (
                <p className="empty-state">尚無紀錄</p>
              )}
              {workspace?.audit.map((a) => (
                <details className="audit-row" key={a.id}>
                  <summary>
                    <strong>{a.number || "全部學科成績"}</strong>
                    <span>
                      {(
                        {
                          import: "名單匯入",
                          score: "成績登錄／更正",
                          publish: "統一公布",
                        } as Record<string, string>
                      )[a.action] || a.action}
                    </span>
                    <time>
                      {new Date(a.created_at).toLocaleString("zh-TW")}
                    </time>
                  </summary>
                  <p>
                    {a.actor_id} · {a.reason || "首次登錄／公布"}
                  </p>
                  <pre>
                    {JSON.stringify(
                      { 修改前: a.old_value, 修改後: a.new_value },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              ))}
            </section>
          </>
        ) : (
          <section className="panel">
            <div className="panel-heading">
              <h2>學科成績公告</h2>
              <span>{publicData?.publishedAt ? "已公布" : "待公布"}</span>
            </div>
            {loading ? (
              <p className="empty-state">正在取得成績…</p>
            ) : !publicData?.publishedAt ? (
              <div className="empty-state">
                <ShieldCheck />
                <h2>成績尚未公布</h2>
                <p>
                  預計 10/04（日）10:00 公布，實際時間依批改進度及評審確認為準。
                </p>
                <p>公布後本頁會自動更新。</p>
              </div>
            ) : (
              <>
                <p className="rules-note">
                  公布時間：
                  {new Date(publicData.publishedAt).toLocaleString("zh-TW")} ·
                  共 {publicData.results.length}{" "}
                  人。尚未列出者可能仍未完成登分。
                </p>
                <div className="toolbar">
                  <Input
                    aria-label="搜尋學科成績"
                    placeholder="搜尋姓名或參賽編號"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>參賽編號</TableHead>
                      <TableHead>姓名</TableHead>
                      <TableHead>學科成績</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {publicData.results.filter(matches).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.number}</TableCell>
                        <TableCell>{r.name}</TableCell>
                        <TableCell>
                          <strong>{r.score} 分</strong>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {!publicData.results.filter(matches).length && (
                  <p className="empty-state">沒有符合的已公布成績。</p>
                )}
              </>
            )}
          </section>
        )}
        <footer>
          <span>台灣青少年機器人協會 TTRA</span>
          <span>
            {isDemoMode ? "示範內容，非正式成績" : "學科成績以大會最終核定為準"}
          </span>
        </footer>
      </main>
      <Dialog
        open={Boolean(selected) && staffView && canGrade}
        onOpenChange={(open) => {
          if (!open && !busy) setSelected(null);
        }}
      >
        <DialogContent className="academic-theme academic-dialog">
          <DialogTitle>
            {selected?.number} · {selected?.name}
          </DialogTitle>
          <DialogDescription>
            儲存只更新內部成績，不會立即公開。已有分數的更正需填寫原因。
          </DialogDescription>
          <label className="field">
            <span>學科成績（0–100 分）</span>
            <Input
              type="number"
              min={0}
              max={100}
              step={0.1}
              aria-label="學科成績"
              value={scoreText}
              disabled={busy}
              onChange={(e) => setScoreText(e.target.value)}
            />
          </label>
          <label className="field">
            <span>
              修改原因{selected?.score !== null ? "（必填）" : "（選填）"}
            </span>
            <Textarea
              aria-label="學科修改原因"
              maxLength={1000}
              value={reason}
              disabled={busy}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <Button disabled={busy || !online} onClick={() => void save()}>
            {busy ? "儲存中…" : "儲存學科成績"}
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(publishConfirmation) && staffView && canGrade}
        onOpenChange={(open) => {
          if (!open && !busy) setPublishConfirmation(null);
        }}
      >
        <DialogContent className="academic-theme academic-dialog">
          <DialogTitle>確認一次公布全部已登錄成績？</DialogTitle>
          <DialogDescription>
            將公開 {publishConfirmation?.count} 人的姓名與分數。尚有{" "}
            {publishConfirmation?.missing} 人未登分，不會將空白當成 0
            分。家長會看到本次確認的成績。
          </DialogDescription>
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <Button
            disabled={busy || !online}
            onClick={() => {
              if (publishConfirmation)
                void run(async () => {
                  await publishAcademic(
                    publishConfirmation.version,
                    publishConfirmation.requestId,
                  );
                  setPublishConfirmation(null);
                }, "本次學科成績已統一公布。");
            }}
          >
            {busy ? "公布中…" : "確認公布"}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setPublishConfirmation(null)}
          >
            返回核對
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
