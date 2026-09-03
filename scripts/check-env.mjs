const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const mode = process.env.DEPLOYMENT_MODE || "production";
if (mode !== "production")
  throw new Error(
    "Only production deployment is supported. Demo deployment is disabled.",
  );
if (!url || !key)
  throw new Error(
    "Missing Supabase URL or publishable key. Refusing to deploy demo mode.",
  );
if (!url.startsWith("https://"))
  throw new Error("Supabase URL must use HTTPS.");
if (!key.startsWith("sb_publishable_"))
  throw new Error("Use a publishable key, never a secret or service-role key.");
console.log("Public connection configuration present; values not printed.");
