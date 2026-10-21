import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import type { BrowserSavedTabsFile } from "../../../ports/browser-tab-store-port";
import { createBrowserTabFileStore } from "./browser-file-stores";

let configRoot = "";

beforeEach(async () => {
  configRoot = await mkdtemp(path.join(tmpdir(), "odt-browser-tabs-"));
});

afterEach(async () => {
  await rm(configRoot, { recursive: true, force: true });
});

const savedFile: BrowserSavedTabsFile = {
  version: 1,
  tabs: [
    {
      tabId: "10000000-0000-4000-8000-000000000001",
      owner: { kind: "task", workspaceId: "workspace-1", taskId: "task-1" },
      url: "http://localhost:3000/",
      title: "App",
      createdBy: "user",
      shared: false,
    },
  ],
};

describe("browser tab file store", () => {
  test("keeps the tabs of each engine kind in its own file", async () => {
    const electron = createBrowserTabFileStore({ configRoot, engineKind: "electron_webview" });
    const chrome = createBrowserTabFileStore({ configRoot, engineKind: "chrome_for_testing" });

    await Effect.runPromise(electron.write(savedFile));

    expect(await Effect.runPromise(electron.read())).toEqual(savedFile);
    expect(await Effect.runPromise(chrome.read())).toEqual({ version: 1, tabs: [] });
    expect(electron.path).toBe(path.join(configRoot, "browser", "electron_webview-tabs.json"));
    // The write renames a temporary file, so no temporary file stays.
    expect(await readdir(path.join(configRoot, "browser"))).toEqual(["electron_webview-tabs.json"]);
  });

  test("fails on a file that is not a saved tab list", async () => {
    const store = createBrowserTabFileStore({ configRoot, engineKind: "chrome_for_testing" });
    await mkdir(path.dirname(store.path), { recursive: true });
    await writeFile(
      store.path,
      JSON.stringify({ version: 1, tabs: [{ ...savedFile.tabs[0], url: "file:///etc/passwd" }] }),
    );

    const error = await Effect.runPromise(Effect.flip(store.read()));

    expect(error.message).toContain("url");
  });
});
