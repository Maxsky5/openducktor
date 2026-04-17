import { describe, expect, mock, test } from "bun:test";
import {
  haveSameRuntimeAttachmentCandidates,
  refreshRuntimeAttachmentSources,
  selectRuntimeAttachmentCandidates,
} from "./use-agent-studio-runtime-attachment-retry";

describe("selectRuntimeAttachmentCandidates", () => {
  test("includes matching runtime instances for the selected session", () => {
    const candidates = selectRuntimeAttachmentCandidates({
      repoPath: "/repo",
      session: {
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree-a",
      },
      runtimeSources: [
        {
          kind: "opencode",
          runtimeId: "runtime-1",
          workingDirectory: "/repo",
          route: "http://127.0.0.1:4444",
        },
      ],
    });

    expect(candidates).toEqual([
      {
        runtimeKind: "opencode",
        runtimeId: "runtime-1",
        workingDirectory: "/repo",
        route: "http://127.0.0.1:4444",
      },
    ]);
  });

  test("ignores unrelated runtimes", () => {
    const baseline = selectRuntimeAttachmentCandidates({
      repoPath: "/repo",
      session: {
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree-a",
      },
      runtimeSources: [
        {
          kind: "opencode",
          runtimeId: "runtime-1",
          workingDirectory: "/repo",
          route: "http://127.0.0.1:4444",
        },
      ],
    });

    const withUnrelatedChanges = selectRuntimeAttachmentCandidates({
      repoPath: "/repo",
      session: {
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree-a",
      },
      runtimeSources: [
        {
          kind: "opencode",
          runtimeId: "runtime-1",
          workingDirectory: "/repo",
          route: "http://127.0.0.1:4444",
        },
        {
          kind: "opencode",
          runtimeId: "runtime-unrelated",
          workingDirectory: "/repo/worktree-z",
          route: "http://127.0.0.1:5555",
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
        workingDirectory: "/repo/worktree-a",
      },
      runtimeSources: [
        {
          kind: "opencode",
          runtimeId: "runtime-1",
          workingDirectory: "/repo",
          route: "http://127.0.0.1:4444",
        },
      ],
    });

    const withEquivalentPathFormatting = selectRuntimeAttachmentCandidates({
      repoPath: "/repo/",
      session: {
        runtimeKind: "opencode",
        workingDirectory: "/repo/worktree-a/",
      },
      runtimeSources: [
        {
          kind: "opencode",
          runtimeId: "runtime-1",
          workingDirectory: "/repo/",
          route: "http://127.0.0.1:4444",
        },
      ],
    });

    expect(withEquivalentPathFormatting).toEqual(baseline);
  });

  test("compares candidates structurally", () => {
    expect(
      haveSameRuntimeAttachmentCandidates(
        [
          {
            runtimeKind: "opencode",
            runtimeId: "runtime-1",
            workingDirectory: "/repo",
            route: "http://127.0.0.1:4444",
          },
        ],
        [
          {
            runtimeKind: "opencode",
            runtimeId: "runtime-1",
            workingDirectory: "/repo",
            route: "http://127.0.0.1:4444",
          },
        ],
      ),
    ).toBe(true);
    expect(
      haveSameRuntimeAttachmentCandidates(
        [
          {
            runtimeKind: "opencode",
            runtimeId: "runtime-1",
            workingDirectory: "/repo",
            route: "http://127.0.0.1:4444",
          },
        ],
        [
          {
            runtimeKind: "opencode",
            runtimeId: "runtime-2",
            workingDirectory: "/repo",
            route: "http://127.0.0.1:4444",
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
});
