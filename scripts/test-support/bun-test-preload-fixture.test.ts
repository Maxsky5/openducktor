import { expect, test } from "bun:test";
import { tmpdir } from "node:os";

test("uses a temporary config directory", () => {
  const configDir = process.env.OPENDUCKTOR_CONFIG_DIR;
  const workerTmpDir = process.env.TMPDIR;
  expect(configDir).toBeTruthy();
  expect(workerTmpDir).toBeTruthy();
  expect(tmpdir()).toBe(workerTmpDir);
  console.log(`test config: ${configDir}`);
  console.log(`worker tmp: ${workerTmpDir}`);
});
