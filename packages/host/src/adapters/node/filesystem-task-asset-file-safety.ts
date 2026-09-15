import { realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import {
  type OpenDucktorConfigDirScope,
  resolveOpenDucktorBaseDir,
} from "../../config/openducktor-config-dir";

export const createTaskAssetFileSafety = ({
  configDir,
  configDirScope,
}: {
  configDir: string;
  configDirScope: OpenDucktorConfigDirScope;
}) => {
  const productionRoot =
    configDirScope === "test" ? resolveSymlinks(resolveOpenDucktorBaseDir("production", {})) : null;
  const assertPathAllowed = (target: string): void => {
    if (productionRoot !== null && isWithin(productionRoot, resolveSymlinks(target))) {
      throw new Error(
        `Test scope refuses task asset access under the production config directory ${productionRoot}.`,
      );
    }
  };
  return {
    assertConfigDir: () => assertPathAllowed(configDir),
    removeRecursively: async (target: string): Promise<void> => {
      assertPathAllowed(target);
      await rm(target, { force: true, recursive: true });
    },
  };
};

function isWithin(directory: string, target: string): boolean {
  const relative = path.relative(directory, target);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
}

function resolveSymlinks(target: string, tail: string[] = []): string {
  const fullPath = path.resolve(target);
  try {
    return path.join(realpathSync.native(fullPath), ...tail);
  } catch (cause) {
    if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) {
      throw cause;
    }
    const parent = path.dirname(fullPath);
    if (parent === fullPath) {
      throw cause;
    }
    return resolveSymlinks(parent, [path.basename(fullPath), ...tail]);
  }
}
