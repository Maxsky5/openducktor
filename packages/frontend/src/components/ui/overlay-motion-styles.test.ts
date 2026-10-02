import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

type MotionFile = "popover.css" | "sheet.css" | "tooltip.css";
type HappyDomWindow = typeof window & {
  happyDOM: { settings: { device: { prefersReducedMotion: "reduce" | "no-preference" } } };
};

const readMotionStyles = (file: MotionFile): string =>
  readFileSync(new URL(`./${file}`, import.meta.url), "utf8");

type MotionSnapshot = {
  animation: string;
  transformOrigin: string;
  sheetOffset: string;
  pointerEvents: string;
};

// Use a separate document so the real CSS cannot affect parallel component tests.
function createStyledDocument(file: MotionFile): Document {
  const styleDocument = document.implementation.createHTMLDocument();
  const styleElement = styleDocument.createElement("style");
  styleElement.textContent = readMotionStyles(file);
  styleDocument.head.append(styleElement);
  return styleDocument;
}

function readRootProperty(file: MotionFile, name: string): string {
  return getComputedStyle(createStyledDocument(file).documentElement).getPropertyValue(name);
}

function readMotion(
  file: MotionFile,
  attributes: Record<string, string>,
  { reducedMotion = false } = {},
): MotionSnapshot {
  // SAFETY: The test preload registers happy-dom, which adds `happyDOM` to the global window.
  const device = (window as HappyDomWindow).happyDOM.settings.device;
  const previousPreference = device.prefersReducedMotion;
  device.prefersReducedMotion = reducedMotion ? "reduce" : "no-preference";
  try {
    const styleDocument = createStyledDocument(file);
    const element = styleDocument.createElement("div");
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    styleDocument.body.append(element);
    // Computed styles are live, so read them before the media preference is restored.
    const style = getComputedStyle(element);
    return {
      animation: style.animation,
      transformOrigin: style.transformOrigin,
      sheetOffset: style.getPropertyValue("--sheet-offset"),
      pointerEvents: style.pointerEvents,
    };
  } finally {
    device.prefersReducedMotion = previousPreference;
  }
}

function animationFor(file: MotionFile, attributes: Record<string, string>): string {
  return readMotion(file, attributes).animation;
}

describe("popover motion", () => {
  test("grows from the trigger and closes faster than it opens", () => {
    const opened = readMotion("popover.css", {
      "data-slot": "popover-content",
      "data-state": "open",
      style: "--radix-popover-content-transform-origin: 0px 100%",
    });

    expect(opened.animation).toBe(
      "popover-scale-in 250ms cubic-bezier(0.22, 1, 0.36, 1) backwards",
    );
    expect(opened.transformOrigin).toBe("0px 100%");
    expect(readRootProperty("popover.css", "--popover-scale")).toBe("0.97");
    expect(readRootProperty("popover.css", "--popover-scale-close")).toBe("0.99");
    expect(
      animationFor("popover.css", { "data-slot": "popover-content", "data-state": "closed" }),
    ).toBe("popover-scale-out 150ms cubic-bezier(0.22, 1, 0.36, 1) both");
  });
});

describe("tooltip motion", () => {
  test("animates only the first tooltip and fades every tooltip out", () => {
    const delayed = readMotion("tooltip.css", {
      "data-slot": "tooltip-content",
      "data-state": "delayed-open",
    });

    expect(delayed.animation).toBe("tooltip-scale-in 150ms ease-out backwards");
    expect(readRootProperty("tooltip.css", "--tooltip-scale")).toBe("0.98");
    expect(
      animationFor("tooltip.css", { "data-slot": "tooltip-content", "data-state": "instant-open" }),
    ).toBe("");
    expect(
      animationFor("tooltip.css", { "data-slot": "tooltip-content", "data-state": "closed" }),
    ).toBe("tooltip-fade-out 50ms ease-out both");
  });
});

describe("sheet motion", () => {
  test("slides each side in from its own edge", () => {
    const offsets = {
      right: "translateX(100%)",
      left: "translateX(-100%)",
      top: "translateY(-100%)",
      bottom: "translateY(100%)",
    };

    for (const [side, offset] of Object.entries(offsets)) {
      const { sheetOffset } = readMotion("sheet.css", {
        "data-slot": "sheet-content",
        "data-side": side,
        "data-state": "open",
      });
      expect(sheetOffset).toBe(offset);
    }
  });

  test("closes the content and both overlay paths faster than it opens them", () => {
    const ease = "cubic-bezier(0.32, 0.72, 0, 1)";

    expect(animationFor("sheet.css", { "data-slot": "sheet-content", "data-state": "open" })).toBe(
      `sheet-slide-in 300ms ${ease} backwards`,
    );
    expect(
      animationFor("sheet.css", { "data-slot": "sheet-content", "data-state": "closed" }),
    ).toBe(`sheet-slide-out 200ms ${ease} both`);
    expect(animationFor("sheet.css", { "data-slot": "sheet-overlay", "data-state": "open" })).toBe(
      `sheet-fade-in 300ms ${ease} both`,
    );
    expect(
      animationFor("sheet.css", { "data-slot": "sheet-overlay", "data-state": "closed" }),
    ).toBe(`sheet-fade-out 200ms ${ease} both`);
  });
});

describe("closing overlays", () => {
  test("stop taking clicks while they play their exit", () => {
    for (const [file, slot] of [
      ["popover.css", "popover-content"],
      ["sheet.css", "sheet-content"],
    ] as const) {
      const pointerEvents = (state: string) =>
        readMotion(file, { "data-slot": slot, "data-side": "right", "data-state": state })
          .pointerEvents;
      expect(`${slot} open: ${pointerEvents("open")}`).not.toBe(`${slot} open: none`);
      expect(`${slot} closed: ${pointerEvents("closed")}`).toBe(`${slot} closed: none`);
    }
  });
});

describe("reduced motion", () => {
  test("opens and closes every overlay without animation", () => {
    const cases: Array<[MotionFile, string, string]> = [
      ["popover.css", "popover-content", "open"],
      ["popover.css", "popover-content", "closed"],
      ["tooltip.css", "tooltip-content", "delayed-open"],
      ["tooltip.css", "tooltip-content", "closed"],
      ["sheet.css", "sheet-content", "open"],
      ["sheet.css", "sheet-content", "closed"],
      ["sheet.css", "sheet-overlay", "open"],
      ["sheet.css", "sheet-overlay", "closed"],
    ];

    for (const [file, slot, state] of cases) {
      const { animation } = readMotion(
        file,
        { "data-slot": slot, "data-side": "right", "data-state": state },
        { reducedMotion: true },
      );
      expect(`${slot} ${state}: ${animation}`).toBe(`${slot} ${state}: none`);
    }
  });
});
