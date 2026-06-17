import { describe, expect, it } from "vitest";
import { normalizeBasePath } from "../basePath.shared";

describe("normalizeBasePath", () => {
  it("returns / for empty, undefined, or /", () => {
    expect(normalizeBasePath()).toBe("/");
    expect(normalizeBasePath("")).toBe("/");
    expect(normalizeBasePath("/")).toBe("/");
  });

  it("adds leading and trailing slashes", () => {
    expect(normalizeBasePath("porta")).toBe("/porta/");
    expect(normalizeBasePath("/porta")).toBe("/porta/");
    expect(normalizeBasePath("porta/")).toBe("/porta/");
    expect(normalizeBasePath("/porta/")).toBe("/porta/");
  });

  it("handles deep paths", () => {
    expect(normalizeBasePath("some/deep/path")).toBe("/some/deep/path/");
    expect(normalizeBasePath("/some/deep/path")).toBe("/some/deep/path/");
    expect(normalizeBasePath("/some/deep/path/")).toBe("/some/deep/path/");
  });

  it("trims whitespace", () => {
    expect(normalizeBasePath("  porta  ")).toBe("/porta/");
  });
});
