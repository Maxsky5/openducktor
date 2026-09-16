import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const configDir = await mkdtemp(path.join(tmpdir(), "openducktor-test-"));
process.env.OPENDUCKTOR_CONFIG_DIR = configDir;
const { afterAll } = await import("bun:test");
afterAll(async () => {
  await rm(configDir, { force: true, recursive: true });
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

  const { afterEach } = await import("bun:test");
  const { cleanup } = await import(frontendRequire.resolve("@testing-library/react"));

  afterEach((): void => {
    cleanup();
  });
}
