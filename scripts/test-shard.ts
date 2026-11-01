import { readFileSync } from "node:fs";
import path from "node:path";

import { collectWorkspacePackageJsonPaths } from "./release-version";

// `bun run --sequential` does not pass arguments to the scripts, so this script starts each test
// suite with its shard itself. See docs/testing.md.

export type TestSuite = { directory: string; script: string; command: string };
export type Shard = { index: number; total: number };
export type SuiteRun = { directory: string; script: string; args: string[] };

export const parseShard = (value: string | undefined): Shard => {
  const match = /^(\d+)\/(\d+)$/.exec(value ?? "");
  const index = Number(match?.[1]);
  const total = Number(match?.[2]);
  if (!match || index < 1 || index > total) {
    throw new Error(`Give the shard as <index>/<total>, such as 1/3. Received '${value ?? ""}'.`);
  }
  return { index, total };
};

// Other test runners do not take the `--shard` option of `bun test`.
export const planShardRuns = (suites: TestSuite[], shard: Shard): SuiteRun[] =>
  suites.flatMap(({ directory, script, command }) => {
    if (command.startsWith("bun test ")) {
      return [{ directory, script, args: [`--shard=${shard.index}/${shard.total}`] }];
    }
    return shard.index === 1 ? [{ directory, script, args: [] }] : [];
  });

const readScripts = (manifestPath: string): Record<string, string> =>
  JSON.parse(readFileSync(manifestPath, "utf8")).scripts ?? {};

// The workspace suites, then the root script suite.
const readTestSuites = (): TestSuite[] => {
  const [rootManifest = "package.json", ...workspaceManifests] = collectWorkspacePackageJsonPaths();
  const suites = workspaceManifests.flatMap((manifest) => {
    const command = readScripts(manifest).test;
    return command ? [{ directory: path.dirname(manifest), script: "test", command }] : [];
  });
  const rootCommand = readScripts(rootManifest)["test:scripts"];
  if (!rootCommand) throw new Error("The root package.json has no `test:scripts` script.");
  return [...suites, { directory: ".", script: "test:scripts", command: rootCommand }];
};

if (import.meta.main) {
  const runs = planShardRuns(readTestSuites(), parseShard(process.argv[2]));
  const failed: string[] = [];
  for (const { directory, script, args } of runs) {
    console.log(`Testing ${directory} (${script})`);
    const result = Bun.spawnSync(["bun", "run", script, ...args], {
      cwd: directory,
      stdio: ["inherit", "inherit", "inherit"],
    });
    if (result.exitCode !== 0) failed.push(directory);
  }
  if (failed.length > 0) {
    console.error(
      `These test suites failed: ${failed.join(", ")}. Fix them and run the shard again.`,
    );
    process.exitCode = 1;
  }
}
