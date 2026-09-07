import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { FileStatus } from "@openducktor/contracts";
import { Effect } from "effect";
import {
  createDefaultGitRunner,
  type GitCommandRunner,
} from "../src/infrastructure/git/git-command-runner";
import { buildFileDiffs } from "../src/infrastructure/git/git-diff";

const exec = promisify(execFile);
const baseline = process.argv[2] ?? "5fa09d3dc0936ffc091b394e6a09adcb7e33de2b";
const sourceDirectory = path.resolve(import.meta.dir, "../src/infrastructure/git");
const baselineDiff = path.join(sourceDirectory, `.benchmark-diff-${process.pid}.ts`);
const baselineRunner = path.join(sourceDirectory, `.benchmark-runner-${process.pid}.ts`);
const root = await mkdtemp(path.join(tmpdir(), "odt-diff-benchmark-"));

try {
  for (const [name, destination] of [
    ["git-diff", baselineDiff],
    ["git-command-runner", baselineRunner],
  ]) {
    const { stdout } = await exec(
      "git",
      ["show", `${baseline}:packages/host/src/infrastructure/git/${name}.ts`],
      { cwd: sourceDirectory },
    );
    await writeFile(destination!, stdout);
  }
  const before: typeof import("../src/infrastructure/git/git-diff") = await import(baselineDiff);
  const oldRunner: typeof import("../src/infrastructure/git/git-command-runner") = await import(
    baselineRunner
  );
  const measure = async (
    build: typeof buildFileDiffs,
    runner: GitCommandRunner,
    statuses: FileStatus[],
  ) => {
    let calls = 0;
    let active = 0;
    let peak = 0;
    const counted: GitCommandRunner = (directory, args, options) =>
      Effect.gen(function* () {
        calls += 1;
        active += 1;
        peak = Math.max(peak, active);
        return yield* runner(directory, args, options).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              active -= 1;
            }),
          ),
        );
      });
    const start = performance.now();
    const result = await Effect.runPromise(build(counted, root, statuses, "", ""));
    return { milliseconds: performance.now() - start, calls, peak, result };
  };
  const old = oldRunner.createDefaultGitRunner(process.env, { command: "git" });
  const current = createDefaultGitRunner(process.env, { command: "git" });
  const rows = [];
  for (const count of [0, 1, 100]) {
    const statuses: FileStatus[] = [];
    for (let index = 0; index < count; index += 1) {
      const file = `generated-${index}.txt`;
      const content =
        index % 10 === 1 ? "" : index % 10 === 2 ? "\0binary" : `line ${index}\n`.repeat(100);
      await writeFile(path.join(root, file), content);
      statuses.push({ path: file, status: "untracked", staged: false });
    }
    // Warm each implementation, then alternate order across seven measured pairs.
    await measure(before.buildFileDiffs, old, statuses);
    await measure(buildFileDiffs, current, statuses);
    for (let iteration = 0; iteration < 7; iteration += 1) {
      const runBefore = () => measure(before.buildFileDiffs, old, statuses);
      const runAfter = () => measure(buildFileDiffs, current, statuses);
      const [first, second] =
        iteration % 2 === 0
          ? [await runBefore(), await runAfter()]
          : [await runAfter(), await runBefore()];
      const [prior, next] = iteration % 2 === 0 ? [first, second] : [second, first];
      assert.deepEqual(next.result, prior.result);
      rows.push({
        files: count,
        iteration,
        before: { milliseconds: prior.milliseconds, calls: prior.calls, peak: prior.peak },
        after: { milliseconds: next.milliseconds, calls: next.calls, peak: next.peak },
      });
    }
  }
  console.log(
    JSON.stringify(
      {
        baseline,
        platform: process.platform,
        bun: Bun.version,
        git: (await exec("git", ["--version"])).stdout.trim(),
        fullResultsEqual: true,
        rows,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(root, { recursive: true, force: true });
  await rm(baselineDiff, { force: true });
  await rm(baselineRunner, { force: true });
}
