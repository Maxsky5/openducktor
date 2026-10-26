import { describe, expect, test } from "bun:test";
import { themeStyleCache } from "./theme-style-cache";

type TestTheme = { tones: Record<"info" | "danger", string> };

const light: TestTheme = { tones: { info: "#0284c7", danger: "#e11d48" } };
const dark: TestTheme = { tones: { info: "#38bdf8", danger: "#fb7185" } };

describe("themeStyleCache", () => {
  const textOf = themeStyleCache((theme: TestTheme, tone: "info" | "danger") => ({
    color: theme.tones[tone],
  }));

  test("keeps one style for each theme and key", () => {
    const info = textOf(light, "info");
    expect(info).toEqual({ color: "#0284c7" });
    expect(textOf(light, "info")).toBe(info);
    expect(textOf(light, "danger")).toEqual({ color: "#e11d48" });
  });

  test("builds the styles of another theme with its colors", () => {
    expect(textOf(dark, "info")).toEqual({ color: "#38bdf8" });
    expect(textOf(dark, "info")).not.toBe(textOf(light, "info"));
  });
});
