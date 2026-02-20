import { describe, expect, test } from "bun:test";
import {
  CHAT_AUTOSCROLL_THRESHOLD_PX,
  COMPOSER_TEXTAREA_MAX_HEIGHT_PX,
  COMPOSER_TEXTAREA_MIN_HEIGHT_PX,
  computeComposerTextareaLayout,
  computeTodoPanelBottomOffset,
  isNearBottom,
} from "./use-agent-chat-layout";

describe("use-agent-chat-layout helpers", () => {
  test("detects pinned-to-bottom with threshold", () => {
    const element = {
      scrollHeight: 1_000,
      scrollTop: 1_000 - 400 - CHAT_AUTOSCROLL_THRESHOLD_PX + 1,
      clientHeight: 400,
    };
    expect(isNearBottom(element)).toBe(true);
  });

  test("marks not-pinned when distance exceeds threshold", () => {
    const element = {
      scrollHeight: 1_000,
      scrollTop: 1_000 - 400 - CHAT_AUTOSCROLL_THRESHOLD_PX - 10,
      clientHeight: 400,
    };
    expect(isNearBottom(element)).toBe(false);
  });

  test("clamps textarea layout to minimum height", () => {
    expect(computeComposerTextareaLayout(10)).toEqual({
      heightPx: COMPOSER_TEXTAREA_MIN_HEIGHT_PX,
      overflowY: "hidden",
    });
  });

  test("clamps textarea layout to maximum height and enables overflow", () => {
    expect(computeComposerTextareaLayout(COMPOSER_TEXTAREA_MAX_HEIGHT_PX + 120)).toEqual({
      heightPx: COMPOSER_TEXTAREA_MAX_HEIGHT_PX,
      overflowY: "auto",
    });
  });

  test("computes todo panel bottom offset from composer height with minimum", () => {
    expect(computeTodoPanelBottomOffset(40)).toBe(120);
    expect(computeTodoPanelBottomOffset(180)).toBe(192);
  });
});
