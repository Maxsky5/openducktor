import { existsSync } from "node:fs";
import path from "node:path";
import type { NpmShimResolver } from "../../infrastructure/process/runtime-launch";

/** The OpenCode 2 shim runs `@opencode/cli/bin/opencode.exe`, which is the binary itself. */
export const resolveOpenCodeNpmShim: NpmShimResolver = (shim, env) => {
  if (!shim.runs("\\@opencode\\cli\\bin\\opencode.exe")) return null;
  const executablePath = shim.moduleRoots
    .map((root) => path.join(root, "@opencode", "cli", "bin", "opencode.exe"))
    .find((candidate) => existsSync(candidate));
  return executablePath ? { executablePath, env } : null;
};
