import { describe, it, expect } from "vitest";
import { formatEdited } from "./format";

describe("formatEdited", () => {
  it("formats an ISO date as 'Mon D, YYYY'", () => {
    expect(formatEdited("2026-06-25T15:00:00Z")).toMatch(/Jun 25, 2026/);
  });
  it("returns empty string for null", () => {
    expect(formatEdited(null)).toBe("");
  });
});
