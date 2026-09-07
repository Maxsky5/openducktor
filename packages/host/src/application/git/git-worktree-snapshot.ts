import type {
  CommitsAheadBehind,
  FileDiff,
  FileStatus,
  GitCurrentBranch,
  GitDiffScope,
  GitFileStatusCounts,
  GitResetSnapshot,
  GitUpstreamAheadBehind,
  GitWorktreeStatusSnapshot,
} from "@openducktor/contracts";
import { HostValidationError } from "../../effect/host-errors";
import type { GitWorktreeStatusData } from "../../ports/git-port";

const gitWorktreeHashVersion = 1;

class WorktreeSnapshotHasher {
  private high = 0xcbf29ce4 | 0;
  private low = 0x84222325 | 0;

  updateByte(value: number): void {
    this.updateBytes(Uint8Array.of(value));
  }

  updateBytes(values: Uint8Array): void {
    let high = this.high;
    let low = this.low;
    for (let index = 0; index < values.length; index += 1) {
      low ^= values[index]!;
      // FNV prime = 2^40 + 435. Split the low product into 16-bit limbs for its carry.
      const lowProduct = (low & 0xffff) * 435;
      const middle = (low >>> 16) * 435 + (lowProduct >>> 16);
      high = (Math.imul(high, 435) + (low << 8) + (middle >>> 16)) | 0;
      low = Math.imul(low, 435);
    }
    this.high = high;
    this.low = low;
  }

  updateBool(value: boolean): void {
    this.updateByte(value ? 1 : 0);
  }

  updateU32(value: number): void {
    const buffer = new ArrayBuffer(4);
    new DataView(buffer).setUint32(0, value, true);
    this.updateBytes(new Uint8Array(buffer));
  }

  updateU64(value: number): void {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setBigUint64(0, BigInt(value), true);
    this.updateBytes(new Uint8Array(buffer));
  }

  updateString(value: string): void {
    const bytes = new TextEncoder().encode(value);
    this.updateU64(bytes.length);
    this.updateBytes(bytes);
  }

  finishHex(): string {
    return (
      (this.high >>> 0).toString(16).padStart(8, "0") +
      (this.low >>> 0).toString(16).padStart(8, "0")
    );
  }
}

const hashOptionalString = (hasher: WorktreeSnapshotHasher, value: string | undefined): void => {
  if (value === undefined) {
    hasher.updateByte(0);
    return;
  }

  hasher.updateByte(1);
  hasher.updateString(value);
};

const hashUpstreamAheadBehind = (
  hasher: WorktreeSnapshotHasher,
  upstreamAheadBehind: GitUpstreamAheadBehind,
): void => {
  if (upstreamAheadBehind.outcome === "tracking") {
    hasher.updateString("tracking");
    hasher.updateU32(upstreamAheadBehind.ahead);
    hasher.updateU32(upstreamAheadBehind.behind);
    return;
  }

  if (upstreamAheadBehind.outcome === "untracked") {
    hasher.updateString("untracked");
    hasher.updateU32(upstreamAheadBehind.ahead);
    return;
  }

  hasher.updateString("error");
  hasher.updateString(upstreamAheadBehind.message);
};

export const hashWorktreeStatusPayload = (
  currentBranch: GitCurrentBranch,
  fileStatuses: FileStatus[],
  targetAheadBehind: CommitsAheadBehind,
  upstreamAheadBehind: GitUpstreamAheadBehind,
): string => {
  const hasher = new WorktreeSnapshotHasher();

  hashOptionalString(hasher, currentBranch.name);
  hasher.updateBool(currentBranch.detached);
  hasher.updateU64(fileStatuses.length);
  for (const status of fileStatuses) {
    hasher.updateString(status.path);
    hasher.updateString(status.status);
    hasher.updateBool(status.staged);
  }

  hasher.updateU32(targetAheadBehind.ahead);
  hasher.updateU32(targetAheadBehind.behind);
  hashUpstreamAheadBehind(hasher, upstreamAheadBehind);

  return hasher.finishHex();
};

export const hashWorktreeDiffPayload = (fileDiffs: FileDiff[]): string => {
  const hasher = new WorktreeSnapshotHasher();
  hasher.updateU64(fileDiffs.length);

  for (const diff of fileDiffs) {
    hasher.updateString(diff.file);
    hasher.updateString(diff.type);
    hasher.updateU32(diff.additions);
    hasher.updateU32(diff.deletions);
    hasher.updateString(diff.diff);
  }

  return hasher.finishHex();
};

export const hashWorktreeDiffSummaryPayload = (
  diffScope: GitDiffScope,
  targetAheadBehind: CommitsAheadBehind,
  fileStatusCounts: GitFileStatusCounts,
): string => {
  const hasher = new WorktreeSnapshotHasher();
  hasher.updateString(diffScope);
  hasher.updateU32(targetAheadBehind.ahead);
  hasher.updateU32(targetAheadBehind.behind);
  hasher.updateU32(fileStatusCounts.total);
  hasher.updateU32(fileStatusCounts.staged);
  hasher.updateU32(fileStatusCounts.unstaged);
  return hasher.finishHex();
};

export const createWorktreeSnapshot = (
  effectiveWorkingDir: string,
  targetBranch: string,
  diffScope: GitDiffScope,
  statusHash: string,
  diffHash: string,
  observedAtMs: number,
): GitWorktreeStatusSnapshot => ({
  effectiveWorkingDir,
  targetBranch,
  diffScope,
  observedAtMs,
  hashVersion: gitWorktreeHashVersion,
  statusHash,
  diffHash,
});

const staleDiffMessage = "Displayed diff is stale. Refresh and try again.";

export const validateResetSnapshotMatches = (
  snapshot: GitResetSnapshot,
  statusData: GitWorktreeStatusData,
): void => {
  if (snapshot.hashVersion !== gitWorktreeHashVersion) {
    throw new HostValidationError({ message: staleDiffMessage });
  }

  const statusHash = hashWorktreeStatusPayload(
    statusData.currentBranch,
    statusData.fileStatuses,
    statusData.targetAheadBehind,
    statusData.upstreamAheadBehind,
  );
  const diffHash = hashWorktreeDiffPayload(statusData.fileDiffs);
  if (snapshot.statusHash !== statusHash || snapshot.diffHash !== diffHash) {
    throw new HostValidationError({ message: staleDiffMessage });
  }
};
