import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import packageJson from "../package.json";
import { createBrowserShellBridge } from "./browser-shell-bridge";
import { validateExternalBrowserUrl } from "./browser-url-validation";

describe("browser shell bridge", () => {
  let previousAppVersion: string | undefined;

  beforeEach(() => {
    previousAppVersion = process.env.VITE_ODT_APP_VERSION;
    process.env.VITE_ODT_APP_VERSION = packageJson.version;
  });

  afterEach(() => {
    if (previousAppVersion === undefined) {
      delete process.env.VITE_ODT_APP_VERSION;
      return;
    }

    process.env.VITE_ODT_APP_VERSION = previousAppVersion;
  });

  test("reports the web runner version and external update policy", async () => {
    const bridge = createBrowserShellBridge();

    expect(await bridge.appUpdates.getState()).toEqual({
      status: "disabled",
      currentVersion: packageJson.version,
      disabledCode: "unsupported_web_runner",
      disabledReason: "The browser runner does not install updates in OpenDucktor.",
    });
  });

  test("fails when the web build version is missing", () => {
    delete process.env.VITE_ODT_APP_VERSION;

    expect(() => createBrowserShellBridge()).toThrow("OpenDucktor web build version is missing.");
  });

  test("allows absolute http and https external URLs", () => {
    expect(validateExternalBrowserUrl("https://example.com/path?q=1")).toBe(
      "https://example.com/path?q=1",
    );
    expect(validateExternalBrowserUrl(" http://localhost:1420/kanban ")).toBe(
      "http://localhost:1420/kanban",
    );
  });

  test("rejects non-http external URL schemes", () => {
    expect(() => validateExternalBrowserUrl("javascript:alert(1)")).toThrow(
      "OpenDucktor web can only open http or https URLs.",
    );
    expect(() => validateExternalBrowserUrl("file:///tmp/secret.txt")).toThrow(
      "OpenDucktor web can only open http or https URLs.",
    );
  });

  test("rejects malformed or relative external URLs", () => {
    expect(() => validateExternalBrowserUrl("/relative/path")).toThrow(
      "OpenDucktor web can only open absolute http or https URLs.",
    );
    expect(() => validateExternalBrowserUrl("not a url")).toThrow(
      "OpenDucktor web can only open absolute http or https URLs.",
    );
  });

  test("does not treat noopener window.open null results as blocked popups", async () => {
    const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        open: () => null,
      },
    });

    try {
      await expect(
        createBrowserShellBridge().openExternalUrl("https://example.com/docs"),
      ).resolves.toBeUndefined();
    } finally {
      if (originalWindowDescriptor) {
        Object.defineProperty(globalThis, "window", originalWindowDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }
  });
});
