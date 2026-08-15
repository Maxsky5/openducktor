const STARTUP_SPLASH_ID = "openducktor-startup";
const STARTUP_SPLASH_STATUS_SELECTOR = "[data-odt-startup-status]";
const STARTUP_SPLASH_LEAVING_CLASS = "odt-startup--leaving";
const STARTUP_SPLASH_FAILED_CLASS = "odt-startup--failed";
const STARTUP_FAILURE_MESSAGE = "OpenDucktor could not start. Check the application logs.";

const getStartupSplash = (): HTMLElement | null => document.getElementById(STARTUP_SPLASH_ID);

export const dismissOpenDucktorStartupSplash = (): void => {
  const splash = getStartupSplash();
  if (!splash || splash.classList.contains(STARTUP_SPLASH_LEAVING_CLASS)) {
    return;
  }

  splash.setAttribute("aria-hidden", "true");
  splash.classList.add(STARTUP_SPLASH_LEAVING_CLASS);

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    splash.remove();
    return;
  }

  splash.addEventListener(
    "transitionend",
    (event) => {
      if (event.target === splash && event.propertyName === "opacity") {
        splash.remove();
      }
    },
    { once: true },
  );
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
