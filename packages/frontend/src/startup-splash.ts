const STARTUP_SPLASH_ID = "openducktor-startup";
const STARTUP_SPLASH_STATUS_SELECTOR = "[data-odt-startup-status]";
const STARTUP_SPLASH_LEAVING_CLASS = "odt-startup--leaving";
const STARTUP_SPLASH_FAILED_CLASS = "odt-startup--failed";
const STARTUP_FAILURE_MESSAGE = "OpenDucktor could not start. Check the application logs.";
const STARTUP_SPLASH_MINIMUM_VISIBLE_MS = 1_000;
const STARTUP_SPLASH_REMOVAL_FALLBACK_MS = 250;
const startupSplashFirstSeenAt = new WeakMap<HTMLElement, number>();
const pendingStartupSplashDismissals = new WeakSet<HTMLElement>();

const getStartupSplash = (): HTMLElement | null => {
  const splash = document.getElementById(STARTUP_SPLASH_ID);
  if (splash && !startupSplashFirstSeenAt.has(splash)) {
    startupSplashFirstSeenAt.set(splash, performance.now());
  }
  return splash;
};

const beginStartupSplashDismissal = (splash: HTMLElement): void => {
  if (splash.classList.contains(STARTUP_SPLASH_LEAVING_CLASS)) {
    return;
  }

  splash.setAttribute("aria-hidden", "true");
  splash.classList.add(STARTUP_SPLASH_LEAVING_CLASS);

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    splash.remove();
    return;
  }

  const removeSplash = (): void => {
    window.clearTimeout(removalFallback);
    splash.remove();
  };
  const removalFallback = window.setTimeout(removeSplash, STARTUP_SPLASH_REMOVAL_FALLBACK_MS);
  splash.addEventListener(
    "transitionend",
    (event) => {
      if (event.target === splash && event.propertyName === "opacity") {
        removeSplash();
      }
    },
    { once: true },
  );
};

if (typeof document !== "undefined") {
  getStartupSplash();
}

export const dismissOpenDucktorStartupSplash = (): void => {
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
    pendingStartupSplashDismissals.add(splash);
    window.setTimeout(() => {
      pendingStartupSplashDismissals.delete(splash);
      beginStartupSplashDismissal(splash);
    }, remainingVisibleMs);
    return;
  }

  beginStartupSplashDismissal(splash);
};

export const showOpenDucktorStartupFailure = (): void => {
  const splash = getStartupSplash();
  if (!splash) {
    return;
  }

  splash.classList.add(STARTUP_SPLASH_FAILED_CLASS);
  splash.setAttribute("aria-label", STARTUP_FAILURE_MESSAGE);
  splash.setAttribute("role", "alert");

  const status = splash.querySelector<HTMLElement>(STARTUP_SPLASH_STATUS_SELECTOR);
  if (status) {
    status.textContent = STARTUP_FAILURE_MESSAGE;
  }
};
