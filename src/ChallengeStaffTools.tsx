import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "./supabase";
import { academicRequest } from "./academic-request";
import { categories, heatNumbers, type CategoryId, type Team } from "./domain";

async function rpc<T>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!supabase) throw new Error("正式連線尚未設定");
  const { data, error } = await academicRequest((signal) =>
    supabase!.rpc(name, args).abortSignal(signal),
  );
  if (error) throw error;
  return data as T;
}
type Claim = { team_id: string; claimed: boolean; revision: number };
export function useDrinkClaims(accessKey: string | null) {
  const [claims, setClaims] = useState<Record<string, Claim>>({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const generation = useRef(0);
  const locks = useRef(new Set<string>());
  const refresh = useCallback(async () => {
    if (!accessKey) return;
    const current = generation.current;
    try {
      const values = await rpc<Claim[]>("get_drink_claims");
      if (current !== generation.current) return;
      setClaims((old) => {
        const next = { ...old };
        for (const claim of values)
          if (
            !next[claim.team_id] ||
            next[claim.team_id].revision <= claim.revision
          )
            next[claim.team_id] = claim;
        return next;
      });
      setReady(true);
      setError("");
    } catch (e) {
      if (current === generation.current)
        setError("飲料紀錄同步失敗：" + (e as Error).message);
    }
  }, [accessKey]);
  useEffect(() => {
    generation.current += 1;
    setClaims({});
    setReady(false);
    setError("");
    setBusy({});
    setRowErrors({});
    locks.current.clear();
    if (!accessKey) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 10000);
    return () => {
      generation.current += 1;
      clearInterval(timer);
    };
  }, [accessKey, refresh]);
  async function change(teamId: string, claimed: boolean) {
    if (!accessKey || !ready || locks.current.has(teamId)) return;
    const current = generation.current;
    locks.current.add(teamId);
    setBusy((v) => ({ ...v, [teamId]: true }));
    setRowErrors((v) => ({ ...v, [teamId]: "" }));
    try {
      const saved = await rpc<Claim>("set_drink_claim", {
        p_team_id: teamId,
        p_claimed: claimed,
        p_expected_revision: claims[teamId]?.revision ?? 0,
      });
      if (current === generation.current)
        setClaims((v) => ({
          ...v,
          [teamId]:
            !v[teamId] || saved.revision >= v[teamId].revision
              ? saved
              : v[teamId],
        }));
    } catch (e) {
      if (current === generation.current) {
        setRowErrors((v) => ({
          ...v,
          [teamId]: "未確認儲存結果，請核對後重試：" + (e as Error).message,
        }));
        await refresh();
      }
    } finally {
      if (current === generation.current) {
        locks.current.delete(teamId);
        setBusy((v) => ({ ...v, [teamId]: false }));
      }
    }
  }
  return { claims, ready, error, busy, rowErrors, change, refresh };
}
export function DrinkControl({
  team,
  state,
  disabled,
}: {
  team: Team;
  state: ReturnType<typeof useDrinkClaims>;
  disabled: boolean;
}) {
  return (
    <div className="drink-control">
      <label>
        <span>飲料</span>
        <span>
          <input
            type="checkbox"
            aria-label={`${team.number} ${team.name} 飲料已領取`}
            checked={state.claims[team.id]?.claimed ?? false}
            disabled={disabled || !state.ready || state.busy[team.id]}
            onChange={(e) => void state.change(team.id, e.target.checked)}
          />{" "}
          已領取
        </span>
      </label>
      {state.busy[team.id] && <small role="status">儲存中…</small>}
      {state.rowErrors[team.id] && (
        <small className="error-message" role="alert">
          {state.rowErrors[team.id]}
        </small>
      )}
    </div>
  );
}

type Setting = {
  category_id: CategoryId;
  heat: number;
  quota: number | null;
  revision: number;
  published_at: string | null;
};
type AwardPreview = {
  version: number;
  settings_revision: number;
  quota: number;
  groups?: {
    category_id: CategoryId;
    heat: number;
    quota: number;
    entries: AwardPreview["entries"];
  }[];
  entries: {
    category_id?: CategoryId;
    heat?: number;
    team_id: string;
    number: string;
    name: string;
    rank: number;
    primary_score: number;
    secondary_score: number | null;
    qualified: boolean;
    complete: boolean;
  }[];
};
export function AwardPanel({
  categoryId,
  disabled,
  onPublished,
}: {
  categoryId: CategoryId;
  disabled: boolean;
  onPublished: () => Promise<void>;
}) {
  const [heat, setHeat] = useState(1);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [quota, setQuota] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<AwardPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const requestId = useRef("");
  const blockedPreview =
    !preview?.entries.length ||
    (preview.groups ?? [preview]).some(
      (g) => !g.entries.length || g.entries.length > g.quota,
    );
  const setting = settings.find(
    (s) => s.category_id === categoryId && s.heat === heat,
  );
  const reload = useCallback(
    async () => setSettings(await rpc<Setting[]>("get_award_settings")),
    [],
  );
  useEffect(() => {
    let live = true;
    void rpc<Setting[]>("get_award_settings")
      .then((v) => {
        if (live) setSettings(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    setQuota(setting?.quota?.toString() ?? "");
    setPreview(null);
    setConfirmed(false);
    setMessage("");
  }, [setting?.quota, setting?.revision, heat]);
  async function action(operation: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await operation();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (categoryId === "preschool")
    return (
      <section className="panel form-body">
        <h2>幼兒組不排名</h2>
        <p>本組只顯示進球數與挑戰狀態，不公告獎狀名次。</p>
      </section>
    );
  return (
    <section className="panel form-panel">
      <div className="panel-heading">
        <div>
          <h2>官方獎狀名次公告</h2>
          <p className="muted">
            {categories.find((c) => c.id === categoryId)?.name} · 各梯次獨立排名
          </p>
        </div>
      </div>
      <div className="form-body">
        <p>
          瓶數、秒數照常即時公開。只有此處確認公布的得獎名次會顯示在家長端；公布後不會隨登分自動變動。
        </p>
        <div className="field-grid">
          <label className="field">
            <span>公告梯次</span>
            <NativeSelect
              aria-label="公告梯次"
              value={heat}
              disabled={busy}
              onChange={(e) => {
                setHeat(Number(e.target.value));
                setError("");
              }}
            >
              {heatNumbers(categoryId).map((n) => (
                <option value={n} key={n}>
                  第 {n} 梯
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="field">
            <span>官方確認的獎狀名額</span>
            <Input
              type="number"
              min={1}
              max={500}
              step={1}
              value={quota}
              disabled={busy || disabled}
              placeholder="待官方確認"
              onChange={(e) => setQuota(e.target.value)}
            />
          </label>
        </div>
        <p className="hint">
          名額尚未確定請保持空白。同名次超過名額時系統會阻止公告，請先取得官方裁定。
        </p>
        <p>
          {setting?.published_at
            ? `本梯已公告：${new Date(setting.published_at).toLocaleString("zh-TW")}；更正後需再次預覽公布。`
            : "本梯尚未公告名次"}
        </p>
        <div className="award-actions">
          <Button
            variant="outline"
            disabled={disabled || busy}
            onClick={() => void action(reload)}
          >
            重新載入
          </Button>
          <Button
            variant="outline"
            disabled={
              disabled ||
              busy ||
              !setting ||
              !Number.isInteger(Number(quota)) ||
              Number(quota) < 1 ||
              Number(quota) > 500
            }
            onClick={() =>
              void action(async () => {
                await rpc("set_award_quota", {
                  p_category: categoryId,
                  p_heat: heat,
                  p_quota: Number(quota),
                  p_expected_revision: setting!.revision,
                });
                await reload();
                setMessage("名額已儲存，尚未公告。");
              })
            }
          >
            儲存名額
          </Button>
          <Button
            disabled={
              disabled ||
              busy ||
              !setting?.quota ||
              String(setting.quota) !== quota
            }
            onClick={() =>
              void action(async () => {
                const data = await rpc<AwardPreview>("preview_awards", {
                  p_category: categoryId,
                  p_heat: heat,
                });
                setPreview(data);
                setConfirmed(false);
                requestId.current = crypto.randomUUID();
              })
            }
          >
            預覽公告名單
          </Button>
          <Button
            variant="outline"
            disabled={
              disabled ||
              busy ||
              !settings.length ||
              (setting?.quota !== null &&
                String(setting?.quota ?? "") !== quota)
            }
            onClick={() =>
              void action(async () => {
                const all = await rpc<{
                  version: number;
                  groups: NonNullable<AwardPreview["groups"]>;
                }>("preview_all_awards");
                setPreview({
                  version: all.version,
                  settings_revision: 0,
                  quota: all.groups.reduce((sum, g) => sum + g.quota, 0),
                  groups: all.groups,
                  entries: all.groups.flatMap((g) =>
                    g.entries.map((e) => ({
                      ...e,
                      category_id: g.category_id,
                      heat: g.heat,
                    })),
                  ),
                });
                setConfirmed(false);
                requestId.current = crypto.randomUUID();
              })
            }
          >
            預覽全賽事統一公告
          </Button>
        </div>
        <p className="hint">
          統一公告會一次處理所有已有名單的排名梯次。請先儲存各梯次名額；幼兒不列入。
        </p>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="success-message" role="status">
            {message}
          </p>
        )}
      </div>
      <Dialog
        open={Boolean(preview)}
        onOpenChange={(v) => {
          if (!v && !busy) setPreview(null);
        }}
      >
        <DialogContent className="award-dialog">
          <DialogTitle>
            {preview?.groups
              ? "確認全賽事統一公告"
              : `確認第 ${heat} 梯得獎名次`}
          </DialogTitle>
          <DialogDescription>
            請確認官方已核定名額、同名次及合格資格。這不是即時暫定排名，按公布後家長就會看到以下名次。
          </DialogDescription>
          <p>
            名額 {preview?.quota} 人 · 本次公告 {preview?.entries.length} 人
          </p>
          {preview?.groups?.map((g) => (
            <small key={`${g.category_id}-${g.heat}`}>
              {categories.find((c) => c.id === g.category_id)?.name} · 第{" "}
              {g.heat} 梯：名額 {g.quota} 人，公告 {g.entries.length} 人
            </small>
          ))}
          <div className="award-preview">
            {preview?.entries.map((entry) => (
              <div key={entry.team_id}>
                <strong>
                  第 {entry.rank} 名 · {entry.number} {entry.name}
                </strong>
                <span>
                  {entry.primary_score}{" "}
                  {(entry.category_id ?? categoryId) === "program"
                    ? "秒"
                    : (entry.category_id ?? categoryId) === "power"
                      ? "瓶"
                      : "分"}
                  {entry.secondary_score !== null
                    ? ` · ${entry.secondary_score} ${(entry.category_id ?? categoryId) === "program" ? "g" : "秒"}`
                    : ""}
                  {!entry.qualified && " · 未達合格標準（請核對獎狀資格）"}
                  {!entry.complete && " · 尚有回合未登錄"}
                </span>
              </div>
            ))}
          </div>
          {preview &&
            (preview.groups ?? [preview]).some(
              (g) => g.entries.length > g.quota,
            ) && (
              <p role="alert" className="error-message">
                同名次超過名額，請先由官方確認名額後再公布。
              </p>
            )}
          {preview &&
            (preview.groups ?? [preview]).some((g) => !g.entries.length) && (
              <p>有梯次尚無可公布的有效成績，不能公告。</p>
            )}
          <label className="award-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            已取得官方確認，以上名次及獎狀資格正確
          </label>
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              返回檢查
            </Button>
            <Button
              disabled={disabled || busy || !confirmed || blockedPreview}
              onClick={() =>
                void action(async () => {
                  if (preview!.groups)
                    await rpc("publish_all_awards", {
                      p_version: preview!.version,
                      p_request_id: requestId.current,
                    });
                  else
                    await rpc("publish_awards", {
                      p_category: categoryId,
                      p_heat: heat,
                      p_version: preview!.version,
                      p_settings_revision: preview!.settings_revision,
                      p_request_id: requestId.current,
                    });
                  setPreview(null);
                  await reload();
                  await onPublished();
                  setMessage("得獎名次已公告。");
                })
              }
            >
              {busy
                ? "處理中…"
                : preview?.groups
                  ? "確認統一公布名次"
                  : "確認公布本梯名次"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
