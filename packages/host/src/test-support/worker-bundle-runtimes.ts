import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export type WorkerBundleRuntime = {
  name: string;
  command: string;
  env?: Record<string, string>;
};

const electronManifest = fileURLToPath(
  new URL("../../../../apps/electron/package.json", import.meta.url),
);

/** The runtimes that load the shipped worker bundles: Node, Bun, and Electron in Node mode. */
export const workerBundleRuntimes = (): WorkerBundleRuntime[] => {
  const node = Bun.which("node");
  if (node === null) throw new Error("The worker bundle test needs Node on PATH.");
  const bun = Bun.which("bun");
  if (bun === null) throw new Error("The worker bundle test needs Bun on PATH.");
  const electron: string = createRequire(electronManifest)("electron");
  return [
    { name: "Node", command: node },
    { name: "Bun", command: bun },
    { name: "Electron", command: electron, env: { ELECTRON_RUN_AS_NODE: "1" } },
  ];
};

/** Runs a worker bundle fixture under one runtime and returns its standard output. */
export const runWorkerBundle = (
  runtime: WorkerBundleRuntime,
  fixturePath: string,
  workerPath: string,
): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      runtime.command,
      [fixturePath, workerPath],
      { env: { ...process.env, ...runtime.env }, timeout: 30_000 },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(
            new Error(
              `The worker bundle failed under ${runtime.name}.\n${stderr.trim()}\n${error.message}`,
              { cause: error },
            ),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
