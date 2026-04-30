import { describe, expect, mock, test } from "bun:test";
import {
  haveSameRuntimeAttachmentCandidates,
  refreshRuntimeAttachmentSources,
  selectRuntimeAttachmentCandidates,
} from "./use-agent-studio-runtime-attachment-retry";

describe("selectRuntimeAttachmentCandidates", () => {
  test("includes matching runtime availability for the selected session", () => {
    const candidates = selectRuntimeAttachmentCandidates({
      repoPath: "/repo",
      session: {
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
      },
      runtimeSources: [
        {
          kind: "opencode",
          repoPath: "/repo",
          workingDirectory: "/repo",
          runtimeId: "runtime-1",
        },
      ],
    });

    expect(candidates).toEqual([
      {
        runtimeKind: "opencode",
        repoPath: "/repo",
        workingDirectory: "/repo/worktree",
        runtimeId: "runtime-1",
      },
    ]);
  });

  test("ignores unrelated runtimes", () => {
    const baseline = selectRuntimeAttachmentCandidates({
      repoPath: "/repo",
      session: {
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
      },
      runtimeSources: [
        {
          kind: "opencode",
          repoPath: "/repo",
          workingDirectory: "/repo",
          runtimeId: "runtime-1",
        },
      ],
    });

    const withUnrelatedChanges = selectRuntimeAttachmentCandidates({
      repoPath: "/repo",
      session: {
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
      },
      runtimeSources: [
        {
          kind: "opencode",
          repoPath: "/repo",
          workingDirectory: "/repo",
          runtimeId: "runtime-1",
        },
        {
          kind: "opencode",
          repoPath: "/unrelated-repo",
          workingDirectory: "/unrelated-repo/worktree",
          runtimeId: "runtime-unrelated",
        },
        {
          kind: "test-runtime",
          repoPath: "/repo",
          workingDirectory: "/repo",
          runtimeId: "runtime-test",
        },
      ],
    });

    expect(withUnrelatedChanges).toEqual(baseline);
  });

  test("normalizes matching paths before selecting recovery candidates", () => {
    const baseline = selectRuntimeAttachmentCandidates({
      repoPath: "/repo",
      session: {
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
      },
      runtimeSources: [
        {
          kind: "opencode",
          repoPath: "/repo",
          workingDirectory: "/repo",
          runtimeId: "runtime-1",
        },
      ],
    });

    const withEquivalentPathFormatting = selectRuntimeAttachmentCandidates({
      repoPath: "/repo/",
      session: {
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree/",
      },
      runtimeSources: [
        {
          kind: "opencode",
          repoPath: "/repo/",
          workingDirectory: "/repo/",
          runtimeId: "runtime-1",
        },
      ],
    });

    expect(withEquivalentPathFormatting).toEqual(baseline);
  });

  test("deduplicates duplicate runtime summaries", () => {
    const candidates = selectRuntimeAttachmentCandidates({
      repoPath: "/repo",
      session: {
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree",
      },
      runtimeSources: [
        {
          kind: "opencode",
          repoPath: "/repo",
          workingDirectory: "/repo",
          runtimeId: "runtime-1",
        },
        {
          kind: "opencode",
          repoPath: "/repo/",
          workingDirectory: "/repo/",
          runtimeId: "runtime-1",
        },
      ],
    });

    expect(candidates).toEqual([
      {
        runtimeKind: "opencode",
        repoPath: "/repo",
        workingDirectory: "/repo/worktree",
        runtimeId: "runtime-1",
      },
    ]);
  });

  test("compares candidates structurally", () => {
    expect(
      haveSameRuntimeAttachmentCandidates(
        [
          {
            runtimeKind: "opencode",
            repoPath: "/repo",
            workingDirectory: "/repo/worktree",
            runtimeId: "runtime-1",
          },
        ],
        [
          {
            runtimeKind: "opencode",
            repoPath: "/repo",
            workingDirectory: "/repo/worktree",
            runtimeId: "runtime-1",
          },
        ],
      ),
    ).toBe(true);
    expect(
      haveSameRuntimeAttachmentCandidates(
        [
          {
            runtimeKind: "opencode",
            repoPath: "/repo",
            workingDirectory: "/repo/worktree",
            runtimeId: "runtime-1",
          },
        ],
        [
          {
            runtimeKind: "opencode",
            repoPath: "/other-repo",
            workingDirectory: "/repo/worktree",
            runtimeId: "runtime-1",
          },
        ],
      ),
    ).toBe(false);
  });

  test("refreshes runtime lists", async () => {
    const refetchRuntimeList = mock(async () => []);

    await refreshRuntimeAttachmentSources([refetchRuntimeList]);

    expect(refetchRuntimeList).toHaveBeenCalledTimes(1);
  });

  test("deduplicates shared runtime list refetchers", async () => {
    const refetchRuntimeList = mock(async () => []);

    await refreshRuntimeAttachmentSources([refetchRuntimeList, refetchRuntimeList]);

    expect(refetchRuntimeList).toHaveBeenCalledTimes(1);
  });
});
