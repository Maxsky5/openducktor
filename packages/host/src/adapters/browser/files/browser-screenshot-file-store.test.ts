import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import {
  BROWSER_SCREENSHOTS_KEPT,
  createBrowserScreenshotFileStore,
} from "./browser-screenshot-file-store";

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const createStore = async () => {
  const configRoot = await mkdtemp(path.join(tmpdir(), "odt-screenshots-"));
  roots.push(configRoot);
  const folder = path.join(configRoot, "browser", "screenshots", "workspace-1");
  return { store: createBrowserScreenshotFileStore({ configRoot }), folder };
};

describe("browser screenshot file store", () => {
  test("keeps the newest screenshots of a workspace and deletes the oldest", async () => {
    const { store, folder } = await createStore();
    const saved: string[] = [];
    for (let index = 0; index <= BROWSER_SCREENSHOTS_KEPT; index += 1) {
      const url = await Effect.runPromise(store.save("workspace-1", new Uint8Array([index % 256])));
      saved.push(fileURLToPath(url));
    }

    const kept = (await readdir(folder)).map((name) => path.join(folder, name)).sort();
    expect(kept).toEqual(saved.slice(1));
    expect(Array.from(await readFile(saved.at(-1) ?? ""))).toEqual([
      BROWSER_SCREENSHOTS_KEPT % 256,
    ]);
  });

  test("deletes the screenshots of a removed workspace", async () => {
    const { store, folder } = await createStore();
    await Effect.runPromise(store.save("workspace-1", new Uint8Array([1])));

    await Effect.runPromise(store.removeWorkspace("workspace-1"));

    await expect(readdir(folder)).rejects.toThrow("ENOENT");
  });
});
