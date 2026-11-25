import { afterAll, afterEach, beforeAll, beforeEach } from "bun:test";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");
const frontendRoot = path.join(repoRoot, "packages/frontend");
const hostRoot = path.join(repoRoot, "packages/host");
const testRoot = path.resolve(process.cwd());
const usesWorkerTempDirectory =
  testRoot === repoRoot || testRoot === frontendRoot || testRoot === hostRoot;

const removeDirectory = (directory: string): Error | null => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) Bun.sleepSync(50);
    try {
      rmSync(directory, { force: true, recursive: true });
      return null;
    } catch (cause) {
      lastError = cause;
    }
  }
  return lastError instanceof Error ? lastError : new Error(String(lastError));
};

let warnedAboutCleanup = false;
const removeWorkerDirectoryAfterFile = (directory: string): void => {
  const failure = removeDirectory(directory);
  if (failure !== null && !warnedAboutCleanup) {
    warnedAboutCleanup = true;
    console.warn(
      `Left the test temp directory '${directory}' behind because a process still holds it: ${failure.message}`,
    );
  }
};

const systemTmpDir = tmpdir();
const workerTmpDir = usesWorkerTempDirectory
  ? mkdtempSync(path.join(systemTmpDir, "openducktor-worker-tmp-"))
  : null;
const configDir =
  workerTmpDir === null
    ? mkdtempSync(path.join(systemTmpDir, "openducktor-test-"))
    : path.join(workerTmpDir, `openducktor-test-${process.pid}`);
if (workerTmpDir !== null) {
  mkdirSync(configDir);
  process.env.TMPDIR = workerTmpDir;
  process.env.TMP = workerTmpDir;
  process.env.TEMP = workerTmpDir;
}
process.env.OPENDUCKTOR_CONFIG_DIR = configDir;

let tempDirectoryRemoved = false;
const restoreTestDirectory = (): void => {
  if (!tempDirectoryRemoved) return;
  mkdirSync(configDir, { recursive: true });
  tempDirectoryRemoved = false;
};
beforeAll(restoreTestDirectory, 5_000);
// Bun can repeat a file without calling the preload's beforeAll again.
beforeEach(restoreTestDirectory, 5_000);

// Removing a worker temp tree can exceed the 1000 ms test budget on a loaded Windows runner.
afterAll((): void => {
  // Windows keeps handles on the temp tree while the worker runs, so a failure here is a leak, not a defect.
  removeWorkerDirectoryAfterFile(workerTmpDir ?? configDir);
  tempDirectoryRemoved = true;
  if (globalThis.document !== undefined) {
    globalThis.document.documentElement.classList.remove("light", "dark");
  }
}, 5_000);

if (testRoot === frontendRoot) {
  const frontendRequire = createRequire(
    new URL("../packages/frontend/package.json", import.meta.url),
  );
  const { GlobalRegistrator } = await import(
    frontendRequire.resolve("@happy-dom/global-registrator")
  );

  if (globalThis.document === undefined) {
    // DOM fixtures must not load pages from the network.
    GlobalRegistrator.register({
      settings: { navigation: { disableChildFrameNavigation: true } },
    });
    // Electron and the web app open an HTML5 document. Happy DOM starts without a doctype
    // or compatMode, so give its document the same standards mode as those entry pages.
    const document = globalThis.window.document;
    document.prepend(document.implementation.createDocumentType("html", "", ""));
    Object.defineProperty(document, "compatMode", {
      configurable: true,
      get: () => (document.doctype ? "CSS1Compat" : "BackCompat"),
    });
  }

  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
    writable: true,
  });

  const libraryPath = frontendRequire.resolve("@testing-library/react");
  const pureLibraryPath = frontendRequire.resolve("@testing-library/react/pure");
  const sonnerPath = Bun.resolveSync("sonner", frontendRoot);

  // Run cleanup on each Bun repeat without loading Testing Library for files that do not use it.
  afterEach((): void => {
    const library = frontendRequire.cache[libraryPath] ?? frontendRequire.cache[pureLibraryPath];
    library?.exports.cleanup();
    document.body.replaceChildren();
    // Sonner replays active toasts to the next mounted toaster.
    frontendRequire.cache[sonnerPath]?.exports.toast.dismiss();
    localStorage.clear();
    sessionStorage.clear();
  }, 5_000);
}
