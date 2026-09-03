const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const mode = process.env.DEPLOYMENT_MODE || "production";
if (mode !== "demo" && mode !== "production")
  throw new Error("DEPLOYMENT_MODE must be demo or production.");
if (mode === "demo") {
  if (url || key)
    throw new Error("Demo deployment must not connect to a Supabase project.");
  console.log("Explicit demo deployment: fictional, in-memory data only.");
  process.exit(0);
}
if (!url || !key)
  throw new Error(
    "Missing Supabase URL or publishable key. Refusing to deploy demo mode.",
  );
if (!url.startsWith("https://"))
  throw new Error("Supabase URL must use HTTPS.");
if (!key.startsWith("sb_publishable_"))
  throw new Error("Use a publishable key, never a secret or service-role key.");
console.log("Public connection configuration present; values not printed.");
