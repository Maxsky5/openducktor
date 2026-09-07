import { describe, expect, test } from "bun:test";
import { gitWorktreeStatusSnapshotSchema, type FileDiff } from "@openducktor/contracts";
import type { GitWorktreeStatusData } from "../../ports/git-port";
import {
  createWorktreeSnapshot,
  hashWorktreeDiffPayload,
  hashWorktreeDiffSummaryPayload,
  hashWorktreeStatusPayload,
  validateResetSnapshotMatches,
} from "./git-worktree-snapshot";

// Independent BigInt oracle for the original FNV-1a wire algorithm.
const referenceHash = (bytes: Uint8Array): string => {
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) hash = ((hash ^ BigInt(byte)) * 0x100000001b3n) & 0xffffffffffffffffn;
  return hash.toString(16).padStart(16, "0");
};

const fileDiff = (overrides: Partial<FileDiff> = {}): FileDiff => ({
  file: "file.ts",
  type: "modified",
  additions: 1,
  deletions: 2,
  diff: "-old\n+new\n",
  ...overrides,
});
const statusData = (): GitWorktreeStatusData => ({
  currentBranch: { name: "main", detached: false },
  fileStatuses: [{ path: "file.ts", status: "modified", staged: false }],
  fileDiffs: [fileDiff()],
  targetAheadBehind: { ahead: 1, behind: 2 },
  upstreamAheadBehind: { outcome: "untracked", ahead: 1 },
});
const snapshotFor = (data: GitWorktreeStatusData) =>
  createWorktreeSnapshot(
    "/repo",
    "main",
    "uncommitted",
    hashWorktreeStatusPayload(
      data.currentBranch,
      data.fileStatuses,
      data.targetAheadBehind,
      data.upstreamAheadBehind,
    ),
    hashWorktreeDiffPayload(data.fileDiffs),
    0,
  );

