// This is a shared technical identity, not a secret. The password is verified by
// Supabase Auth and is never stored in source or in a VITE_* variable.
export const STAFF_LOGIN_ID = "staff@ttra-score.invalid";

// Staff enter a short event PIN. Supabase still receives a password that meets
// its hosted password policy. Longer existing passwords pass through unchanged
// so the production credential can be migrated without login downtime.
export function staffAuthPassword(value: string) {
  const input = value.trim();
  return /^\d{4}$/.test(input) ? "Ttra!" + input : input;
}

export function staffPinUpdateError(error: unknown) {
  const authError = error as {
    message?: unknown;
    status?: unknown;
    code?: unknown;
  };
  const message =
    typeof authError?.message === "string"
      ? authError.message.replace(/\s+/g, " ").trim()
      : "";
  const status =
    typeof authError?.status === "number" ? authError.status : undefined;

  if (
    /same password|different from (the )?(old|current) password/i.test(message)
  ) {
    return "這組 PIN 已經是目前的 PIN；請直接用它登入。";
  }
  if (/reauth|nonce|recent(ly)? signed in/i.test(message)) {
    return "登入驗證已過期。請登出後用目前的密碼重新登入，再立即變更 PIN。";
  }
  if (status === 429 || /rate limit|too many requests/i.test(message)) {
    return "嘗試次數過多，請稍候幾分鐘再試。";
  }
  if (/weak password|password.*(length|character|strength)/i.test(message)) {
    return "Supabase 拒絕這組 PIN 的密碼格式，請聯絡系統管理員。";
  }

  const code =
    typeof authError?.code === "string" && authError.code
      ? ` / ${authError.code}`
      : "";
  const reference = status
    ? `（${status}${code}）`
    : code
      ? `（${code.slice(3)}）`
      : "";
  return message
    ? `PIN 碼更新失敗${reference}：${message.slice(0, 180)}`
    : "PIN 碼更新失敗，請重新登入後再試。";
}

export function runtimeConfig(mode: string, url = "", key = "") {
  // Fictional records are available only to automated tests, never as a fallback
  // for a development server or a deployed site missing its real configuration.
  const fixture = mode === "test";
  let validUrl = false;
  try {
    validUrl = new URL(url.trim()).protocol === "https:";
  } catch {
    // An unconfigured installation must remain closed.
  }
  return {
    fixture,
    configured:
      !fixture && validUrl && key.trim().startsWith("sb_publishable_"),
  };
}
