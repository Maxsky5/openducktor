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
import type { GitWorktreeStatusData } from "../../ports/git-port";

export const gitWorktreeHashVersion = 1;
export const fnv1a64OffsetBasis = 0xcbf29ce484222325n;
export const fnv1a64Prime = 0x100000001b3n;
export const uint64Mask = 0xffffffffffffffffn;

export class Fnv1a64Hasher {
  private state = fnv1a64OffsetBasis;

  updateByte(value: number): void {
    this.state ^= BigInt(value & 0xff);
    this.state = (this.state * fnv1a64Prime) & uint64Mask;
  }

  updateBytes(values: Uint8Array): void {
    for (const value of values) {
      this.updateByte(value);
    }
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
    let remaining = BigInt(value);
    for (let index = 0; index < 8; index += 1) {
      this.updateByte(Number(remaining & 0xffn));
      remaining >>= 8n;
    }
  }

  updateString(value: string): void {
    const bytes = new TextEncoder().encode(value);
    this.updateU64(bytes.length);
    this.updateBytes(bytes);
  }

  finishHex(): string {
    return this.state.toString(16).padStart(16, "0");
  }
}

export const hashOptionalString = (hasher: Fnv1a64Hasher, value: string | undefined): void => {
  if (value === undefined) {
    hasher.updateByte(0);
    return;
  }

  hasher.updateByte(1);
  hasher.updateString(value);
};

export const hashUpstreamAheadBehind = (
  hasher: Fnv1a64Hasher,
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
  const hasher = new Fnv1a64Hasher();

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
  const hasher = new Fnv1a64Hasher();
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
  const hasher = new Fnv1a64Hasher();
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
): GitWorktreeStatusSnapshot => ({
  effectiveWorkingDir,
  targetBranch,
  diffScope,
  observedAtMs: Date.now(),
  hashVersion: gitWorktreeHashVersion,
  statusHash,
  diffHash,
});

export const staleDiffMessage = "Displayed diff is stale. Refresh and try again.";

export const validateResetSnapshotMatches = (
  snapshot: GitResetSnapshot,
  statusData: GitWorktreeStatusData,
): void => {
  if (snapshot.hashVersion !== gitWorktreeHashVersion) {
    throw new Error(staleDiffMessage);
  }

  const statusHash = hashWorktreeStatusPayload(
    statusData.currentBranch,
    statusData.fileStatuses,
    statusData.targetAheadBehind,
    statusData.upstreamAheadBehind,
  );
  const diffHash = hashWorktreeDiffPayload(statusData.fileDiffs);
  if (snapshot.statusHash !== statusHash || snapshot.diffHash !== diffHash) {
    throw new Error(staleDiffMessage);
  }
};
