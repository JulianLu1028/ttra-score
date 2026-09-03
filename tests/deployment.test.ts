import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function check(env: Record<string, string>) {
  return spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../scripts/check-env.mjs", import.meta.url))],
    {
      env: {
        ...process.env,
        DEPLOYMENT_MODE: "",
        VITE_SUPABASE_URL: "",
        VITE_SUPABASE_PUBLISHABLE_KEY: "",
        ...env,
      },
      encoding: "utf8",
      timeout: 5000,
    },
  );
}

describe("GitHub Pages deployment guard", () => {
  it("requires production configuration by default", () => {
    expect(check({}).status).toBe(1);
  });
  it("refuses demo deployment even when explicitly selected", () => {
    expect(check({ DEPLOYMENT_MODE: "demo" }).status).toBe(1);
  });
  it("rejects unknown modes", () => {
    expect(check({ DEPLOYMENT_MODE: "preview" }).status).toBe(1);
  });
  it("rejects a database connection in demo mode", () => {
    expect(
      check({
        DEPLOYMENT_MODE: "demo",
        VITE_SUPABASE_URL: "https://example.supabase.co",
      }).status,
    ).toBe(1);
  });
  it("requires both production connection fields", () => {
    expect(
      check({
        DEPLOYMENT_MODE: "production",
        VITE_SUPABASE_URL: "https://example.supabase.co",
      }).status,
    ).toBe(1);
  });
  it("rejects non-publishable credentials", () => {
    expect(
      check({
        VITE_SUPABASE_URL: "https://example.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "not-a-publishable-key",
      }).status,
    ).toBe(1);
  });
  it("rejects non-HTTPS production URLs", () => {
    expect(
      check({
        VITE_SUPABASE_URL: "http://example.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      }).status,
    ).toBe(1);
  });
  it("allows valid production configuration without logging values", () => {
    const result = check({
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    });
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("example.supabase.co");
    expect(result.stdout).not.toContain("sb_publishable_test");
  });
});
