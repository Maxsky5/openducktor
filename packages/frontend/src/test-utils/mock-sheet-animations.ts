import { spyOn } from "bun:test";
import { fireEvent } from "@testing-library/react";

const SHEET_ANIMATIONS = new Map([
  ["sheet-overlay", { open: "sheet-fade-in", closed: "sheet-fade-out" }],
  ["sheet-content", { open: "sheet-slide-in", closed: "sheet-slide-out" }],
]);

/**
 * Runs a callback while sheet parts report the animations from `sheet.css`.
 * happy-dom does not load that CSS, so Radix Presence would otherwise remove a closed sheet at once.
 */
export async function withSheetAnimations(callback: () => void | Promise<void>): Promise<void> {
  const nativeGetComputedStyle = globalThis.getComputedStyle;
  const computedStyle = spyOn(globalThis, "getComputedStyle").mockImplementation((element) => {
    const style = nativeGetComputedStyle(element);
    const animations = SHEET_ANIMATIONS.get(element.getAttribute("data-slot") ?? "");
    if (!animations) return style;
    return Object.create(style, {
      animationName: {
        get: () =>
          element.getAttribute("data-state") === "open" ? animations.open : animations.closed,
      },
      getPropertyValue: { value: style.getPropertyValue.bind(style) },
    });
  });
  try {
    await callback();
  } finally {
    computedStyle.mockRestore();
  }
}

/** Ends the exit animation of each closed sheet part, as the browser would. */
export function finishSheetExit(): void {
  for (const [slot, animations] of SHEET_ANIMATIONS) {
    for (const element of document.querySelectorAll(`[data-slot="${slot}"][data-state="closed"]`)) {
      fireEvent.animationEnd(element, { animationName: animations.closed });
    }
  }
}
