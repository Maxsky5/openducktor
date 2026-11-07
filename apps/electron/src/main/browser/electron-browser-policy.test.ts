import { describe, expect, test } from "bun:test";
import {
  ELECTRON_DEVTOOLS_PARTITION,
  electronBrowserPartition,
} from "../../shared/electron-browser-partitions";
import {
  decideWebviewAttach,
  hardenWebviewPreferences,
  refusedBrowserPageScheme,
  type WebviewPreferences,
} from "./electron-browser-policy";

const DEVTOOLS_URL =
  "devtools://devtools/bundled/devtools_app.html?ws=127.0.0.1:4000/secret/devtools/tab";

describe("browser partitions", () => {
  test("names the session partition of a workspace", () => {
    expect(electronBrowserPartition("my-repo")).toBe("persist:openducktor-browser-my-repo");
  });
});

describe("refusedBrowserPageScheme", () => {
  test("allows http, https, and the blank page", () => {
    expect(refusedBrowserPageScheme("http://localhost:3000/")).toBeNull();
    expect(refusedBrowserPageScheme("https://example.com/a?b#c")).toBeNull();
    expect(refusedBrowserPageScheme("about:blank")).toBeNull();
  });

  test("names every other scheme", () => {
    expect(refusedBrowserPageScheme("file:///etc/hosts")).toBe("file");
    expect(refusedBrowserPageScheme("javascript:alert(1)")).toBe("javascript");
    expect(refusedBrowserPageScheme("data:text/html,hi")).toBe("data");
    expect(refusedBrowserPageScheme("about:settings")).toBe("about");
    expect(refusedBrowserPageScheme("devtools://devtools/bundled/devtools_app.html")).toBe(
      "devtools",
    );
    expect(refusedBrowserPageScheme("not a url")).toBe("invalid");
  });
});

describe("decideWebviewAttach", () => {
  test("allows only the bundled DevTools frontend, in the DevTools partition", () => {
    expect(
      decideWebviewAttach({ src: DEVTOOLS_URL, partition: ELECTRON_DEVTOOLS_PARTITION }),
    ).toEqual({ allow: true });
  });

  test("prevents browser tabs, because the engine creates their views", () => {
    expect(
      decideWebviewAttach({
        src: "about:blank",
        partition: electronBrowserPartition("repo-1"),
      }).allow,
    ).toBe(false);
  });

  test("prevents other partitions, including the OpenDucktor app partition", () => {
    for (const partition of ["persist:openducktor", "", "persist:other", "temp"]) {
      expect(decideWebviewAttach({ src: "https://example.com/", partition }).allow).toBe(false);
    }
  });

  test("prevents other sources in the DevTools partition", () => {
    for (const src of [
      "https://example.com/",
      "devtools://devtools/bundled/inspector.html",
      "devtools://evil/bundled/devtools_app.html",
    ]) {
      expect(decideWebviewAttach({ src, partition: ELECTRON_DEVTOOLS_PARTITION }).allow).toBe(
        false,
      );
    }
  });
});

describe("hardenWebviewPreferences", () => {
  test("removes preloads and forces the sandbox", () => {
    const preferences: WebviewPreferences = {
      preload: "/tmp/preload.js",
      preloadURL: "file:///tmp/preload.js",
      sandbox: false,
      contextIsolation: false,
      nodeIntegration: true,
      nodeIntegrationInSubFrames: true,
      webSecurity: false,
    };
    hardenWebviewPreferences(preferences);
    expect(preferences).toEqual({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
    });
  });
});
