import { describe, it, expect } from "vitest";
import {
  runtimeConfig,
  staffAuthPassword,
  staffPinUpdateError,
} from "../src/runtime-config";

describe("staff PIN compatibility", () => {
  it("converts a four-digit PIN to the Supabase technical password", () => {
    expect(staffAuthPassword(" 1234 ")).toBe(
      "TTRA-2026-Scoreboard!Staff-PIN-1234-Q7vL9xR2",
    );
  });
  it("keeps the existing password usable during migration", () => {
    expect(staffAuthPassword("existing-long-password")).toBe(
      "existing-long-password",
    );
  });
  it("explains when the requested PIN is already active", () => {
    expect(
      staffPinUpdateError({
        message: "New password should be different from the old password.",
        status: 422,
      }),
    ).toBe("這組 PIN 已經是目前的 PIN；請直接用它登入。");
  });
  it("explains when Supabase requires a fresh login", () => {
    expect(
      staffPinUpdateError({
        message: "Reauthentication needed",
        status: 403,
      }),
    ).toContain("重新登入");
  });
  it("keeps an unknown Supabase error visible for diagnosis", () => {
    expect(
      staffPinUpdateError({
        message: "Unexpected auth response",
        status: 500,
        code: "unexpected_failure",
      }),
    ).toBe(
      "PIN 碼更新失敗（500 / unexpected_failure）：Unexpected auth response",
    );
  });
});

describe("production-only runtime", () => {
  it.each(["production", "development", "demo"])(
    "%s never falls back to fixtures",
    (mode) => {
      expect(runtimeConfig(mode)).toEqual({
        fixture: false,
        configured: false,
      });
    },
  );
  it("allows fixtures only in automated tests", () => {
    expect(runtimeConfig("test")).toEqual({ fixture: true, configured: false });
  });
  it("does not connect tests to a real database", () => {
    expect(
      runtimeConfig(
        "test",
        "https://example.supabase.co",
        "sb_publishable_test",
      ).configured,
    ).toBe(false);
  });
  it("requires both public connection values", () => {
    expect(
      runtimeConfig("production", "https://example.supabase.co").configured,
    ).toBe(false);
    expect(
      runtimeConfig("production", "", "sb_publishable_test").configured,
    ).toBe(false);
  });
  it("refuses insecure URLs and non-publishable keys", () => {
    expect(
      runtimeConfig(
        "production",
        "http://example.supabase.co",
        "sb_publishable_test",
      ).configured,
    ).toBe(false);
    expect(
      runtimeConfig(
        "production",
        "https://example.supabase.co",
        "not-a-publishable-key",
      ).configured,
    ).toBe(false);
  });
  it("enables a correctly configured production connection", () => {
    expect(
      runtimeConfig(
        "production",
        "https://example.supabase.co",
        "sb_publishable_test",
      ),
    ).toEqual({ fixture: false, configured: true });
  });
});
