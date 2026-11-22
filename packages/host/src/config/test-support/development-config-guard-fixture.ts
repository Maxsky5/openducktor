import { mkdir, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { errorMessage } from "../../effect/host-errors";
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
  configDir?: string,
  {
    allowProductionConfig = false,
    scope = "dev",
  }: { allowProductionConfig?: boolean; scope?: OpenDucktorConfigDirScope } = {},
): string | null => {
  try {
    assertDevelopmentConfigAllowed(scope, allowProductionConfig, {
      OPENDUCKTOR_CONFIG_DIR: configDir,
    });
    return null;
  } catch (cause) {
    return errorMessage(cause);
  }
};

const directBeforeCreation = launch(productionRoot);
const caseAliasBeforeCreation = launch(path.join(homeDir, ".OPENDUCKTOR"));
const beforeCreationAliasResults = filesystemAlias
  ? {
      filesystemAliasBeforeCreation: launch(filesystemAlias),
      isolatedBeforeCreation: launch(
        path.join(path.dirname(filesystemAlias), "isolated", ".openducktor"),
      ),
    }
  : {};
const targetName = filesystemAlias ? "caf\u00e9" : "config-target";
const target = path.join(homeDir, targetName);
await symlink(process.platform === "win32" ? target : targetName, productionRoot, "junction");
const danglingTarget = launch(target);
const unicodeAliasResults = filesystemAlias
  ? {
      unicodeAlias: launch(path.join(homeDir, targetName.normalize("NFD"))),
      unicodeCaseAlias: launch(path.join(homeDir, targetName.toUpperCase().normalize("NFD"))),
    }
  : {};
await rm(productionRoot);
const caseFoldResults: Record<string, string | null> = {};
if (filesystemAlias) {
  const cases = [
    ["sigmaCaseAlias", "\u03c3", "\u03c2"],
    ["expandedCaseAlias", "\u00df", "SS"],
    ["distinctUnicodeName", "\u0131", "I"],
  ] as const;
  for (const [key, destination, alternate] of cases) {
    await symlink(destination, productionRoot, "junction");
    caseFoldResults[key] = launch(path.join(homeDir, alternate));
    await rm(productionRoot);
  }
}
await mkdir(productionRoot);
await mkdir(isolatedRoot);
await symlink(productionRoot, alias, "junction");

console.log(
  JSON.stringify({
    directBeforeCreation,
    caseAliasBeforeCreation,
    danglingTarget,
    direct: launch("~/.openducktor"),
    alias: launch(alias),
    acknowledged: launch(alias, { allowProductionConfig: true }),
    defaultDevelopment: launch(),
    isolated: launch(isolatedRoot),
    production: launch(undefined, { scope: "production" }),
    ...beforeCreationAliasResults,
    ...unicodeAliasResults,
    ...caseFoldResults,
    ...(filesystemAlias && { filesystemAlias: launch(filesystemAlias) }),
  }),
);
