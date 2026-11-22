import { mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import {
  assertDevelopmentConfigAllowed,
  resolveOpenDucktorBaseDir,
  type OpenDucktorConfigDirScope,
} from "../openducktor-config-dir";

const productionRoot = resolveOpenDucktorBaseDir("production", {});
const homeDir = path.dirname(productionRoot);
const alias = path.join(homeDir, "production-alias");
const isolatedRoot = path.join(homeDir, ".openducktor-local");
const [filesystemAlias] = process.argv.slice(2);

const launch = (
  scope: OpenDucktorConfigDirScope,
  env: NodeJS.ProcessEnv,
  allowProductionConfig = false,
) => {
  try {
    assertDevelopmentConfigAllowed(scope, allowProductionConfig, env);
    return null;
  } catch (cause) {
    return cause instanceof Error ? cause.message : String(cause);
  }
};

const directBeforeCreation = launch("dev", { OPENDUCKTOR_CONFIG_DIR: productionRoot });
const filesystemAliasBeforeCreation =
  filesystemAlias && launch("dev", { OPENDUCKTOR_CONFIG_DIR: filesystemAlias });
const isolatedBeforeCreation =
  filesystemAlias &&
  launch("dev", {
    OPENDUCKTOR_CONFIG_DIR: path.join(path.dirname(filesystemAlias), "isolated", ".openducktor"),
  });
await mkdir(productionRoot);
await mkdir(isolatedRoot);
await symlink(productionRoot, alias, "junction");

console.log(
  JSON.stringify({
    directBeforeCreation,
    direct: launch("dev", { OPENDUCKTOR_CONFIG_DIR: "~/.openducktor" }),
    alias: launch("dev", { OPENDUCKTOR_CONFIG_DIR: alias }),
    acknowledged: launch("dev", { OPENDUCKTOR_CONFIG_DIR: alias }, true),
    defaultDevelopment: launch("dev", {}),
    isolated: launch("dev", { OPENDUCKTOR_CONFIG_DIR: isolatedRoot }),
    production: launch("production", {}),
    ...(filesystemAlias && {
      filesystemAliasBeforeCreation,
      isolatedBeforeCreation,
      filesystemAlias: launch("dev", { OPENDUCKTOR_CONFIG_DIR: filesystemAlias }),
    }),
  }),
);
