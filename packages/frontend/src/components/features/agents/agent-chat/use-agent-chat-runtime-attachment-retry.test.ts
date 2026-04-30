import { describe, expect, test } from "bun:test";
import {
  haveSameRuntimeAttachmentCandidates,
  selectRuntimeAttachmentCandidates,
} from "./use-agent-chat-runtime-attachment-retry";

describe("selectRuntimeAttachmentCandidates", () => {
  test("uses repo, runtime kind, and working directory as attachment readiness identity", () => {
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
          repoPath: "/other-repo",
          workingDirectory: "/other-repo/worktree",
          runtimeId: "runtime-other",
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

  test("compares attachment candidates with runtime instance details", () => {
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
            repoPath: "/repo",
            workingDirectory: "/repo/worktree",
            runtimeId: "runtime-2",
          },
        ],
      ),
    ).toBe(false);
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
});
