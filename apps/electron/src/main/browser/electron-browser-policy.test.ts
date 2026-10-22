import { describe, expect, test } from "bun:test";
import {
  ELECTRON_DEVTOOLS_PARTITION,
  electronBrowserPartition,
  workspaceIdOfBrowserPartition,
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
  test("round-trips the workspace of a browser partition", () => {
    expect(electronBrowserPartition("my-repo")).toBe("persist:openducktor-browser-my-repo");
    expect(workspaceIdOfBrowserPartition("persist:openducktor-browser-my-repo")).toBe("my-repo");
  });

  test("rejects partitions that are not workspace browser partitions", () => {
    expect(workspaceIdOfBrowserPartition("persist:openducktor")).toBeNull();
    expect(workspaceIdOfBrowserPartition(ELECTRON_DEVTOOLS_PARTITION)).toBeNull();
    expect(workspaceIdOfBrowserPartition("persist:openducktor-browser-")).toBeNull();
    expect(workspaceIdOfBrowserPartition("persist:openducktor-browser-../x")).toBeNull();
    expect(workspaceIdOfBrowserPartition("openducktor-browser-my-repo")).toBeNull();
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
  test("allows a browser tab in the partition of its workspace", () => {
    expect(
      decideWebviewAttach({
        src: "about:blank",
        partition: electronBrowserPartition("repo-1"),
      }),
    ).toEqual({ allow: true, kind: "browser", workspaceId: "repo-1" });
    expect(
      decideWebviewAttach({
        src: "https://example.com/",
        partition: electronBrowserPartition("repo-1"),
      }),
    ).toEqual({ allow: true, kind: "browser", workspaceId: "repo-1" });
  });

  test("allows the bundled DevTools frontend in the DevTools partition", () => {
    expect(
      decideWebviewAttach({ src: DEVTOOLS_URL, partition: ELECTRON_DEVTOOLS_PARTITION }),
    ).toEqual({ allow: true, kind: "devtools" });
  });

  test("prevents other partitions, including the OpenDucktor app partition", () => {
    for (const partition of ["persist:openducktor", "", "persist:other", "temp"]) {
      expect(decideWebviewAttach({ src: "https://example.com/", partition }).allow).toBe(false);
    }
  });

  test("prevents other sources in browser and DevTools partitions", () => {
    const browserPartition = electronBrowserPartition("repo-1");
    for (const src of ["", "file:///etc/hosts", "data:text/html,x", DEVTOOLS_URL]) {
      expect(decideWebviewAttach({ src, partition: browserPartition }).allow).toBe(false);
    }
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
