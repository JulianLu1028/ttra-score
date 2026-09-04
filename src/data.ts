import type {
  Attempt,
  AttemptStatus,
  CategoryId,
  CheckinStatus,
  Team,
} from "./domain";
import { demoAttempts, demoTeams } from "./demo";
import { isDemoMode, supabase } from "./supabase";
export type ServerResult = {
  team_id: string;
  category_id: CategoryId;
  primary_score: number | null;
  secondary_score: number | null;
  qualified: boolean;
  complete: boolean;
  rank: number | null;
};
export type Staff = {
  role: "admin" | "judge" | "checkin";
  categoryIds: CategoryId[];
  canGradeAcademic?: boolean;
};
export type SaveInput = {
  teamId: string;
  categoryId: CategoryId;
  slotKey: string;
  attemptNo: number;
  status: AttemptStatus;
  reason: string;
  data: Record<string, number | string | boolean>;
  requestId: string;
  expectedRevision: number;
};
export type ImportTeam = {
  number: string;
  name: string;
  heat: number;
  categoryId: CategoryId;
};
export type Audit = {
  id: number;
  team_number: string;
  action: string;
  actor_id: string;
  reason: string;
  created_at: string;
  old_value: unknown;
  new_value: unknown;
};
const mapTeam = (x: any): Team => ({
  id: x.id,
  number: x.team_number,
  name: x.name,
  heat: x.heat,
  categoryId: x.category_id,
  checkinStatus: x.checkin_status === "checked_in" ? "checked_in" : "pending",
  checkedInAt: x.checked_in_at ?? null,
});
export const mapAttempt = (x: any): Attempt => ({
  id: x.id,
  teamId: x.team_id,
  categoryId: x.category_id,
  slotKey: x.slot_key,
  attemptNo: x.attempt_no,
  status: x.status,
  revision: x.revision,
  data: x.score_data,
  submittedAt: x.submitted_at,
});
type Snapshot = {
  teams: Team[];
  attempts: Attempt[];
  results?: ServerResult[];
  audit?: Audit[];
};
let demoSnapshot: Snapshot = {
  teams: isDemoMode ? demoTeams : [],
  attempts: isDemoMode ? demoAttempts : [],
  audit: [],
};
export function readDemoChallenge() {
  return demoSnapshot;
}
export function saveDemoChallenge(
  teams: Team[],
  attempts: Attempt[],
  audit: Audit[],
) {
  if (isDemoMode) demoSnapshot = { teams, attempts, audit };
}
let cached: Snapshot | undefined;
let lastVersion = -1;
let pending: Promise<Snapshot> | null = null;
export function loadData(): Promise<Snapshot> {
  if (isDemoMode) return Promise.resolve(demoSnapshot);
  if (pending) return pending;
  pending = loadRemote().finally(() => {
    pending = null;
  });
  return pending;
}
async function loadRemote(): Promise<Snapshot> {
  const { data, error } = await supabase!.rpc("get_scoreboard", {
    p_version: lastVersion,
  });
  if (error) throw error;
  if (data.unchanged && cached) return cached;
  cached = {
    teams: (data.teams ?? []).map(mapTeam),
    attempts: (data.attempts ?? []).map(mapAttempt),
    results: data.results ?? [],
  };
  lastVersion = data.version;
  return cached;
}
export async function getStaff(): Promise<Staff | null> {
  if (isDemoMode) return { role: "admin", categoryIds: [] };
  if (!supabase) throw new Error("正式連線尚未設定");
  const { data, error } = await supabase.rpc("my_staff_role");
  if (error) throw error;
  return data
    ? {
        role: data.role,
        categoryIds: data.category_ids,
        canGradeAcademic: data.can_grade_academic,
      }
    : null;
}
export async function setCheckin(teamId: string, status: CheckinStatus) {
  if (isDemoMode) return;
  const { error } = await supabase!.rpc("set_checkin", {
    p_team_id: teamId,
    p_status: status,
  });
  if (error) throw error;
}
export async function saveAttempt(input: SaveInput): Promise<Attempt | null> {
  if (isDemoMode) return null;
  const { data, error } = await supabase!.rpc("submit_attempt", {
    p_input: {
      team_id: input.teamId,
      category_id: input.categoryId,
      slot_key: input.slotKey,
      attempt_no: input.attemptNo,
      status: input.status,
      reason: input.reason,
      score_data: input.data,
      request_id: input.requestId,
      expected_revision: input.expectedRevision,
    },
  });
  if (error) throw error;
  return mapAttempt(data);
}
export async function importTeams(rows: ImportTeam[]) {
  if (isDemoMode) return;
  if (!supabase) throw new Error("正式連線尚未設定");
  const { error } = await supabase.rpc("import_teams", {
    p_rows: rows.map((r) => ({
      team_number: r.number,
      name: r.name,
      heat: r.heat,
      category_id: r.categoryId,
    })),
  });
  if (error) throw error;
}
export async function loadAudit(): Promise<Audit[]> {
  if (isDemoMode) return [];
  if (!supabase) throw new Error("正式連線尚未設定");
  const { data, error } = await supabase.rpc("read_audit");
  if (error) throw error;
  return data ?? [];
}
export function subscribe(
  onChange: () => void,
  onStatus: (status: string) => void,
) {
  const client = supabase;
  if (!client) return () => {};
  const c = client
    .channel("score-live")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "event_state" },
      onChange,
    )
    .subscribe(onStatus);
  return () => {
    void client.removeChannel(c);
  };
}
