import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

export const checkWorkerBundles = (scriptUrl, artifactName) => {
  const script = fileURLToPath(scriptUrl);
  const electron = createRequire(new URL("../apps/electron/package.json", import.meta.url))(
    "electron",
  );
  for (const [runtime, artifact] of [
    [process.execPath, `apps/electron/dist/${artifactName}`],
    [process.execPath, `packages/openducktor-web/dist/${artifactName}`],
    ["bun", `packages/openducktor-web/dist/${artifactName}`],
    [electron, `apps/electron/dist/${artifactName}`],
  ]) {
    const result = spawnSync(runtime, [script, resolve(root, artifact)], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "inherit",
      timeout: 5000,
    });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `Worker bundle check failed under ${runtime}`);
  }
};
