// This is a shared technical identity, not a secret. The password is verified by
// Supabase Auth and is never stored in source or in a VITE_* variable.
export const STAFF_LOGIN_ID = "staff@ttra-score.invalid";

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
