import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MOTION_EASE_OUT } from "./motion";

describe("motion tokens", () => {
  test("keeps the JavaScript ease-out curve equal to the CSS token", () => {
    const motionStyles = readFileSync(new URL("./motion.css", import.meta.url), "utf8");

    expect(motionStyles).toContain(`--motion-ease-out: ${MOTION_EASE_OUT};`);
  });
});
