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

const systemTmpDir = tmpdir();
let workerTmpDir: string | null = null;
let configDir: string;
if (usesWorkerTempDirectory) {
  workerTmpDir = path.join(systemTmpDir, `openducktor-worker-tmp-${process.pid}`);
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

const removeQuietly = (directory: string): void => {
  try {
    rmSync(directory, { force: true, recursive: true });
  } catch {
    return;
  }
};

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
  removeQuietly(configDir);
  if (workerTmpDir !== null) {
    removeQuietly(workerTmpDir);
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

  afterEach((): void => {
    cleanup();
  });
}
