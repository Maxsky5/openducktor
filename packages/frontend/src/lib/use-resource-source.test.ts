import { test } from "bun:test";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// The fixture owns DOM and URL globals in a child, outside parallel frontend tests.
test("resource views share reads, own URLs, cancel the last read and recover with a new generation", async () => {
  await promisify(execFile)(
    process.execPath,
    [fileURLToPath(new URL("./resource-source-lifecycle.fixture.tsx", import.meta.url))],
    { timeout: 10_000 },
  );
}, 15_000);
