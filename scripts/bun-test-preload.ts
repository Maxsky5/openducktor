import { createRequire } from "node:module";
import { mkdirSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");
const frontendRoot = path.join(repoRoot, "packages/frontend");
const hostRoot = path.join(repoRoot, "packages/host");
const testRoot = path.resolve(process.cwd());
const usesWorkerTempDirectory =
  testRoot === repoRoot || testRoot === frontendRoot || testRoot === hostRoot;

const removeWorkerDirectory = (directory: string): void => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      rmSync(directory, { force: true, recursive: true });
      return;
    } catch (cause) {
      lastError = cause;
      Bun.sleepSync(50);
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Failed to remove the test temp directory '${directory}': ${message}. Close the process that holds it and rerun the tests.`,
    { cause: lastError },
  );
};

const systemTmpDir = tmpdir();
let workerTmpDir: string | null = null;
let configDir: string;
if (usesWorkerTempDirectory) {
  workerTmpDir = path.join(systemTmpDir, `openducktor-worker-tmp-${process.pid}`);
  // A reused PID must not inherit the temp tree of an earlier worker.
  removeWorkerDirectory(workerTmpDir);
  mkdirSync(workerTmpDir, { recursive: true });
  process.env.TMPDIR = workerTmpDir;
  process.env.TMP = workerTmpDir;
  process.env.TEMP = workerTmpDir;
  configDir = path.join(workerTmpDir, `openducktor-test-${process.pid}`);
  mkdirSync(configDir, { recursive: true });
} else {
  configDir = await mkdtemp(path.join(systemTmpDir, "openducktor-test-"));
}
process.env.OPENDUCKTOR_CONFIG_DIR = configDir;

const { afterAll, afterEach, beforeAll } = await import("bun:test");
if (usesWorkerTempDirectory) {
  beforeAll((): void => {
    mkdirSync(configDir, { recursive: true });
    if (workerTmpDir !== null) {
      mkdirSync(workerTmpDir, { recursive: true });
    }
  });
}
afterAll((): void => {
  removeWorkerDirectory(configDir);
  if (workerTmpDir !== null) {
    removeWorkerDirectory(workerTmpDir);
  }
  if (globalThis.document !== undefined) {
    globalThis.document.documentElement.classList.remove("light", "dark");
  }
});

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

  // Unmounting every tree after a file can exceed the 1000 ms test budget on a loaded Windows runner.
  afterEach((): void => {
    cleanup();
  }, 5_000);
}
