import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OPENDUCKTOR_DEV_INSTANCE_ENV, resolveDevelopmentInstanceId } from "@openducktor/host";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(packageRoot, "../..");
const nodeRequire = createRequire(import.meta.url);

export const electronPreviewEnvironment = (
  env: NodeJS.ProcessEnv,
  root: string,
): NodeJS.ProcessEnv => {
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...runtimeEnv } = env;
  return {
    ...runtimeEnv,
    [OPENDUCKTOR_DEV_INSTANCE_ENV]: resolveDevelopmentInstanceId("electron", root),
  };
};

export const main = async (): Promise<number> => {
  const electronExecutablePath = String(nodeRequire("electron"));
  const subprocess = Bun.spawn([electronExecutablePath, "dist/main.js"], {
    cwd: packageRoot,
    env: electronPreviewEnvironment(process.env, workspaceRoot),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return subprocess.exited;
};

if (import.meta.main) {
  process.exit(await main());
}
