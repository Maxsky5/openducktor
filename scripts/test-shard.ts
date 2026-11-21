import { availableParallelism } from "node:os";
import path from "node:path";

import { readPackageScripts, workspacePackageJsonPaths } from "./workspace-packages";

// `bun run --sequential` does not pass arguments to the scripts, so this script starts each test
// suite with its shard itself. See docs/testing.md.

export type TestSuite = { directory: string; script: string; command: string };
export type Shard = { index: number; total: number };
export type SuiteRun = { directory: string; script: string; args: string[][] };

export const parseShard = (value: string | undefined): Shard => {
  const match = /^(\d+)\/(\d+)$/.exec(value ?? "");
  const index = Number(match?.[1]);
  const total = Number(match?.[2]);
  if (!match || index < 1 || index > total) {
    throw new Error(`Give the shard as <index>/<total>, such as 1/3. Received '${value ?? ""}'.`);
  }
  return { index, total };
};

// `bun run` adds the shard argument to the end of the script, so the script must be one command.
const isSingleCommand = (command: string): boolean => !/&&|\|\||;/.test(command);
const isBunTest = (command: string): boolean =>
  /^bun test(\s|$)/.test(command) && isSingleCommand(command);
// The Node test runner does not take the `--shard` option of `bun test`.
const isNodeTest = (command: string): boolean =>
  /^node .*--test\b/.test(command) && isSingleCommand(command);

export const planShardRuns = (
  suites: TestSuite[],
  shard: Shard,
  cpuCount = availableParallelism(),
): SuiteRun[] =>
  suites.flatMap(({ directory, script, command }) => {
    if (isBunTest(command)) {
      const fullFrontend = directory === path.join("packages", "frontend") && shard.total === 1;
      const count = fullFrontend ? Math.min(3, Math.max(1, Math.floor(cpuCount / 2))) : 1;
      const args = Array.from({ length: count }, (_, index) => [
        `--shard=${shard.index + index}/${Math.max(shard.total, count)}`,
      ]);
      return [{ directory, script, args }];
    }
    if (isNodeTest(command)) {
      return shard.index === 1 ? [{ directory, script, args: [[]] }] : [];
    }
    throw new Error(
      `The '${script}' script of '${directory}' must be one 'bun test' or 'node --test' command. Received '${command}'.`,
    );
  });

// The workspace suites, then the root script suite.
const readTestSuites = (): TestSuite[] => {
  const suites = workspacePackageJsonPaths().flatMap((manifest) => {
    const command = readPackageScripts(manifest).test;
    return command ? [{ directory: path.dirname(manifest), script: "test", command }] : [];
  });
  const rootCommand = readPackageScripts("package.json")["test:scripts"];
  if (!rootCommand) throw new Error("The root package.json has no `test:scripts` script.");
  return [...suites, { directory: ".", script: "test:scripts", command: rootCommand }];
};

if (import.meta.main) {
  const runs = planShardRuns(readTestSuites(), parseShard(process.argv[2]));
  const failed: string[] = [];
  for (const { directory, script, args } of runs) {
    console.log(`Testing ${directory} (${script})`);
    const exitCodes = await Promise.all(
      args.map(
        (options) =>
          Bun.spawn(["bun", "run", script, ...options], {
            cwd: directory,
            stdio: ["inherit", "inherit", "inherit"],
          }).exited,
      ),
    );
    if (exitCodes.some((code) => code !== 0)) failed.push(directory);
  }
  if (failed.length > 0) {
    console.error(
      `These test suites failed: ${failed.join(", ")}. Fix them and run the shard again.`,
    );
    process.exitCode = 1;
  }
}
