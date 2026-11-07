import { describe, expect, test } from "bun:test";
import { keeperWindowOptions } from "./electron-browser-view-port";

describe("the keeper window of the browser views", () => {
  test("can never take the keyboard focus", () => {
    const options = keeperWindowOptions("darwin");

    expect(options).toMatchObject({
      width: 1,
      height: 1,
      x: 0,
      y: 0,
      show: false,
      frame: false,
      hasShadow: false,
      focusable: false,
    });
  });

  test("stays outside every screen on Linux, which ignores window opacity", () => {
    expect(keeperWindowOptions("linux")).toMatchObject({ x: -1, y: -1 });
  });
});
