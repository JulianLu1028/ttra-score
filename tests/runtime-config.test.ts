import { describe, it, expect } from "vitest";
import { runtimeConfig, staffAuthPassword } from "../src/runtime-config";

describe("staff PIN compatibility", () => {
  it("converts a four-digit PIN to the Supabase technical password", () => {
    expect(staffAuthPassword(" 1234 ")).toBe("Ttra!1234");
  });
  it("keeps the existing password usable during migration", () => {
    expect(staffAuthPassword("existing-long-password")).toBe(
      "existing-long-password",
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
