import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "../../../..");

const readRepoFile = (relativePath: string): string =>
  readFileSync(resolve(REPO_ROOT, relativePath), "utf8");

describe("Electron main lifecycle policy", () => {
  test("window close quits through host shutdown instead of keeping macOS app alive", () => {
    const source = readRepoFile("apps/electron/src/main/main.ts");

    expect(source).toContain('window.on("close"');
    expect(source).toContain("event.preventDefault();");
    expect(source).toContain("window.destroy();");
    expect(source).toContain('app.on("window-all-closed"');
    expect(source).toContain('void shutdownHostAndQuit({ reason: "window-all-closed" });');
    expect(source).toContain("if (hostShutdownStarted)");
    expect(source).not.toContain('process.platform !== "darwin"');
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
