import { describe, it, expect } from "vitest";
import { slugify, isReserved, uniqueSlug } from "./slug";

describe("slugify", () => {
  it("lowercases, strips punctuation, hyphenates", () => {
    expect(slugify("Evergreen Notes!")).toBe("evergreen-notes");
  });
  it("trims leading/trailing hyphens", () => {
    expect(slugify("  —Hello—  ")).toBe("hello");
  });
});

describe("isReserved", () => {
  it("flags reserved words and underscore-prefixed", () => {
    expect(isReserved("login")).toBe(true);
    expect(isReserved("_next")).toBe(true);
    expect(isReserved("evergreen")).toBe(false);
  });
});

describe("uniqueSlug", () => {
  it("appends a counter on collision", () => {
    const taken = new Set(["atomic", "atomic-2"]);
    expect(uniqueSlug("Atomic", (s) => taken.has(s))).toBe("atomic-3");
  });
  it("avoids reserved bases", () => {
    expect(uniqueSlug("login", () => false)).toBe("login-2");
  });
});
