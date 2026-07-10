import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ELECTRON_ROOT = resolve(import.meta.dir, "../..");

const readPreloadSource = (): string =>
  readFileSync(resolve(ELECTRON_ROOT, "src/preload/preload.ts"), "utf8");

describe("Electron preload policy", () => {
  test("app update subscriptions log and ignore malformed state events", () => {
    const source = readPreloadSource();

    expect(source).toContain("appUpdateStateSchema.safeParse(state)");
    expect(source).toContain("Received invalid app update state from Electron main process.");
    expect(source).toContain("return;");
    expect(source).toContain("listener(parsedState.data)");
  });
});
