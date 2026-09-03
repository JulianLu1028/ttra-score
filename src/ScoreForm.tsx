import { useRef, useState } from "react";
import { Check, Save, AlertTriangle } from "./icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  categories,
  creativeScore,
  slotOptions,
  validateScore,
  normalizeScore,
  type Team,
  type Attempt,
  type AttemptStatus,
} from "./domain";
import type { SaveInput } from "./data";
export function ScoreForm({
  team,
  attempts,
  onSave,
  disabled,
}: {
  team: Team;
  attempts: Attempt[];
  onSave: (v: SaveInput) => Promise<void>;
  disabled: boolean;
}) {
  const slots = slotOptions(team.categoryId);
  const [slot, setSlot] = useState(slots[0][0]);
  const existing = attempts.find(
    (a) => a.teamId === team.id && a.slotKey === slot,
  );
  const [data, setData] = useState<Record<string, number | string | boolean>>(
    existing?.data ?? initial(team.categoryId, attempts, team.id),
  );
  const [status, setStatus] = useState<AttemptStatus>(
    existing?.status ?? "valid",
  );
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [success, setSuccess] = useState("");
  const expectedRevision = useRef(existing?.revision ?? (existing ? 1 : 0));
  const request = useRef<{ signature: string; id: string } | null>(null);
  function selectSlot(value: string) {
    setSlot(value);
    const old = attempts.find(
      (a) => a.teamId === team.id && a.slotKey === value,
    );
    setData(old?.data ?? initial(team.categoryId, attempts, team.id));
    setStatus(old?.status ?? "valid");
    expectedRevision.current = old?.revision ?? (old ? 1 : 0);
    setReason("");
    setError("");
    setSuccess("");
    request.current = null;
  }
  function numeric(
    key: string,
    label: string,
    min: number,
    max: number,
    step = 1,
  ) {
    return (
      <label className="field" key={key}>
        <span>{label}</span>
        <Input
          aria-label={label}
          type="number"
          min={min}
          max={max}
          step={step}
          inputMode={step === 1 ? "numeric" : "decimal"}
          value={data[key] === undefined ? "" : String(data[key])}
          required
          onChange={(e) => {
            setSuccess("");
            setData({
              ...data,
              [key]: e.target.value === "" ? "" : Number(e.target.value),
            });
          }}
        />
      </label>
    );
  }
  const validStatus = status !== "invalid";
  function prepare() {
    const e = validateScore(team.categoryId, status, data, reason);
    if (e) {
      setError(e);
      return;
    }
    if (existing && !reason.trim()) {
      setError("修改既有成績必須填寫原因");
      return;
    }
    setError("");
    setConfirm(true);
  }
  async function submit() {
    setBusy(true);
    setError("");
    try {
      const clean = normalizeScore(status, data);
      const signature = JSON.stringify({
        team: team.id,
        slot,
        status,
        data: clean,
        reason,
        revision: expectedRevision.current,
      });
      if (request.current?.signature !== signature)
        request.current = { signature, id: crypto.randomUUID() };
      await onSave({
        teamId: team.id,
        categoryId: team.categoryId,
        slotKey: slot,
        attemptNo: slots.findIndex((s) => s[0] === slot) + 1,
        status,
        reason,
        data: clean,
        requestId: request.current.id,
        expectedRevision: expectedRevision.current,
      });
      expectedRevision.current += 1;
      setData(clean);
      setSuccess("成績已儲存並公開");
      setReason("");
      setConfirm(false);
      request.current = null;
    } catch (e) {
      setError((e as Error).message || "送出失敗，請重試；內容仍保留");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel form-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">
            {team.number} · 第 {team.heat} 梯 ·{" "}
            {categories.find((c) => c.id === team.categoryId)?.subtitle}
          </p>
          <h2>{team.name}</h2>
        </div>
        <span className="live-pill">裁判計分</span>
      </div>
      <div className="form-body">
        <div className="attempt-tabs">
          {slots.map(([key, label]) => (
            <Button
              key={key}
              variant={slot === key ? "default" : "outline"}
              onClick={() => selectSlot(key)}
            >
              {label}
              {attempts.some(
                (a) => a.teamId === team.id && a.slotKey === key,
              ) && <Check size={13} />}
            </Button>
          ))}
        </div>
        <label className="field">
          <span>回合狀態</span>
          <NativeSelect
            aria-label="回合狀態"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as AttemptStatus);
              setSuccess("");
            }}
          >
            <option value="valid">正常完成</option>
            {team.categoryId === "creative" && (
              <option value="terminated">提前終止，保留當下分數</option>
            )}
            <option value="invalid">本回合無效／未完成</option>
          </NativeSelect>
        </label>
        {validStatus && (
          <div className="field-grid">
            {team.categoryId === "preschool" && (
              <>
                {numeric("childGoals", "小朋友進球數", 0, 4)}
                {numeric("parentGoals", "家長進球數", 0, 2)}
              </>
            )}
            {team.categoryId === "power" && (
              <>
                {numeric("bottles", "載重瓶數", 0, 999)}
                {numeric("seconds", "完成時間（秒）", 0.1, 30, 0.1)}
              </>
            )}
            {team.categoryId === "program" && (
              <>
                {numeric("seconds", "完成時間（秒）", 0.1, 40, 0.1)}
                {numeric("weight", "車頭淨重（g，無板車）", 0.1, 100000, 0.1)}
              </>
            )}
            {team.categoryId === "creative" && (
              <>
                {numeric("regular", "普通瓶得分數量", 0, 8)}
                {numeric("seconds", "達到最終分數的耗時（秒）", 0, 40, 0.1)}
                {["red", "blue"].map((color) => (
                  <label className="field" key={color}>
                    <span>{color === "red" ? "紅色" : "藍色"}特殊瓶</span>
                    <NativeSelect
                      aria-label={color === "red" ? "紅色特殊瓶" : "藍色特殊瓶"}
                      value={String(data[color] ?? "none")}
                      onChange={(e) =>
                        setData({ ...data, [color]: e.target.value })
                      }
                    >
                      <option value="none">未得分 · 0 分</option>
                      <option value="correct">正確區域 · 20 分</option>
                      <option value="wrong">錯誤區域 · 5 分</option>
                    </NativeSelect>
                  </label>
                ))}
              </>
            )}
          </div>
        )}
        {team.categoryId === "creative" && validStatus && (
          <p className="hint">
            每次限時 40 秒，時間到保留當下得分並填入 40.0
            秒。提前結束記錄實際耗時；仍由現場計時，網站不自動計時或送分。
          </p>
        )}
        {team.categoryId === "creative" && validStatus && (
          <div className="calculated">
            本回合自動計分{" "}
            <strong>
              {creativeScore({ data } as Attempt)} <small>分</small>
            </strong>
          </div>
        )}
        {team.categoryId === "preschool" && validStatus && (
          <div className="calculated">
            本回合進球總數{" "}
            <strong>
              {Number(data.childGoals ?? 0) + Number(data.parentGoals ?? 0)}{" "}
              <small>球</small>
            </strong>
          </div>
        )}
        {team.categoryId === "program" && validStatus && (
          <p className="hint">
            正常完成代表已自主折返回到起點。20 秒內合格，超過 40
            秒請選「無效／未完成」。重量應使用賽前同一次量測值。
          </p>
        )}
        {team.categoryId === "power" && validStatus && (
          <p className="hint">任何一瓶掉落或逾時，本回合均不計載重與秒數。</p>
        )}
        <label className="field">
          <span>
            {status === "terminated"
              ? "終止原因"
              : existing
                ? "修改原因（必填）"
                : "原因／備註（內部）"}
          </span>
          <Textarea
            aria-label="原因"
            placeholder={
              status === "terminated"
                ? "例如：車體掉落、零件脫落、翻覆"
                : existing
                  ? "請說明修正原因"
                  : "無效回合必須填寫原因"
            }
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {existing && (
          <p className="hint">
            <AlertTriangle size={14} />{" "}
            此回合已有成績，修改會立即更新排名，舊版本將保留。
          </p>
        )}
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        {success && (
          <p className="success-message" role="status">
            {success}
          </p>
        )}
        <Button
          className="primary-action"
          disabled={disabled || busy}
          onClick={prepare}
        >
          <Save size={16} />
          {disabled
            ? "目前無法送出"
            : existing
              ? "確認修改成績"
              : "確認並發布成績"}
        </Button>
      </div>
      <Dialog
        open={confirm}
        onOpenChange={(v) => {
          if (!busy) setConfirm(v);
        }}
      >
        <DialogContent>
          <DialogTitle>確認公開成績？</DialogTitle>
          <DialogDescription>
            {team.number} {team.name} · {slots.find((s) => s[0] === slot)?.[1]}
            。送出後家長會立即看到本次成績。
          </DialogDescription>
          <div className="confirm-data">
            {status === "invalid"
              ? "本回合無效"
              : Object.entries(data)
                  .filter(([k]) => k !== "completed")
                  .map(([k, v]) => (
                    <div key={k}>
                      {
                        (
                          {
                            childGoals: "小朋友進球",
                            parentGoals: "家長進球",
                            bottles: "瓶數",
                            seconds: "秒數",
                            weight: "淨重 g",
                            regular: "普通瓶",
                            red: "紅瓶",
                            blue: "藍瓶",
                          } as Record<string, string>
                        )[k]
                      }
                      ：
                      {(
                        {
                          correct: "正確區域",
                          wrong: "錯誤區域",
                          none: "未得分",
                        } as Record<string, string>
                      )[String(v)] ?? String(v)}
                    </div>
                  ))}
          </div>
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              返回檢查
            </Button>
            <Button disabled={busy || disabled} onClick={submit}>
              {busy ? "正在送出…" : "送出並公開"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
function initial(
  category: Team["categoryId"],
  attempts: Attempt[],
  teamId: string,
): Record<string, number | string | boolean> {
  if (category === "preschool") return { childGoals: 0, parentGoals: 0 };
  if (category === "power") return { bottles: 7, seconds: "" };
  if (category === "program")
    return {
      completed: 1,
      seconds: "",
      weight:
        attempts.find((a) => a.teamId === teamId && a.data.weight)?.data
          .weight ?? "",
    };
  return { regular: 0, red: "none", blue: "none", seconds: "" };
}
