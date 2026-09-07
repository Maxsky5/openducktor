import { strict as assert } from "node:assert";
import { performance } from "node:perf_hooks";
import { hashWorktreeDiffPayload } from "../../packages/host/src/application/git/git-worktree-snapshot";

assert.equal(hashWorktreeDiffPayload([]), "a8c7f832281a39c5");
assert.equal(
  hashWorktreeDiffPayload([{ file: "é", type: "added", additions: 1, deletions: 0, diff: "😀\0" }]),
  "978201f2ee1c6d62",
);

const median = (samples: number[]): number =>
  [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;
console.log(
  JSON.stringify({ platform: process.platform, arch: process.arch, versions: process.versions }),
);
for (const mib of [1, 5, 10]) {
  const line = "@@ -1 +1 @@\n-old value\n+new value\n";
  const bytes = mib * 1024 * 1024;
  const diff = line.repeat(Math.ceil(bytes / line.length)).slice(0, bytes);
  const payload = [{ file: "synthetic.ts", type: "modified", additions: 1, deletions: 1, diff }];
  const expected = hashWorktreeDiffPayload(payload);
  const durations: number[] = [];
  for (let sample = 0; sample < 5; sample += 1) {
    const start = performance.now();
    const digest = hashWorktreeDiffPayload(payload);
    durations.push(performance.now() - start);
    assert.equal(digest, expected);
  }
  // Separate experiment: elapsed time until a queued immediate runs, with and without hashing.
  const delays: number[] = [];
  const idleDelays: number[] = [];
  for (let sample = 0; sample < 5; sample += 1) {
    for (const hashing of [false, true]) {
      const start = performance.now();
      const pending = new Promise<number>((resolve) =>
        setImmediate(() => resolve(performance.now() - start)),
      );
      if (hashing) assert.equal(hashWorktreeDiffPayload(payload), expected);
      (hashing ? delays : idleDelays).push(await pending);
    }
  }
  console.log(
    JSON.stringify({
      mib,
      digest: expected,
      hashMedianMs: median(durations),
      queuedCallbackMedianMs: median(delays),
      idleCallbackMedianMs: median(idleDelays),
    }),
  );
}
