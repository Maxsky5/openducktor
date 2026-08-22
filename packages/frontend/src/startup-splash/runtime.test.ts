import { hasRuntimeType } from "@openducktor/contracts";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { dismissOpenDucktorStartupSplash, showOpenDucktorStartupFailure } from "./runtime";

if (hasRuntimeType(globalThis.document, "undefined")) {
  GlobalRegistrator.register();
}

const originalMatchMedia = window.matchMedia;

const renderStartupSplash = (): HTMLElement => {
  document.body.innerHTML = `
    <div id="openducktor-startup" class="odt-startup" role="status" aria-live="polite">
      <p data-odt-startup-status></p>
    </div>
  `;
  const splash = document.getElementById("openducktor-startup");
  if (!splash) {
    throw new Error("Startup splash fixture was not created.");
  }
  return splash;
};

const captureScheduledTimeout = () => {
  const scheduled: Array<{ callback: () => void; delayMs: number | undefined }> = [];
  const cleared = new Set<unknown>();
  // SAFETY: This test controls the fixture and supplies `typeof window.setTimeout` used by this case.
  const setTimeoutImplementation = ((handler: TimerHandler, timeout?: number) => {
    if (!hasRuntimeType(handler, "function")) {
      throw new TypeError("Expected a timeout callback.");
    }
    scheduled.push({ callback: () => handler(), delayMs: timeout });
    return scheduled.length;
  }) as typeof window.setTimeout;
  const timeoutSpy = spyOn(window, "setTimeout").mockImplementation(setTimeoutImplementation);
  const clearTimeoutSpy = spyOn(window, "clearTimeout").mockImplementation((timeoutId) => {
    if (timeoutId !== undefined) {
      cleared.add(timeoutId);
    }
  });

  return {
    delayMs: (index = 0) => scheduled[index]?.delayMs,
    isCleared: (index = 0) => cleared.has(index + 1),
    run: (index = 0) => {
      if (cleared.has(index + 1)) {
        return;
      }
      const timeout = scheduled[index];
      if (!timeout) {
        throw new Error("No timeout was scheduled.");
      }
      timeout.callback();
    },
    restore: () => {
      clearTimeoutSpy.mockRestore();
      timeoutSpy.mockRestore();
    },
  };
};

beforeEach(() => {
  // SAFETY: This test controls the fixture and supplies `MediaQueryList` used by this case.
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
    }) as MediaQueryList;
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  document.body.innerHTML = "";
});

