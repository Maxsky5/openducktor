import { readFileSync } from "node:fs";
import path from "node:path";

// Runs one CI shard of the tests: each workspace suite and the root script suite, in sequence, on
// a part of their files. `bun run --sequential` does not pass arguments to the scripts, so this
// script starts each suite itself. It runs every suite before it reports the failed ones.

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

// `bun test` runs its part of the files. Other test runners do not take the `--shard` option, so
// the first shard runs all their files.
export const planShardRuns = (suites: TestSuite[], shard: Shard): SuiteRun[] =>
  suites.flatMap(({ directory, script, command }) => {
    if (command.startsWith("bun test ")) {
      return [{ directory, script, args: [`--shard=${shard.index}/${shard.total}`] }];
    }
    return shard.index === 1 ? [{ directory, script, args: [] }] : [];
  });

type PackageManifest = { workspaces?: string[]; scripts?: Record<string, string> };

const readManifest = (directory: string): PackageManifest =>
  JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));

const readTestSuites = (root: string): TestSuite[] => {
  const manifest = readManifest(root);
  const directories = (manifest.workspaces ?? [])
    .flatMap((pattern) => [...new Bun.Glob(`${pattern}/package.json`).scanSync({ cwd: root })])
    .map((file) => path.dirname(file))
    .sort();
  const suites = directories.flatMap((directory) => {
    const command = readManifest(path.join(root, directory)).scripts?.test;
    return command ? [{ directory, script: "test", command }] : [];
  });
  const rootCommand = manifest.scripts?.["test:scripts"];
  if (!rootCommand) throw new Error("The root package.json has no `test:scripts` script.");
  return [...suites, { directory: ".", script: "test:scripts", command: rootCommand }];
};

if (import.meta.main) {
  const root = path.resolve(import.meta.dir, "..");
  const runs = planShardRuns(readTestSuites(root), parseShard(process.argv[2]));
  const failed: string[] = [];
  for (const { directory, script, args } of runs) {
    console.log(`Testing ${directory} (${script})`);
    const result = Bun.spawnSync(["bun", "run", script, ...args], {
      cwd: path.join(root, directory),
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
