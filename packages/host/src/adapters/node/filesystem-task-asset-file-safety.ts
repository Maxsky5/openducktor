import { realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import {
  type OpenDucktorConfigDirScope,
  resolveOpenDucktorBaseDir,
} from "../../config/openducktor-config-dir";

const isWithinDirectory = (directory: string, target: string): boolean => {
  const relative = path.relative(directory, target);
  return (
    relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  );
};

const resolvePathThroughExistingAncestor = (
  inputPath: string,
  missingSegments: string[] = [],
): string => {
  const absolutePath = path.resolve(inputPath);
  try {
    return path.join(realpathSync.native(absolutePath), ...missingSegments);
  } catch (cause) {
    if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) {
      throw cause;
    }
    const parentPath = path.dirname(absolutePath);
    if (parentPath === absolutePath) {
      throw cause;
    }
    return resolvePathThroughExistingAncestor(parentPath, [
      path.basename(absolutePath),
      ...missingSegments,
    ]);
  }
};

export const createTaskAssetFileSafety = ({
  configDir,
  configDirScope,
}: {
  configDir: string;
  configDirScope: OpenDucktorConfigDirScope;
}) => {
  const productionConfigDir =
    configDirScope === "test"
      ? resolvePathThroughExistingAncestor(resolveOpenDucktorBaseDir("production", {}))
      : null;
  const assertProductionConfigIsNotUsedByTests = (target: string): void => {
    if (
      productionConfigDir !== null &&
      isWithinDirectory(productionConfigDir, resolvePathThroughExistingAncestor(target))
    ) {
      throw new Error(
        `Test scope refuses task asset access under the production config directory ${productionConfigDir}.`,
      );
    }
  };
  return {
    assertConfigDirAllowed: () => assertProductionConfigIsNotUsedByTests(configDir),
    removeRecursively: async (target: string): Promise<void> => {
      assertProductionConfigIsNotUsedByTests(target);
      await rm(target, { force: true, recursive: true });
    },
  };
};
