import { mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import {
  assertDevelopmentConfigAllowed,
  resolveOpenDucktorBaseDir,
  type OpenDucktorConfigDirScope,
} from "../openducktor-config-dir";

const productionRoot = resolveOpenDucktorBaseDir("production", {});
const alias = path.join(path.dirname(productionRoot), "production-alias");
await mkdir(productionRoot);
await symlink(productionRoot, alias, "junction");

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

console.log(
  JSON.stringify({
    direct: launch("dev", { OPENDUCKTOR_CONFIG_DIR: "~/.openducktor" }),
    alias: launch("dev", { OPENDUCKTOR_CONFIG_DIR: alias }),
    acknowledged: launch("dev", { OPENDUCKTOR_CONFIG_DIR: alias }, true),
    defaultDevelopment: launch("dev", {}),
    isolated: launch("dev", { OPENDUCKTOR_CONFIG_DIR: "~/.openducktor-local" }),
    production: launch("production", {}),
  }),
);
