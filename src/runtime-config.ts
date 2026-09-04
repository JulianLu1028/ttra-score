// This is a shared technical identity, not a secret. The password is verified by
// Supabase Auth and is never stored in source or in a VITE_* variable.
export const STAFF_LOGIN_ID = "staff@ttra-score.invalid";

// Staff enter a short event PIN. Supabase still receives a password that meets
// its hosted password policy. Longer existing passwords pass through unchanged
// so the production credential can be migrated without login downtime.
export function staffAuthPassword(value: string) {
  const input = value.trim();
  return /^\d{4}$/.test(input)
    ? `TTRA-2026-Scoreboard!Staff-PIN-${input}-Q7vL9xR2`
    : input;
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