describe("worktree snapshot hashing", () => {
  test("preserves version 1 and the snapshot wire format", () => {
    const snapshot = snapshotFor(statusData());
    expect(snapshot.hashVersion).toBe(1);
    expect(gitWorktreeStatusSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(() => validateResetSnapshotMatches(snapshot, statusData())).not.toThrow();
  });

  test("hashes the complete little-endian framed UTF-8 payload", () => {
    // One file, UTF-8 path 'é', type 'added', counts 1/0, content '😀\0'.
    const framed = Buffer.from(
      "01000000000000000200000000000000c3a90500000000000000616464656401000000000000000500000000000000f09f988000",
      "hex",
    );
    expect(
      hashWorktreeDiffPayload([
        fileDiff({ file: "é", type: "added", additions: 1, deletions: 0, diff: "😀\0" }),
      ]),
    ).toBe(referenceHash(framed));
    expect(hashWorktreeDiffPayload([])).toBe("a8c7f832281a39c5");
  });

  test("matches the original arithmetic through carries and multi-byte UTF-8", () => {
    const diff = Array.from({ length: 2048 }, (_, index) => String.fromCharCode(index % 256)).join(
      "",
    );
    const entry = fileDiff({ file: "é😀", additions: 0xffffffff, deletions: 0x80000000, diff });
    const parts: Buffer[] = [];
    const integer = (value: number, size: number) => {
      const bytes = Buffer.alloc(size);
      if (size === 8) bytes.writeBigUInt64LE(BigInt(value));
      else bytes.writeUInt32LE(value);
      parts.push(bytes);
    };
    const string = (value: string) => {
      const bytes = Buffer.from(value, "utf8");
      integer(bytes.length, 8);
      parts.push(bytes);
    };
    integer(1, 8);
    string(entry.file);
    string(entry.type);
    integer(entry.additions, 4);
    integer(entry.deletions, 4);
    string(entry.diff);
    expect(hashWorktreeDiffPayload([entry])).toBe(referenceHash(Buffer.concat(parts)));
  });

  test("distinguishes empty lists, empty content, field boundaries and order", () => {
    const hashes = [
      [],
      [fileDiff({ diff: "" })],
      [fileDiff({ file: "a", diff: "bc" })],
      [fileDiff({ file: "ab", diff: "c" })],
      [fileDiff(), fileDiff({ file: "other" })],
      [fileDiff({ file: "other" }), fileDiff()],
    ].map(hashWorktreeDiffPayload);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  test.each(["file", "type", "additions", "deletions", "diff"] as const)("includes %s", (field) => {
    const changed = fileDiff({
      file: "else.ts",
      type: "added",
      additions: 2,
      deletions: 1,
      diff: "-old\n+NEW\n",
    });
    expect(hashWorktreeDiffPayload([fileDiff({ [field]: changed[field] })])).not.toBe(
      hashWorktreeDiffPayload([fileDiff()]),
    );
  });

  test.each([0, 32768, 65535])("detects same-length changes at byte %s", (offset) => {
    const content = "a".repeat(65536);
    expect(hashWorktreeDiffPayload([fileDiff({ diff: content })])).not.toBe(
      hashWorktreeDiffPayload([
        fileDiff({ diff: `${content.slice(0, offset)}b${content.slice(offset + 1)}` }),
      ]),
    );
  });

  test("distinguishes Unicode without normalization and encodes lone surrogates consistently", () => {
    const hash = (diff: string) => hashWorktreeDiffPayload([fileDiff({ diff })]);
    expect(hash("é")).not.toBe(hash("e\u0301"));
    expect(hash("😀")).not.toBe(hash("😁"));
    expect(hash("\ud800")).toBe(hash("\ufffd"));
  });

  test("rejects stale content and status and incompatible versions", () => {
    const data = statusData();
    const snapshot = snapshotFor(data);
    for (const hashVersion of [2, 3]) {
      expect(() => validateResetSnapshotMatches({ ...snapshot, hashVersion }, data)).toThrow(
        "Displayed diff is stale",
      );
    }
    data.fileDiffs[0] = fileDiff({ diff: "-old\n+NEW\n" });
    expect(() => validateResetSnapshotMatches(snapshot, data)).toThrow("Displayed diff is stale");
    const changedStatus = statusData();
    changedStatus.fileStatuses[0] = { path: "file.ts", status: "modified", staged: true };
    expect(() => validateResetSnapshotMatches(snapshot, changedStatus)).toThrow(
      "Displayed diff is stale",
    );
  });

  test("preserves status ordering, optional names, upstream outcomes and summary fields", () => {
    const data = statusData();
    const hash = (value: GitWorktreeStatusData) => snapshotFor(value).statusHash;
    const files = [...data.fileStatuses, { path: "other", status: "added", staged: true }];
    expect(hash({ ...data, fileStatuses: files })).not.toBe(
      hash({ ...data, fileStatuses: [...files].reverse() }),
    );
    expect(hash({ ...data, currentBranch: { detached: true } })).not.toBe(
      hash({ ...data, currentBranch: { detached: true, name: "" } }),
    );
    const upstreamValues: GitWorktreeStatusData["upstreamAheadBehind"][] = [
      { outcome: "untracked", ahead: 1 },
      { outcome: "tracking", ahead: 1, behind: 0 },
      { outcome: "error", message: "failed" },
    ];
    const upstreamHashes = upstreamValues.map((upstream) =>
      hash({
        ...data,
        upstreamAheadBehind: upstream,
      }),
    );
    expect(new Set(upstreamHashes).size).toBe(3);
    const counts = { total: 2, staged: 1, unstaged: 1 };
    expect(hashWorktreeDiffSummaryPayload("uncommitted", data.targetAheadBehind, counts)).not.toBe(
      hashWorktreeDiffSummaryPayload("uncommitted", data.targetAheadBehind, {
        ...counts,
        staged: 2,
      }),
    );
  });
});