describe("startup splash", () => {
  test("stays visible for one second while the app renders behind it", () => {
    const splash = renderStartupSplash();
    const scheduledTimeout = captureScheduledTimeout();

    try {
      dismissOpenDucktorStartupSplash();

      expect(splash.classList.contains("odt-startup--leaving")).toBe(false);
      expect(splash.getAttribute("aria-hidden")).toBeNull();
      expect(scheduledTimeout.delayMs()).toBeGreaterThan(950);
      expect(scheduledTimeout.delayMs()).toBeLessThanOrEqual(1_000);

      scheduledTimeout.run();

      expect(splash.classList.contains("odt-startup--leaving")).toBe(true);
      expect(splash.getAttribute("aria-hidden")).toBe("true");
      expect(scheduledTimeout.delayMs(1)).toBe(250);
    } finally {
      scheduledTimeout.restore();
    }

    // SAFETY: This test controls the fixture and supplies `TransitionEvent` used by this case.
    const transitionEvent = new Event("transitionend") as TransitionEvent;
    Object.defineProperty(transitionEvent, "propertyName", { value: "opacity" });
    splash.dispatchEvent(transitionEvent);

    expect(document.getElementById("openducktor-startup")).toBeNull();
  });

  test("starts leaving at once when startup already took one second", () => {
    const splash = renderStartupSplash();
    let nowCallCount = 0;
    const nowSpy = spyOn(performance, "now").mockImplementation(() => {
      nowCallCount += 1;
      return nowCallCount === 1 ? 0 : 1_001;
    });
    const scheduledTimeout = captureScheduledTimeout();

    try {
      dismissOpenDucktorStartupSplash();

      expect(splash.classList.contains("odt-startup--leaving")).toBe(true);
      expect(scheduledTimeout.delayMs()).toBe(250);
    } finally {
      scheduledTimeout.restore();
      nowSpy.mockRestore();
    }
  });

  test("removes the splash if the opacity transition event does not fire", () => {
    const splash = renderStartupSplash();
    let nowCallCount = 0;
    const nowSpy = spyOn(performance, "now").mockImplementation(() => {
      nowCallCount += 1;
      return nowCallCount === 1 ? 0 : 1_001;
    });
    const scheduledTimeout = captureScheduledTimeout();

    try {
      dismissOpenDucktorStartupSplash();
      scheduledTimeout.run();

      expect(splash.isConnected).toBe(false);
    } finally {
      scheduledTimeout.restore();
      nowSpy.mockRestore();
    }
  });

  test("removes without a fade after the one-second hold when reduced motion is enabled", () => {
    const splash = renderStartupSplash();
    const scheduledTimeout = captureScheduledTimeout();
    // SAFETY: This test controls the fixture and supplies `MediaQueryList` used by this case.
    window.matchMedia = (query: string) =>
      ({
        matches: true,
        media: query,
      }) as MediaQueryList;

    try {
      dismissOpenDucktorStartupSplash();

      expect(splash.isConnected).toBe(true);

      scheduledTimeout.run();

      expect(splash.isConnected).toBe(false);
    } finally {
      scheduledTimeout.restore();
    }
  });

  test("cancels pending dismissal and shows a clear startup failure", () => {
    const splash = renderStartupSplash();
    const scheduledTimeout = captureScheduledTimeout();

    try {
      dismissOpenDucktorStartupSplash();
      showOpenDucktorStartupFailure();

      expect(scheduledTimeout.isCleared()).toBe(true);
      expect(splash.classList.contains("odt-startup--failed")).toBe(true);
      expect(splash.getAttribute("role")).toBe("alert");
      expect(splash.getAttribute("aria-live")).toBeNull();
      expect(splash.getAttribute("aria-hidden")).toBeNull();
      expect(splash.textContent).toContain("OpenDucktor could not start");

      scheduledTimeout.run();
      expect(splash.isConnected).toBe(true);
    } finally {
      scheduledTimeout.restore();
    }
  });

  test("cancels active removal and keeps the startup failure visible", () => {
    const splash = renderStartupSplash();
    let nowCallCount = 0;
    const nowSpy = spyOn(performance, "now").mockImplementation(() => {
      nowCallCount += 1;
      return nowCallCount === 1 ? 0 : 1_001;
    });
    const scheduledTimeout = captureScheduledTimeout();

    try {
      dismissOpenDucktorStartupSplash();
      expect(splash.classList.contains("odt-startup--leaving")).toBe(true);
      expect(splash.getAttribute("aria-hidden")).toBe("true");

      showOpenDucktorStartupFailure();

      expect(scheduledTimeout.isCleared()).toBe(true);
      expect(splash.classList.contains("odt-startup--leaving")).toBe(false);
      expect(splash.classList.contains("odt-startup--failed")).toBe(true);
      expect(splash.getAttribute("aria-hidden")).toBeNull();

      // SAFETY: This test controls the fixture and supplies `TransitionEvent` used by this case.
      const transitionEvent = new Event("transitionend") as TransitionEvent;
      Object.defineProperty(transitionEvent, "propertyName", { value: "opacity" });
      splash.dispatchEvent(transitionEvent);
      scheduledTimeout.run();

      expect(splash.isConnected).toBe(true);
      expect(splash.textContent).toContain("OpenDucktor could not start");
    } finally {
      scheduledTimeout.restore();
      nowSpy.mockRestore();
    }
  });
});
