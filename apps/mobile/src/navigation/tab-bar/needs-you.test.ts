import { describe, expect, test } from "bun:test";
import { needsYouBadgeText, needsYouSpokenText } from "./needs-you";

describe("Needs you count of the Sessions tab", () => {
  test("caps the badge at 99+", () => {
    expect(needsYouBadgeText(7)).toBe("7");
    expect(needsYouBadgeText(99)).toBe("99");
    expect(needsYouBadgeText(100)).toBe("99+");
  });

  test("speaks the exact count with the right number of the noun", () => {
    expect(needsYouSpokenText(1)).toBe("1 session needs you");
    expect(needsYouSpokenText(3)).toBe("3 sessions need you");
    expect(needsYouSpokenText(140)).toBe("140 sessions need you");
  });
});
