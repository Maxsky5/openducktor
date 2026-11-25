import { describe, expect, test } from "bun:test";
import { cssTimeMs } from "./css-time";

describe("cssTimeMs", () => {
  test("reads milliseconds and the seconds of a minified value", () => {
    expect(cssTimeMs("300ms")).toBe(300);
    expect(cssTimeMs(" .3s")).toBe(300);
    expect(cssTimeMs("0.15s")).toBe(150);
  });
});
