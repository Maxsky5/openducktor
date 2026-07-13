import { chmod } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { Effect } from "effect";
import { runElectronEffect } from "../src/effect/electron-boundary";
import { ElectronOperationError, errorMessage } from "../src/effect/electron-errors";

const require = createRequire(import.meta.url);

export const resolveNodePtySpawnHelper = (): string | null => {
  if (process.platform === "win32") return null;
  const utilsPath = require.resolve("node-pty/lib/utils.js");
  const { loadNativeModule } = require(utilsPath) as {
    loadNativeModule: (name: string) => { dir: string };
  };
  const nativeDirectory = loadNativeModule("pty").dir;
  return resolve(dirname(utilsPath), nativeDirectory, "spawn-helper");
};

export const prepareNodePtyEffect = (): Effect.Effect<void, ElectronOperationError> => {
  const helperPath = resolveNodePtySpawnHelper();
  if (!helperPath) return Effect.void;
  return Effect.tryPromise({
    try: () => chmod(helperPath, 0o755),
    catch: (cause) =>
      new ElectronOperationError({
        operation: "electron.node-pty.prepare-spawn-helper",
        message: `Failed to make the node-pty spawn helper executable: ${errorMessage(cause)}`,
        path: helperPath,
        cause,
      }),
  });
};

if (import.meta.main) {
  await runElectronEffect(prepareNodePtyEffect());
}
