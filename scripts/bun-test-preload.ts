import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const configDir = await mkdtemp(path.join(tmpdir(), "openducktor-test-"));
process.env.OPENDUCKTOR_CONFIG_DIR = configDir;
process.once("beforeExit", () => {
  void rm(configDir, { force: true, recursive: true });
});

const frontendRoot = path.resolve(import.meta.dir, "../packages/frontend");
if (path.resolve(process.cwd()) === frontendRoot) {
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
