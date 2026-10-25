import { describe, expect, test } from "bun:test";
import { formatTokenCompact, formatTokenExact } from "./format-token-count";

describe("formatTokenCompact", () => {
  test("returns null for missing or invalid values", () => {
    expect(formatTokenCompact(undefined)).toBeNull();
    expect(formatTokenCompact(null)).toBeNull();
    expect(formatTokenCompact(0)).toBeNull();
    expect(formatTokenCompact(-1)).toBeNull();
    expect(formatTokenCompact(Number.NaN)).toBeNull();
  });

  test("formats small values as raw integers", () => {
    expect(formatTokenCompact(1)).toBe("1");
    expect(formatTokenCompact(999)).toBe("999");
  });

  test("formats thousand values compactly", () => {
    expect(formatTokenCompact(1_000)).toBe("1K");
    expect(formatTokenCompact(2_500)).toBe("2.5K");
    expect(formatTokenCompact(128_000)).toBe("128K");
    expect(formatTokenCompact(200_000)).toBe("200K");
  });

  test("promotes rounded thousands to the million suffix", () => {
    expect(formatTokenCompact(999_499)).toBe("999K");
    expect(formatTokenCompact(999_500)).toBe("1M");
    expect(formatTokenCompact(999_999)).toBe("1M");
  });

  test("formats million values compactly", () => {
    expect(formatTokenCompact(1_000_000)).toBe("1M");
    expect(formatTokenCompact(1_500_000)).toBe("1.5M");
    expect(formatTokenCompact(10_000_000)).toBe("10M");
  });
});

describe("formatTokenExact", () => {
  test("returns null for missing or negative values", () => {
    expect(formatTokenExact(undefined)).toBeNull();
    expect(formatTokenExact(null)).toBeNull();
    expect(formatTokenExact(-1)).toBeNull();
  });

  test("formats values with thousands separators", () => {
    expect(formatTokenExact(0)).toBe("0");
    expect(formatTokenExact(1_234)).toBe("1,234");
    expect(formatTokenExact(1_000_000)).toBe("1,000,000");
  });
});
