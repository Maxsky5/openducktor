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

export const createTaskAssetFileSafety = ({
  configDir,
  configDirScope,
}: {
  configDir: string;
  configDirScope: OpenDucktorConfigDirScope;
}) => {
  const productionConfigDir = path.resolve(resolveOpenDucktorBaseDir("production", {}));
  const assertProductionConfigIsNotUsedByTests = (target: string): void => {
    if (configDirScope === "test" && isWithinDirectory(productionConfigDir, path.resolve(target))) {
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
