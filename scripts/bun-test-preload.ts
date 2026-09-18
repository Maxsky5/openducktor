import { createRequire } from "node:module";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const systemTmpDir = tmpdir();
const workerTmpDir = path.join(systemTmpDir, `openducktor-worker-tmp-${process.pid}`);
const configDir = path.join(workerTmpDir, `openducktor-test-${process.pid}`);
mkdirSync(workerTmpDir, { recursive: true });
mkdirSync(configDir, { recursive: true });
process.env.OPENDUCKTOR_CONFIG_DIR = configDir;
process.env.TMPDIR = workerTmpDir;
process.env.TMP = workerTmpDir;
process.env.TEMP = workerTmpDir;

const removeQuietly = (directory: string): void => {
  try {
    rmSync(directory, { force: true, recursive: true });
  } catch {
    return;
  }
};

const { afterAll, afterEach, beforeAll } = await import("bun:test");
beforeAll((): void => {
  mkdirSync(workerTmpDir, { recursive: true });
  mkdirSync(configDir, { recursive: true });
});
afterAll((): void => {
  removeQuietly(configDir);
  removeQuietly(workerTmpDir);
});

const repoRoot = path.resolve(import.meta.dir, "..");
const frontendRoot = path.join(repoRoot, "packages/frontend");
const testRoot = path.resolve(process.cwd());
if (testRoot === repoRoot || testRoot === frontendRoot) {
  const frontendRequire = createRequire(
    new URL("../packages/frontend/package.json", import.meta.url),
  );
  const { GlobalRegistrator } = await import(
    frontendRequire.resolve("@happy-dom/global-registrator")
  );

  if (globalThis.document === undefined) {
    GlobalRegistrator.register();
  }

  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true,
  });

  const { cleanup } = await import(frontendRequire.resolve("@testing-library/react"));

  afterEach((): void => {
    cleanup();
  });
}
