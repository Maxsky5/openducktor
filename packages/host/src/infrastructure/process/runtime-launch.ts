import { readFileSync } from "node:fs";
import path from "node:path";
import type { ManagedProcess } from "../../ports/process-inspector-port";
import {
  createProcessCommandLaunch,
  type ProcessCommandLaunchPlan,
} from "./process-command-launch";

export type RuntimeLaunchPlan = ProcessCommandLaunchPlan & {
  /** How the Processes view treats the spawned child. */
  managed: ManagedProcess;
};

/** A Windows npm `.cmd` shim. */
export type NpmShim = {
  /**
   * True when the shim text names a package file, such as `\@openai\codex\bin\codex.js`. Two
   * packages can install a shim with the same name, so the text decides. The check ignores case.
   */
  runs(packageFile: string): boolean;
  /**
   * The `node_modules` folders that the shim serves. A global shim sits in the npm prefix, beside
   * `node_modules`. A local shim sits in `node_modules/.bin`.
   */
  moduleRoots: string[];
};

type NativeRuntime = { executablePath: string; env: NodeJS.ProcessEnv };

/** The native binary behind a shim of one runtime package, or null for any other shim. */
export type NpmShimResolver = (
  shim: NpmShim,
  env: NodeJS.ProcessEnv,
  arch: NodeJS.Architecture,
) => NativeRuntime | null;

export const readNpmShim = (shimPath: string): NpmShim => {
  const text = readFileSync(shimPath, "utf8").replaceAll("/", "\\").toLowerCase();
  const shimDirectory = path.dirname(shimPath);
  const parent = path.dirname(shimDirectory);
  const moduleRoots = [path.join(shimDirectory, "node_modules")];
  if (path.basename(shimDirectory) === ".bin" && path.basename(parent) === "node_modules")
    moduleRoots.push(parent);
  return { runs: (packageFile) => text.includes(packageFile.toLowerCase()), moduleRoots };
};

/** The `node_modules` folders that Node searches for a package required from `directory`. */
export const nodeModulesLookup = (directory: string): string[] => {
  const lookup: string[] = [];
  for (let current = directory; ; current = path.dirname(current)) {
    if (path.basename(current) !== "node_modules") lookup.push(path.join(current, "node_modules"));
    if (path.dirname(current) === current) return lookup;
  }
};

/**
 * The launch plan of an agent runtime. On Windows, the runtime adapter resolves its npm shim to
 * the native binary, so the host starts that binary and knows the PID of the runtime itself. Any
 * other batch launcher runs through `cmd.exe` and can start the runtime several levels down.
 */
export const createRuntimeLaunch = (
  executablePath: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  resolveNpmShim: NpmShimResolver,
): RuntimeLaunchPlan => {
  const native =
    platform === "win32" && /\.cmd$/iu.test(executablePath)
      ? resolveNpmShim(readNpmShim(executablePath), env, process.arch)
      : null;
  const launch = createProcessCommandLaunch(
    native?.executablePath ?? executablePath,
    args,
    native?.env ?? env,
    platform,
  );
  return {
    ...launch,
    managed: launch.usesCommandShell ? { kind: "runtime_launcher" } : { kind: "runtime" },
  };
};
