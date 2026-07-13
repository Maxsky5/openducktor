import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { runElectronEffect } from "../src/effect/electron-boundary";
import { prepareNodePtyEffect } from "./prepare-node-pty";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const electronExecutablePath = electronPath as unknown as string;
await runElectronEffect(prepareNodePtyEffect());
const output = join(packageRoot, "dist", "node-pty-adapter-conformance.mjs");
const result = await Bun.build({
  entrypoints: [join(packageRoot, "scripts", "node-pty-adapter-conformance.ts")],
  external: ["node-pty"],
  format: "esm",
  naming: "node-pty-adapter-conformance.mjs",
  outdir: join(packageRoot, "dist"),
  target: "node",
});
if (!result.success) {
  throw new AggregateError(result.logs, "Failed to bundle the node-pty adapter conformance.");
}

const child = Bun.spawn([electronExecutablePath, output], {
  cwd: packageRoot,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  stderr: "inherit",
  stdout: "inherit",
});
const exitCode = await child.exited;
if (exitCode !== 0) {
  throw new Error(`node-pty adapter conformance exited with code ${exitCode}.`);
}
