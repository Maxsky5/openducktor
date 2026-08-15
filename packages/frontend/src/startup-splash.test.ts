import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { dismissOpenDucktorStartupSplash, showOpenDucktorStartupFailure } from "./startup-splash";

if (typeof document === "undefined") {
  GlobalRegistrator.register();
}

const renderStartupSplash = (): HTMLElement => {
  document.body.innerHTML = `
    <div id="openducktor-startup" class="odt-startup" role="status">
      <p data-odt-startup-status>Preparing your workspace</p>
    </div>
  `;
  const splash = document.getElementById("openducktor-startup");
  if (!splash) {
    throw new Error("Startup splash fixture was not created.");
  }
  return splash;
};

beforeEach(() => {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
    }) as MediaQueryList;
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("startup splash", () => {
  test("leaves after the app commits its first paint", () => {
    const splash = renderStartupSplash();

    dismissOpenDucktorStartupSplash();

    expect(splash.classList.contains("odt-startup--leaving")).toBe(true);
    expect(splash.getAttribute("aria-hidden")).toBe("true");

    const transitionEvent = new Event("transitionend") as TransitionEvent;
    Object.defineProperty(transitionEvent, "propertyName", { value: "opacity" });
    splash.dispatchEvent(transitionEvent);

    expect(document.getElementById("openducktor-startup")).toBeNull();
  });

  test("removes immediately when reduced motion is enabled", () => {
    const splash = renderStartupSplash();
    window.matchMedia = (query: string) =>
      ({
        matches: true,
        media: query,
      }) as MediaQueryList;

    dismissOpenDucktorStartupSplash();

    expect(splash.isConnected).toBe(false);
  });

  test("shows a clear startup failure", () => {
    const splash = renderStartupSplash();

    showOpenDucktorStartupFailure();

    expect(splash.classList.contains("odt-startup--failed")).toBe(true);
    expect(splash.getAttribute("role")).toBe("alert");
    expect(splash.textContent).toContain("OpenDucktor could not start");
  });
});
