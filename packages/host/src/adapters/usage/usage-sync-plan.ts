import type { RuntimeKind } from "@openducktor/contracts";
import type { UsageSourceRow } from "./usage-index-sources";
import { type DiskSource, isInsideAny } from "./usage-source-discovery";
import type { UsageParseJob } from "./usage-worker-protocol";

/** The stored sources that leave the index, and the sources to parse, largest first. */
export type UsageSyncPlan = {
  removeIds: number[];
  jobs: Omit<UsageParseJob, "jobId">[];
};

/** The OpenCode database is one long job. A compressed rollout holds about 10 times its size. */
const weightOf = ({ format, fingerprint }: DiskSource): number =>
  format === "opencode"
    ? Number.POSITIVE_INFINITY
    : format === "jsonl_zst"
      ? fingerprint.size * 10
      : fingerprint.size;

const sameFingerprint = (source: DiskSource, stored: UsageSourceRow): boolean =>
  source.fingerprint.size === stored.fingerprint.size &&
  source.fingerprint.modifiedAtMs === stored.fingerprint.modifiedAtMs &&
  source.fingerprint.fileId === stored.fingerprint.fileId;

/**
 * Decides what a read changes in the index. It parses each source that is new or changed, and
 * removes each stored source that left the disk. Only the sources of the selected runtimes
 * count: the others wait for a read that includes them.
 */
export const planUsageSync = ({
  runtimes,
  onDisk,
  unreadablePaths,
  stored,
  sinceMs,
}: {
  runtimes: readonly RuntimeKind[];
  onDisk: readonly DiskSource[];
  /** Folders and files that the host could not read. Their stored sources stay. */
  unreadablePaths: readonly string[];
  stored: readonly UsageSourceRow[];
  /** The start instant of the range, or null for all history. */
  sinceMs: number | null;
}): UsageSyncPlan => {
  const selected = stored.filter((row) => runtimes.includes(row.runtime));
  const diskPaths = new Set(onDisk.map((source) => source.path));
  const storedByPath = new Map(selected.map((row) => [row.path, row]));
  const jobs: UsageSyncPlan["jobs"] = [];
  // The largest sources start first, so no long job runs alone at the end.
  for (const source of onDisk.toSorted((left, right) => weightOf(right) - weightOf(left))) {
    const previous = storedByPath.get(source.path);
    // A source that the host could not read is read again at each check.
    if (previous && !previous.unreadable && sameFingerprint(source, previous)) continue;
    // A log changes with its last record, so an older change holds no activity of the range.
    // A database changes in any row.
    if (
      source.format !== "opencode" &&
      sinceMs !== null &&
      source.fingerprint.modifiedAtMs < sinceMs
    )
      continue;
    const { runtime, path, format, fingerprint } = source;
    jobs.push({
      runtime,
      path,
      format,
      fingerprint,
      previous: previous
        ? {
            fingerprint: previous.fingerprint,
            resume: previous.resume,
            parserState: previous.parserState,
            unreadable: previous.unreadable,
          }
        : null,
    });
  }
  return {
    removeIds: selected
      .filter((row) => !diskPaths.has(row.path) && !isInsideAny(row.path, unreadablePaths))
      .map((row) => row.id),
    jobs,
  };
};
