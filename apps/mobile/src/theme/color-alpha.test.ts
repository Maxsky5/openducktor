import { describe, expect, test } from "bun:test";
import { multiplyAlpha, withAlpha } from "./color-alpha";

describe("withAlpha", () => {
  test("adds the alpha channel to an opaque color", () => {
    expect(withAlpha("#5100ff", 0.25)).toBe("#5100ff40");
    expect(withAlpha("#F1F5F9", 0.7)).toBe("#F1F5F9b3");
    expect(withAlpha("#0a101e", 0)).toBe("#0a101e00");
    expect(withAlpha("#0a101e", 1)).toBe("#0a101eff");
  });

  test("refuses a color that already has an alpha channel", () => {
    expect(() => withAlpha("#5100ff80", 0.5)).toThrow("withAlpha needs a #rrggbb color");
    expect(() => withAlpha("rgba(81, 0, 255, 0.5)", 0.5)).toThrow("Use an opaque color token");
  });

  test("refuses an alpha outside 0 to 1", () => {
    expect(() => withAlpha("#5100ff", 1.5)).toThrow("withAlpha needs an alpha from 0 to 1");
  });
});

describe("multiplyAlpha", () => {
  test("gives an opaque color the opacity", () => {
    expect(multiplyAlpha("#ffffff", 0.4)).toBe("#ffffff66");
  });

  test("keeps the share of the alpha that a color has already", () => {
    expect(multiplyAlpha("#001b3180", 0.4)).toBe("#001b3133");
  });

  test("refuses a color that is not hex", () => {
    expect(() => multiplyAlpha("rgba(0, 0, 0, 0.5)", 0.4)).toThrow("needs a #rrggbb or #rrggbbaa");
  });
});
