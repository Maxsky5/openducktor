import { scheduleTask, type ScheduleTask } from "@/lib/scheduling";

const STARTUP_SPLASH_ID = "openducktor-startup";
const STARTUP_SPLASH_STATUS_SELECTOR = "[data-odt-startup-status]";
const STARTUP_SPLASH_LEAVING_CLASS = "odt-startup--leaving";
const STARTUP_SPLASH_FAILED_CLASS = "odt-startup--failed";
const STARTUP_FAILURE_MESSAGE = "OpenDucktor could not start. Check the application logs.";
const STARTUP_SPLASH_MINIMUM_VISIBLE_MS = 1_000;
const STARTUP_SPLASH_REMOVAL_FALLBACK_MS = 250;
const startupSplashFirstSeenAt = new WeakMap<HTMLElement, number>();
const pendingStartupSplashDismissals = new WeakMap<HTMLElement, () => void>();

const cancelStartupSplashDismissal = (splash: HTMLElement): void => {
  pendingStartupSplashDismissals.get(splash)?.();
  pendingStartupSplashDismissals.delete(splash);
};

const getStartupSplash = (): HTMLElement | null => {
  const splash = document.getElementById(STARTUP_SPLASH_ID);
  if (splash && !startupSplashFirstSeenAt.has(splash)) {
    startupSplashFirstSeenAt.set(splash, performance.now());
  }
  return splash;
};

const beginStartupSplashDismissal = (splash: HTMLElement, scheduler: ScheduleTask): void => {
  if (splash.classList.contains(STARTUP_SPLASH_LEAVING_CLASS)) {
    return;
  }

  splash.setAttribute("aria-hidden", "true");
  splash.classList.add(STARTUP_SPLASH_LEAVING_CLASS);

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    splash.remove();
    return;
  }

  const handleTransitionEnd = (event: TransitionEvent): void => {
    if (event.target === splash && event.propertyName === "opacity") {
      removeSplash();
    }
  };
  const cancelRemoval = (): void => {
    cancelRemovalFallback();
    splash.removeEventListener("transitionend", handleTransitionEnd);
  };
  const removeSplash = (): void => {
    cancelStartupSplashDismissal(splash);
    splash.remove();
  };
  const cancelRemovalFallback = scheduler(removeSplash, STARTUP_SPLASH_REMOVAL_FALLBACK_MS);
  splash.addEventListener("transitionend", handleTransitionEnd, { once: true });
  pendingStartupSplashDismissals.set(splash, cancelRemoval);
};

// Module evaluation starts a conservative hold before the browser can paint the splash.
if (typeof globalThis.document !== "undefined") {
  getStartupSplash();
}

export const dismissOpenDucktorStartupSplash = (scheduler: ScheduleTask = scheduleTask): void => {
  const splash = getStartupSplash();
  if (
    !splash ||
    splash.classList.contains(STARTUP_SPLASH_LEAVING_CLASS) ||
    pendingStartupSplashDismissals.has(splash)
  ) {
    return;
  }

  const firstSeenAt = startupSplashFirstSeenAt.get(splash) ?? performance.now();
  const remainingVisibleMs = STARTUP_SPLASH_MINIMUM_VISIBLE_MS - (performance.now() - firstSeenAt);
  if (remainingVisibleMs > 0) {
    const cancelDismissal = scheduler(() => {
      pendingStartupSplashDismissals.delete(splash);
      beginStartupSplashDismissal(splash, scheduler);
    }, remainingVisibleMs);
    pendingStartupSplashDismissals.set(splash, cancelDismissal);
    return;
  }

  beginStartupSplashDismissal(splash, scheduler);
};

export const showOpenDucktorStartupFailure = (): void => {
  const splash = getStartupSplash();
  if (!splash) {
    return;
  }

  cancelStartupSplashDismissal(splash);
  splash.classList.remove(STARTUP_SPLASH_LEAVING_CLASS);
  splash.removeAttribute("aria-hidden");
  splash.classList.add(STARTUP_SPLASH_FAILED_CLASS);
  splash.setAttribute("aria-label", STARTUP_FAILURE_MESSAGE);
  splash.setAttribute("role", "alert");
  splash.removeAttribute("aria-live");

  const status = splash.querySelector<HTMLElement>(STARTUP_SPLASH_STATUS_SELECTOR);
  if (status) {
    status.textContent = STARTUP_FAILURE_MESSAGE;
  }
};
