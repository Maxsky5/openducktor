import { describe, expect, test } from "bun:test";
import { verifyElectronUpdaterIsDeferred } from "./build-main";

const input = (bytesInOutput: number) => ({ bytesInOutput });

describe("Electron main bundle policy", () => {
  test("accepts electron-updater only in a dynamically loaded chunk", () => {
    expect(() =>
      verifyElectronUpdaterIsDeferred({
        inputs: {},
        outputs: {
          "dist/chunks/chunk.js": {
            bytes: 20,
            exports: [],
            imports: [],
            inputs: { "node_modules/electron-updater/out/main.js": input(20) },
          },
          "dist/main.js": {
            bytes: 10,
            entryPoint: "apps/electron/src/main/main.ts",
            exports: [],
            imports: [{ kind: "dynamic-import", path: "dist/chunks/chunk.js" }],
            inputs: { "apps/electron/src/main/main.ts": input(10) },
          },
        },
      }),
    ).not.toThrow();
  });

  test("rejects electron-updater in the startup entry", () => {
    expect(() =>
      verifyElectronUpdaterIsDeferred({
        inputs: {},
        outputs: {
          "dist/main.js": {
            bytes: 30,
            entryPoint: "apps/electron/src/main/main.ts",
            exports: [],
            imports: [],
            inputs: {
              "apps/electron/src/main/main.ts": input(10),
              "node_modules/electron-updater/out/main.js": input(20),
            },
          },
        },
      }),
    ).toThrow("would block startup");
  });
});
