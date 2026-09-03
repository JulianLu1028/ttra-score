import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Radio,
  Trophy,
  Users,
  CheckCircle2,
  Bot,
  Search,
  RefreshCw,
  ChevronRight,
  ArrowLeft,
  Download,
  LogOut,
  ClipboardCheck,
  History,
  Upload,
  ShieldCheck,
  WifiOff,
  Star,
} from "./icons";
import type { Session } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  categories,
  compareParticipantNumbers,
  heatNumbers,
  categoryStats,
  leaderboard,
  slotOptions,
  teamResult,
  attemptSummary,
  type Team,
  type Attempt,
  type CategoryId,
  type CheckinStatus,
} from "./domain";
import {
  loadData,
  readDemoChallenge,
  saveDemoChallenge,
  subscribe,
  setCheckin,
  saveAttempt,
  getStaff,
  importTeams,
  loadAudit,
  type SaveInput,
  type Staff,
  type ImportTeam,
  type Audit,
  type ServerResult,
} from "./data";
import { isDemoMode, supabase } from "./supabase";
import { STAFF_LOGIN_ID } from "./runtime-config";
import { ScoreForm } from "./ScoreForm";
import { ImportPanel } from "./ImportPanel";
import { CategoryTabs } from "./CategoryTabs";
import { downloadCSV } from "./csv";
const checkinLabels: Record<CheckinStatus, string> = {
  pending: "尚未報到",
  checked_in: "已報到",
  absent: "缺席",
  withdrawn: "取消參賽",
};
const rules: Record<CategoryId, string> = {
  preschool:
    "每回合小朋友 4 球、家長 2 球，取兩回合最佳。3 球以上挑戰成功，本組不排名。",
  power:
    "拉動與推動各取瓶數最多的一次，同瓶數取較短時間。合計瓶數優先、合計秒數次之；缺少有效方向不排名。",
  program:
    "兩次取最快有效成績，時間相同以車頭淨重較輕者優先。20 秒內合格，40 秒內有效。",
  creative:
    "每次限時 40 秒，到時保留得分。普通瓶 10 分，特殊瓶正確 20 分、錯誤 5 分。取最高單次，同分取耗時較短。50 分以上合格。",
};
export default function App() {
  const [route, setRoute] = useState(
    location.hash.endsWith("/staff") ? "staff" : "public",
  );
  const [group, setGroup] = useState<CategoryId>("creative");
  const [query, setQuery] = useState("");
  const [heatFilter, setHeatFilter] = useState("all");
  const [teams, setTeams] = useState<Team[]>(() =>
      isDemoMode ? readDemoChallenge().teams : [],
    ),
    [attempts, setAttempts] = useState<Attempt[]>(() =>
      isDemoMode ? readDemoChallenge().attempts : [],
    ),
    [serverResults, setServerResults] = useState<ServerResult[]>([]);
  const [loading, setLoading] = useState(!isDemoMode),
    [error, setError] = useState(""),
    [updated, setUpdated] = useState<Date | null>(null),
    [channel, setChannel] = useState("CONNECTING");
  const [online, setOnline] = useState(navigator.onLine),
    [session, setSession] = useState<Session | null>(null),
    [staff, setStaff] = useState<Staff | null>(
      isDemoMode ? { role: "admin", categoryIds: [] } : null,
    );
  const [authLoading, setAuthLoading] = useState(!isDemoMode);
  const [tab, setTab] = useState("score"),
    [selected, setSelected] = useState<Team | null>(null),
    [detail, setDetail] = useState<Team | null>(null);
  const [audit, setAudit] = useState<Audit[]>(() =>
      isDemoMode ? (readDemoChallenge().audit ?? []) : [],
    ),
    [checkinBusy, setCheckinBusy] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("ttra-favorites") || "[]");
    } catch {
      return [];
    }
  });
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  useEffect(() => {
    if (!loading) saveDemoChallenge(teams, attempts, audit);
  }, [teams, attempts, audit, loading]);
  const refresh = useCallback(async () => {
    try {
      const d = await loadData();
      setTeams(d.teams);
      setAttempts(d.attempts);
      setServerResults(d.results ?? []);
      if (isDemoMode) setAudit(d.audit ?? []);
      setUpdated(new Date());
      setError("");
    } catch (e) {
      setError("成績更新失敗，保留上次資料。" + ((e as Error).message || ""));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    if (isDemoMode) return;
    let debounce: ReturnType<typeof setTimeout>;
    const stop = subscribe(() => {
      clearTimeout(debounce);
      debounce = setTimeout(() => void refresh(), 200);
    }, setChannel);
    const timer = setInterval(() => void refresh(), 10000);
    return () => {
      stop();
      clearTimeout(debounce);
      clearInterval(timer);
    };
  }, [refresh]);
  useEffect(() => {
    const on = () => {
        setOnline(true);
        if (!isDemoMode) void refresh();
      },
      off = () => setOnline(false),
      hash = () => {
        setRoute(location.hash.endsWith("/staff") ? "staff" : "public");
        setSelected(null);
      };
    addEventListener("online", on);
    addEventListener("offline", off);
    addEventListener("hashchange", hash);
    return () => {
      removeEventListener("online", on);
      removeEventListener("offline", off);
      removeEventListener("hashchange", hash);
    };
  }, [refresh]);
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
    } = supabase.auth.onAuthStateChange((_e, s) => {
      authChanged = true;
      setStaff(null);
      setSelected(null);
      setDetail(null);
      setAudit([]);
      setAuthLoading(Boolean(s));
      setSession(s);
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
    let live = true;
    if (tab === "audit" && staff?.role === "admin" && !isDemoMode)
      void loadAudit()
        .then((value) => {
          if (live) setAudit(value);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [tab, staff]);
  const category = categories.find((c) => c.id === group)!;
  const results = useMemo(() => {
    const local = leaderboard(teams, attempts, group);
    const merged =
      isDemoMode || !serverResults.length
        ? local
        : local.map((r) => {
            const s = serverResults.find((x) => x.team_id === r.team.id);
            return s
              ? {
                  ...r,
                  primary: s.primary_score,
                  secondary: s.secondary_score,
                  qualified: s.qualified,
                  complete: s.complete,
                  rank: s.rank,
                }
              : r;
          });
    return [...merged].sort((left, right) =>
      compareParticipantNumbers(left.team, right.team),
    );
  }, [teams, attempts, serverResults, group]);
  const visible = results.filter(
    (r) =>
      (route === "staff" || !onlyFavorites || favorites.includes(r.team.id)) &&
      (heatFilter === "all" || r.team.heat === Number(heatFilter)) &&
      (r.team.number + " " + r.team.name)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const inScope = (t: Team) =>
    staff &&
    (staff.role === "admin" ||
      !staff.categoryIds.length ||
      staff.categoryIds.includes(t.categoryId));
  const canScore = staff && (staff.role === "judge" || staff.role === "admin");
  const canCheck =
    staff && (staff.role === "checkin" || staff.role === "admin");
  const canUseWorkspace = Boolean(
    staff && (isDemoMode || (session && !authLoading)),
  );
  async function checkin(t: Team, status: CheckinStatus) {
    setCheckinBusy(t.id);
    setError("");
    try {
      if (status !== "checked_in" && attempts.some((a) => a.teamId === t.id))
        throw new Error("已有成績，不可取消報到；請由主辦人先處理成績");
      await setCheckin(t.id, status);
      setTeams((v) =>
        v.map((x) => (x.id === t.id ? { ...x, checkinStatus: status } : x)),
      );
      setUpdated(new Date());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCheckinBusy(null);
    }
  }
  async function score(input: SaveInput) {
    const saved = await saveAttempt(input);
    const row: Attempt = saved ?? {
      id: input.teamId + "-" + input.slotKey,
      teamId: input.teamId,
      categoryId: input.categoryId,
      slotKey: input.slotKey,
      attemptNo: input.attemptNo,
      status: input.status,
      data: input.data,
      submittedAt: new Date().toISOString(),
      revision: input.expectedRevision + 1,
    };
    setAttempts((v) => [
      ...v.filter(
        (a) => !(a.teamId === row.teamId && a.slotKey === row.slotKey),
      ),
      row,
    ]);
    setUpdated(new Date());
    if (!isDemoMode) void refresh();
    else
      setAudit((v) => [
        {
          id: Date.now(),
          team_number: teams.find((t) => t.id === input.teamId)!.number,
          action: input.expectedRevision ? "score_update" : "score_create",
          reason: input.reason,
          actor_id: "示範管理員",
          created_at: row.submittedAt,
          old_value:
            attempts.find(
              (a) => a.teamId === input.teamId && a.slotKey === input.slotKey,
            ) ?? null,
          new_value: row,
        },
        ...v,
      ]);
  }
  async function importRoster(rows: ImportTeam[]) {
    await importTeams(rows);
    if (isDemoMode)
      setTeams((v) => [
        ...v,
        ...rows.map((r) => ({
          ...r,
          id: crypto.randomUUID(),
          checkinStatus: "pending" as const,
        })),
      ]);
    else await refresh();
  }
  function star(id: string) {
    const next = favorites.includes(id)
      ? favorites.filter((x) => x !== id)
      : [...favorites, id];
    setFavorites(next);
    try {
      localStorage.setItem("ttra-favorites", JSON.stringify(next));
    } catch {
      /* Preferences are optional. */
    }
  }
  function selectCategory(categoryId: CategoryId) {
    setGroup(categoryId);
    setSelected(null);
    setQuery("");
    setHeatFilter("all");
  }
  const stats = categoryStats(teams, attempts, group);
  const statusLabel = !online
    ? "網路中斷"
    : isDemoMode
      ? "示範資料"
      : channel === "SUBSCRIBED"
        ? "即時更新中"
        : "每 10 秒同步";
  return (
    <>
      {isDemoMode && (
        <div className="demo-bar">
          示範模式 · 姓名與成績皆為虛構，重整後重設，尚未連接正式賽事
        </div>
      )}
      <header className="site-header">
        <a className="brand" href="#/challenge">
          <span className="brand-mark">
            <Bot />
          </span>
          <span>
            TTRA<span className="brand-caption">2026 CHALLENGE</span>
          </span>
        </a>
        <div className="header-right">
          <a className="section-link" href="#/exam">
            檢定專區
          </a>
          <span className="header-date">10.04 SUN · 臺中清水高中</span>
          {route === "staff" && (
            <Button
              variant="outline"
              onClick={() => {
                location.hash = "/challenge";
              }}
            >
              家長看成績
              <ArrowUpRight />
            </Button>
          )}
        </div>
      </header>
      <main className="page">
        <section className="page-intro">
          <div>
            <p className="eyebrow">2026 機器人實作技能檢定 暨 挑戰賽</p>
            <h1>{route === "staff" ? "挑戰賽工作台" : "挑戰賽專區"}</h1>
            <p className="muted">
              {route === "staff"
                ? "報到、計分與成績管理"
                : "主題挑戰賽 · 四大組別即時成績"}
            </p>
          </div>
          <span className={"live-pill " + (!online ? "offline" : "")}>
            {online ? <Radio size={15} /> : <WifiOff size={15} />}
            {statusLabel}
          </span>
        </section>
        {error && (
          <div role="alert" className="error-message global-error">
            {error}
            <Button variant="outline" onClick={() => void refresh()}>
              重試
            </Button>
          </div>
        )}
        {!online && (
          <div className="notice">
            目前沒有網路。畫面為上次資料，連線恢復前無法送出成績。
          </div>
        )}
        {route === "staff" && !canUseWorkspace && (
          <section className="panel auth-panel">
            {authLoading ? (
              <p>正在確認權限…</p>
            ) : session ? (
              <>
                <ShieldCheck />
                <h2>尚未取得工作人員權限</h2>
                <p className="muted">
                  已驗證密碼，但尚未授予操作權限，請聯絡主辦人。
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
            ) : (
              <Login />
            )}
          </section>
        )}
        {(route === "public" || canUseWorkspace) && (
          <>
            <section className="stats">
              <div>
                <Users />
                <span>
                  本組參賽人數
                  <strong>
                    {stats.total.toString().padStart(2, "0")} <small>人</small>
                  </strong>
                </span>
              </div>
              <div>
                <CheckCircle2 />
                <span>
                  本組已報到
                  <strong>
                    {stats.checkedIn} <small>人</small>
                  </strong>
                </span>
              </div>
              <div>
                <Trophy />
                <span>
                  已完成全部回合
                  <strong>
                    {stats.completed} <small>人</small>
                  </strong>
                </span>
              </div>
              <div>
                <Radio />
                <span>
                  本組梯次
                  <strong>
                    {heatNumbers(group).length} <small>梯</small>
                  </strong>
                </span>
              </div>
            </section>
            <p className="stats-caption">
              {category.name} · 統計包含本組所有梯次，不受搜尋或梯次篩選影響。
            </p>
            {route === "staff" && (
              <div className="staff-tabs">
                {canScore && (
                  <Button
                    variant={tab === "score" ? "default" : "outline"}
                    onClick={() => {
                      setTab("score");
                      setSelected(null);
                    }}
                  >
                    <Trophy />
                    裁判計分
                  </Button>
                )}
                {canCheck && (
                  <Button
                    variant={tab === "checkin" ? "default" : "outline"}
                    onClick={() => {
                      setTab("checkin");
                      setSelected(null);
                    }}
                  >
                    <ClipboardCheck />
                    參賽者報到
                  </Button>
                )}
                {staff?.role === "admin" && (
                  <>
                    <Button
                      variant={tab === "import" ? "default" : "outline"}
                      onClick={() => {
                        setTab("import");
                        setSelected(null);
                      }}
                    >
                      <Upload />
                      匯入名單
                    </Button>
                    <Button
                      variant={tab === "audit" ? "default" : "outline"}
                      onClick={() => {
                        setTab("audit");
                        setSelected(null);
                      }}
                    >
                      <History />
                      修改紀錄
                    </Button>
                  </>
                )}
                {!isDemoMode && (
                  <Button
                    variant="ghost"
                    className="logout"
                    onClick={() =>
                      void supabase!.auth.signOut({ scope: "local" })
                    }
                  >
                    <LogOut />
                    登出
                  </Button>
                )}
              </div>
            )}
            {route === "staff" &&
            tab === "import" &&
            staff?.role === "admin" ? (
              <ImportPanel
                key={group}
                teams={teams}
                categoryId={group}
                onCategoryChange={selectCategory}
                onImport={importRoster}
                disabled={!online}
              />
            ) : route === "staff" &&
              tab === "audit" &&
              staff?.role === "admin" ? (
              <section className="panel">
                <div className="panel-heading">
                  <h2>成績與報到修改紀錄</h2>
                  <span className="muted">最近 200 筆</span>
                </div>
                {audit.length === 0 ? (
                  <div className="empty-state">尚無修改紀錄</div>
                ) : (
                  audit.map((a) => (
                    <details className="audit-row" key={a.id}>
                      <summary>
                        <strong>{a.team_number}</strong>
                        <span>{a.action}</span>
                        <time>
                          {new Date(a.created_at).toLocaleString("zh-TW")}
                        </time>
                      </summary>
                      <p>
                        {a.reason || "首次登錄"} · {a.actor_id}
                      </p>
                      <pre>
                        {JSON.stringify(
                          { 修改前: a.old_value, 修改後: a.new_value },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  ))
                )}
              </section>
            ) : (
              <>
                <CategoryTabs value={group} onChange={selectCategory} />
                {selected && route === "staff" ? (
                  <>
                    <Button
                      variant="ghost"
                      className="back-button"
                      onClick={() => setSelected(null)}
                    >
                      <ArrowLeft />
                      返回參賽者名單
                    </Button>
                    <ScoreForm
                      key={selected.id}
                      team={teams.find((t) => t.id === selected.id) ?? selected}
                      attempts={attempts}
                      onSave={score}
                      disabled={
                        !online ||
                        !canScore ||
                        !inScope(selected) ||
                        teams.find((t) => t.id === selected.id)
                          ?.checkinStatus !== "checked_in"
                      }
                    />
                  </>
                ) : (
                  <section className="panel">
                    <div className="panel-heading">
                      <div>
                        <p className="eyebrow">
                          {route === "staff"
                            ? tab === "checkin"
                              ? "PARTICIPANT CHECK-IN"
                              : "JUDGE SCORING"
                            : "LIVE RESULTS"}{" "}
                          · {category.subtitle}
                        </p>
                        <h2>{category.name}</h2>
                      </div>
                      <div className="update-controls">
                        <span className="muted">
                          {updated
                            ? "更新於 " +
                              updated.toLocaleTimeString("zh-TW", {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              })
                            : "尚未同步"}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="重新整理成績"
                          disabled={loading}
                          onClick={() => {
                            if (!isDemoMode) void refresh();
                            else setUpdated(new Date());
                          }}
                        >
                          <RefreshCw size={16} />
                        </Button>
                      </div>
                    </div>
                    <div className="toolbar">
                      <div className="search-box">
                        <Search size={17} />
                        <Input
                          aria-label="搜尋參賽者"
                          placeholder="搜尋姓名或參賽編號"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </div>
                      <label className="heat-filter">
                        <span>梯次</span>
                        <NativeSelect
                          aria-label="篩選梯次"
                          value={heatFilter}
                          onChange={(e) => setHeatFilter(e.target.value)}
                        >
                          <option value="all">全部梯次</option>
                          {heatNumbers(group).map((heat) => (
                            <option key={heat} value={heat}>
                              第 {heat} 梯
                            </option>
                          ))}
                        </NativeSelect>
                      </label>
                      {route === "public" ? (
                        <Button
                          variant={onlyFavorites ? "secondary" : "outline"}
                          onClick={() => setOnlyFavorites(!onlyFavorites)}
                        >
                          <Star size={14} />
                          我的關注
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          onClick={() =>
                            downloadCSV(category.name + "-成績.csv", [
                              [
                                "名次",
                                "參賽編號",
                                "姓名",
                                "組別",
                                "梯次",
                                "成績",
                                "合格",
                                "已錄入回合",
                              ],
                              ...results.map((r) => [
                                r.rank,
                                r.team.number,
                                r.team.name,
                                category.name,
                                r.team.heat,
                                r.summary,
                                r.qualified ? "是" : "否",
                                attempts.filter((a) => a.teamId === r.team.id)
                                  .length,
                              ]),
                            ])
                          }
                        >
                          <Download size={14} />
                          匯出
                        </Button>
                      )}
                    </div>
                    <p className="rules-note">{rules[group]}</p>
                    <p className="rules-note">
                      {group === "preschool"
                        ? "依梯次分區，本組不排名。"
                        : "依梯次分區；顯示的名次是同組所有梯次合併計算的總排名。"}
                    </p>
                    {loading ? (
                      <div className="empty-state">正在取得成績…</div>
                    ) : visible.length === 0 ? (
                      <div className="empty-state">
                        <Search />
                        <h3>
                          {stats.total
                            ? "找不到符合的參賽者"
                            : "參賽者名單尚未公布"}
                        </h3>
                        <p className="muted">
                          {stats.total
                            ? "試試其他關鍵字，或取消關注篩選。"
                            : "請稍後再回來查看。"}
                        </p>
                      </div>
                    ) : (
                      <div className="score-list">
                        {heatNumbers(group)
                          .filter(
                            (heat) =>
                              heatFilter === "all" ||
                              heat === Number(heatFilter),
                          )
                          .map((heat) => (
                            <section
                              key={heat}
                              className="heat-section"
                              aria-label={"第 " + heat + " 梯名單"}
                            >
                              <div className="heat-heading">
                                <h3>第 {heat} 梯</h3>
                                <span>
                                  {
                                    visible.filter((r) => r.team.heat === heat)
                                      .length
                                  }{" "}
                                  人
                                  {group !== "preschool" &&
                                    " · 名次為全組總排名"}
                                </span>
                              </div>
                              {!visible.some((r) => r.team.heat === heat) && (
                                <p className="heat-empty">
                                  本梯次沒有符合的參賽者。
                                </p>
                              )}
                              {visible
                                .filter((r) => r.team.heat === heat)
                                .map((r) => (
                                  <div className="score-row" key={r.team.id}>
                                    <strong className="rank">
                                      {group === "preschool"
                                        ? "—"
                                        : r.rank
                                          ? String(r.rank).padStart(2, "0")
                                          : "—"}
                                    </strong>
                                    <button
                                      className="team-cell"
                                      onClick={() => setDetail(r.team)}
                                    >
                                      <strong>{r.team.name}</strong>
                                      <small>
                                        #{r.team.number} · 第 {r.team.heat} 梯
                                      </small>
                                    </button>
                                    {route === "staff" &&
                                    (tab === "checkin" ||
                                      staff?.role === "checkin") ? (
                                      <>
                                        <span
                                          className={
                                            "tag " +
                                            (r.team.checkinStatus ===
                                            "checked_in"
                                              ? "success-tag"
                                              : "")
                                          }
                                        >
                                          {checkinLabels[r.team.checkinStatus]}
                                        </span>
                                        <NativeSelect
                                          aria-label={r.team.name + " 報到狀態"}
                                          disabled={
                                            !online ||
                                            checkinBusy === r.team.id ||
                                            !canCheck ||
                                            !inScope(r.team)
                                          }
                                          value={r.team.checkinStatus}
                                          onChange={(e) =>
                                            void checkin(
                                              r.team,
                                              e.target.value as CheckinStatus,
                                            )
                                          }
                                        >
                                          {Object.entries(checkinLabels).map(
                                            ([k, v]) => (
                                              <option key={k} value={k}>
                                                {v}
                                              </option>
                                            ),
                                          )}
                                        </NativeSelect>
                                      </>
                                    ) : (
                                      <>
                                        <div className="result-status">
                                          <span
                                            className={
                                              r.qualified
                                                ? "success-tag"
                                                : "tag"
                                            }
                                          >
                                            {r.qualified
                                              ? "挑戰成功"
                                              : r.primary === null
                                                ? attempts.some(
                                                    (a) =>
                                                      a.teamId === r.team.id,
                                                  )
                                                  ? "尚無有效總成績"
                                                  : "尚未出場"
                                                : "目前未達合格"}
                                          </span>
                                          <small>
                                            {
                                              attempts.filter(
                                                (a) => a.teamId === r.team.id,
                                              ).length
                                            }
                                            /{slotOptions(group).length} 回合
                                          </small>
                                        </div>
                                        <div className="result-numbers">
                                          <strong className="score-number">
                                            {r.primary === null
                                              ? "—"
                                              : group === "program"
                                                ? r.primary.toFixed(1)
                                                : r.primary}
                                            <small>
                                              {group === "preschool"
                                                ? "球"
                                                : group === "power"
                                                  ? "瓶"
                                                  : group === "program"
                                                    ? "秒"
                                                    : "分"}
                                            </small>
                                          </strong>
                                          {r.secondary !== null && (
                                            <small>
                                              {r.secondary.toFixed(1)}{" "}
                                              {group === "program" ? "g" : "秒"}
                                            </small>
                                          )}
                                        </div>
                                        {route === "staff" ? (
                                          <Button
                                            variant="outline"
                                            disabled={
                                              !canScore ||
                                              !inScope(r.team) ||
                                              r.team.checkinStatus !==
                                                "checked_in"
                                            }
                                            onClick={() => setSelected(r.team)}
                                          >
                                            {r.team.checkinStatus ===
                                            "checked_in"
                                              ? "計分"
                                              : "未報到"}
                                            <ChevronRight size={14} />
                                          </Button>
                                        ) : (
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            aria-label={
                                              (favorites.includes(r.team.id)
                                                ? "取消關注"
                                                : "關注") + r.team.name
                                            }
                                            onClick={() => star(r.team.id)}
                                          >
                                            <Star
                                              size={17}
                                              fill={
                                                favorites.includes(r.team.id)
                                                  ? "#adc563"
                                                  : "none"
                                              }
                                            />
                                          </Button>
                                        )}
                                      </>
                                    )}
                                  </div>
                                ))}
                            </section>
                          ))}
                      </div>
                    )}
                  </section>
                )}
              </>
            )}
          </>
        )}
        <footer>
          <span>台灣青少年機器人協會 TTRA</span>
          <span>
            {isDemoMode
              ? "示範內容，非正式成績"
              : "暫定排名 · 官方成績以大會最終裁定為準"}
          </span>
        </footer>
      </main>
      <Dialog
        open={Boolean(detail)}
        onOpenChange={(v) => {
          if (!v) setDetail(null);
        }}
      >
        <DialogContent className="team-dialog">
          <DialogTitle>
            {detail?.name} · #{detail?.number}
          </DialogTitle>
          <DialogDescription>
            {detail && categories.find((c) => c.id === detail.categoryId)?.name}{" "}
            · 第 {detail?.heat} 梯 ·{" "}
            {detail && checkinLabels[detail.checkinStatus]}
          </DialogDescription>
          {detail && (
            <>
              <strong>{teamResult(detail, attempts).summary}</strong>
              {slotOptions(detail.categoryId).map(([key, label]) => {
                const a = attempts.find(
                  (a) => a.teamId === detail.id && a.slotKey === key,
                );
                return (
                  <div className="detail-attempt" key={key}>
                    <strong>{label}</strong>
                    <span>{a ? attemptSummary(a) : "尚未登錄"}</span>
                    {a && (
                      <small>
                        版本 {a.revision ?? 1} ·{" "}
                        {new Date(a.submittedAt).toLocaleTimeString("zh-TW")}
                      </small>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
export function Login() {
  const [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (!supabase) throw new Error("正式連線尚未設定");
      const { error } = await supabase.auth.signInWithPassword({
        email: STAFF_LOGIN_ID,
        password,
      });
      if (error) {
        setError(
          error.status === 429
            ? "嘗試次數過多，請稍候再試。"
            : "登入失敗，請確認工作人員密碼與網路連線；若仍無法登入，請聯絡主辦人。",
        );
      }
    } catch {
      setError("暫時無法登入，請確認網路連線或聯絡主辦人。");
    } finally {
      setPassword("");
      setBusy(false);
    }
  }
  return (
    <>
      <ShieldCheck size={30} />
      <h2>工作人員登入</h2>
      <p className="muted">
        請輸入主辦人提供的共用密碼。家長查看成績不需登入。
      </p>
      <form onSubmit={send}>
        <label className="field">
          <span>工作人員密碼</span>
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={busy}
            placeholder="輸入工作人員密碼"
          />
        </label>
        <Button type="submit" className="primary-action" disabled={busy}>
          {busy ? "驗證中…" : "登入工作台"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </>
  );
}
