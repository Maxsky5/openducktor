import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { prependPathEntry } from "../../infrastructure/process/process-environment";
import {
  type NpmShimResolver,
  nodeModulesLookup,
} from "../../infrastructure/process/runtime-launch";

/** The Rust target of the Codex binary for a Windows architecture, like `codex.js`. */
const codexTarget = (arch: NodeJS.Architecture): string | null => {
  if (arch === "x64") return "x86_64-pc-windows-msvc";
  if (arch === "arm64") return "aarch64-pc-windows-msvc";
  return null;
};

const CODEX_PACKAGE_MANAGER_VARIABLES = [
  "CODEX_MANAGED_BY_NPM",
  "CODEX_MANAGED_BY_BUN",
  "CODEX_MANAGED_BY_PNPM",
  "CODEX_MANAGED_BY_VITE_PLUS",
];

/** The binary of a Codex platform folder, and the folder that holds its helper tools. */
const codexBinaryLayouts = (targetFolder: string) => [
  {
    binary: path.join(targetFolder, "bin", "codex.exe"),
    tools: path.join(targetFolder, "codex-path"),
  },
  // Releases up to 0.132 use this layout.
  { binary: path.join(targetFolder, "codex", "codex.exe"), tools: path.join(targetFolder, "path") },
];

/**
 * The binary that `@openai/codex/bin/codex.js` spawns, with the environment that it sets. The
 * script finds the vendored binary in the `@openai/codex-win32-<arch>` package that Node resolves
 * from the script, or else in its own package. Null when no binary is there, so the shim runs and
 * reports the install problem itself.
 */
export const resolveCodexNpmShim: NpmShimResolver = (shim, env, arch) => {
  const target = codexTarget(arch);
  if (!target || !shim.runs("\\@openai\\codex\\bin\\codex.js")) return null;
  const modules = shim.moduleRoots.find((root) =>
    existsSync(path.join(root, "@openai", "codex", "bin", "codex.js")),
  );
  if (!modules) return null;
  const packageRoot = realpathSync(path.join(modules, "@openai", "codex"));
  const platformPackage = nodeModulesLookup(path.join(packageRoot, "bin"))
    .map((lookup) => path.join(lookup, "@openai", `codex-win32-${arch}`))
    .find((candidate) => existsSync(path.join(candidate, "package.json")));
  const layout = codexBinaryLayouts(
    path.join(platformPackage ?? packageRoot, "vendor", target),
  ).find((candidate) => existsSync(candidate.binary));
  if (!layout) return null;
  let codexEnv: NodeJS.ProcessEnv = { ...env, CODEX_MANAGED_PACKAGE_ROOT: packageRoot };
  // Older scripts put the helper tools, such as `rg.exe`, first on the search path. Newer
  // binaries find the folder themselves.
  if (existsSync(layout.tools)) codexEnv = prependPathEntry(codexEnv, layout.tools, "win32");
  for (const name of CODEX_PACKAGE_MANAGER_VARIABLES) delete codexEnv[name];
  // pnpm writes `.modules.yaml` into each `node_modules` folder that it owns.
  const manager = existsSync(path.join(modules, ".modules.yaml")) ? "PNPM" : "NPM";
  codexEnv[`CODEX_MANAGED_BY_${manager}`] = "1";
  return { executablePath: layout.binary, env: codexEnv };
};
