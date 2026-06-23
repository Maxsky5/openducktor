import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../../../..");

const readRepoFile = (relativePath: string): string =>
  readFileSync(resolve(REPO_ROOT, relativePath), "utf8");

describe("Electron main lifecycle policy", () => {
  test("main window uses the tracked application icon", () => {
    const source = readRepoFile("apps/electron/src/main/main.ts");

    expect(source).toContain("resolveElectronWindowIcon()");
    expect(source).toContain("nativeImage.createFromPath(iconPath)");
    expect(source).toContain("throw new Error(");
    expect(source).toContain("icon is missing or invalid:");
    expect(source).toContain("icon: resolveElectronWindowIcon()");
  });

  test("macOS dock uses the tracked application icon", () => {
    const source = readRepoFile("apps/electron/src/main/main.ts");

    expect(source).toContain("configureElectronDockIcon()");
    expect(source).toContain('path.join(resolveElectronIconDirectory(), "icon.png")');
    expect(source).toContain("app.dock.setIcon(");
  });

  test("window close quits through host shutdown instead of keeping macOS app alive", () => {
    const source = readRepoFile("apps/electron/src/main/main.ts");

    expect(source).toContain('window.on("close"');
    expect(source).toContain("event.preventDefault();");
    expect(source).toContain("hideWindowsForShutdown();");
    expect(source).not.toContain("window.destroy();");
    expect(source).toContain('app.on("window-all-closed"');
    expect(source).toContain('void shutdownHostAndQuit({ reason: "window-all-closed" });');
    expect(source).toContain("if (hostShutdownStarted)");
  });

  test("Windows and Linux keep the menu hidden until the native reveal shortcut", () => {
    const source = readRepoFile("apps/electron/src/main/main.ts");

    expect(source).toContain('autoHideMenuBar: process.platform !== "darwin"');
  });

  test("Cmd+Q waits for the host shutdown boundary before quitting", () => {
    const source = readRepoFile("apps/electron/src/main/main.ts");

    expect(source).toContain('app.on("before-quit"');
    expect(source).toContain("event.preventDefault();");
    expect(source).toContain("hideWindowsForShutdown();");
    expect(source).toContain("await hostCommandRouter.dispose();");
  });

  test("process signals wait for host shutdown before exiting", () => {
    const source = readRepoFile("apps/electron/src/main/main.ts");

    expect(source).toContain('process.once("SIGINT"');
    expect(source).toContain('process.once("SIGTERM"');
    expect(source).toContain('process.once("SIGHUP"');
    expect(source).toContain("exitAfterShutdown: true");
    expect(source).toContain("process.exit(exitCode)");
    expect(source).toContain("OpenDucktor host shutdown started");
    expect(source).toContain("OpenDucktor host shutdown complete");
  });
});
