import { describe, expect, test } from "bun:test";
import { POPOVER_EDGE, POPOVER_GAP, placePopover } from "./popover-placement";

const screen = { width: 400, height: 800 };
const insets = { top: 50, bottom: 30 };
const card = { width: 248, height: 200 };
/** The lowest card bottom and the highest card top on this screen. */
const lowest = screen.height - insets.bottom - POPOVER_EDGE;
const highest = insets.top + POPOVER_EDGE;

describe("popover placement", () => {
  test("opens below a trigger when the card fits there", () => {
    const placement = placePopover({ x: 20, y: 100, width: 40, height: 40 }, card, screen, insets);
    const top = 140 + POPOVER_GAP;
    expect(placement).toEqual({
      top,
      left: 20,
      height: null,
      maxHeight: lowest - top,
      origin: "top left",
    });
  });

  test("opens above a trigger when the card fits only there, and sits on the trigger", () => {
    const placement = placePopover({ x: 340, y: 600, width: 40, height: 40 }, card, screen, insets);
    expect(placement).toEqual({
      top: highest,
      left: 380 - card.width,
      height: 600 - POPOVER_GAP - highest,
      maxHeight: 600 - POPOVER_GAP - highest,
      origin: "bottom right",
    });
  });

  test("takes the side with more space when the card fits on neither side", () => {
    const tall = { width: card.width, height: 700 };
    const upper = placePopover({ x: 20, y: 300, width: 40, height: 40 }, tall, screen, insets);
    expect(upper.height).toBeNull();
    expect(upper.maxHeight).toBe(lowest - (340 + POPOVER_GAP));
    const lower = placePopover({ x: 20, y: 500, width: 40, height: 40 }, tall, screen, insets);
    expect(lower.height).toBe(500 - POPOVER_GAP - highest);
    expect(lower.maxHeight).toBe(500 - POPOVER_GAP - highest);
  });

  test("keeps the card inside the screen edges", () => {
    const left = placePopover({ x: 0, y: 100, width: 30, height: 40 }, card, screen, insets);
    expect(left.left).toBe(POPOVER_EDGE);
    const right = placePopover({ x: 380, y: 100, width: 20, height: 40 }, card, screen, insets);
    expect(right.left).toBe(screen.width - card.width - POPOVER_EDGE);
    expect(right.origin).toBe("top right");
  });
});
