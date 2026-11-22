import path from "node:path";
import { Effect } from "effect";
import { codexRootOfFirstLine } from "./usage-codex-records";
import { readFirstJsonlLine } from "./usage-jsonl-reader";
import type { UsageParseJob } from "./usage-worker-protocol";

/**
 * The session of a Claude transcript from its path: `<session>.jsonl`, or a subagent file in
 * `<session>/subagents/`.
 */
export const claudeSessionOf = (file: string): string => {
  const folder = path.dirname(file);
  return path.basename(folder) === "subagents"
    ? path.basename(path.dirname(folder))
    : path.basename(file, ".jsonl");
};

/** Reads at most this many rollout heads at once. */
const HEAD_READS = 8;

/**
 * Names the root session of each Codex rollout from its first line, by its index in `jobs`. A
 * rollout whose first line cannot be read counts as its own session; its parse reports the
 * problem.
 */
export const readCodexSessions = (
  jobs: readonly UsageParseJob[],
  sessionOf: (jobIndex: number, session: string) => void,
): Effect.Effect<void> =>
  Effect.promise(async () => {
    const indexes = jobs.flatMap((job, index) => (job.runtime === "codex" ? [index] : []));
    let next = 0;
    const reader = async () => {
      for (let index = indexes[next++]; index !== undefined; index = indexes[next++]) {
        const job = jobs[index];
        if (!job) continue;
        const line = await readFirstJsonlLine(job.path, job.format === "jsonl_zst").catch(
          () => null,
        );
        sessionOf(index, (line && codexRootOfFirstLine(line)) ?? `file:${job.path}`);
      }
    };
    await Promise.all(Array.from({ length: HEAD_READS }, reader));
  });
