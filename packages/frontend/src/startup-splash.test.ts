import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { dismissOpenDucktorStartupSplash, showOpenDucktorStartupFailure } from "./startup-splash";

if (typeof document === "undefined") {
  GlobalRegistrator.register();
}

const originalMatchMedia = window.matchMedia;

const renderStartupSplash = (): HTMLElement => {
  document.body.innerHTML = `
    <div id="openducktor-startup" class="odt-startup" role="status">
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
  const setTimeoutImplementation = ((handler: TimerHandler, timeout?: number) => {
    if (typeof handler !== "function") {
      throw new TypeError("Expected a timeout callback.");
    }
    scheduled.push({ callback: () => handler(), delayMs: timeout });
    return scheduled.length;
  }) as typeof window.setTimeout;
  const timeoutSpy = spyOn(window, "setTimeout").mockImplementation(setTimeoutImplementation);

  return {
    delayMs: (index = 0) => scheduled[index]?.delayMs,
    run: (index = 0) => {
      const timeout = scheduled[index];
      if (!timeout) {
        throw new Error("No timeout was scheduled.");
      }
      timeout.callback();
    },
    restore: () => timeoutSpy.mockRestore(),
  };
};

beforeEach(() => {
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

  test("shows a clear startup failure", () => {
    const splash = renderStartupSplash();

    showOpenDucktorStartupFailure();

    expect(splash.classList.contains("odt-startup--failed")).toBe(true);
    expect(splash.getAttribute("role")).toBe("alert");
    expect(splash.textContent).toContain("OpenDucktor could not start");
  });
});
