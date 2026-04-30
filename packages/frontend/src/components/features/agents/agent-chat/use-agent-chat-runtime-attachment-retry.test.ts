import { describe, expect, test } from "bun:test";
import {
  haveSameRuntimeAttachmentCandidates,
  selectRuntimeAttachmentCandidates,
} from "./use-agent-chat-runtime-attachment-retry";

describe("selectRuntimeAttachmentCandidates", () => {
  test("uses repo and runtime kind as attachment readiness identity", () => {
    const candidates = selectRuntimeAttachmentCandidates({
      repoPath: "/repo",
      session: {
        runtimeKind: "opencode",
      },
      runtimeSources: [
        {
          kind: "opencode",
          repoPath: "/repo",
        },
        {
          kind: "opencode",
          repoPath: "/other-repo",
        },
      ],
    });

    expect(candidates).toEqual([
      {
        runtimeKind: "opencode",
        repoPath: "/repo",
      },
    ]);
  });

  test("compares attachment candidates without runtime instance details", () => {
    expect(
      haveSameRuntimeAttachmentCandidates(
        [{ runtimeKind: "opencode", repoPath: "/repo" }],
        [{ runtimeKind: "opencode", repoPath: "/repo" }],
      ),
    ).toBe(true);
    expect(
      haveSameRuntimeAttachmentCandidates(
        [{ runtimeKind: "opencode", repoPath: "/repo" }],
        [{ runtimeKind: "test-runtime", repoPath: "/repo" }],
      ),
    ).toBe(false);
  });

  test("deduplicates duplicate runtime summaries", () => {
    const candidates = selectRuntimeAttachmentCandidates({
      repoPath: "/repo",
      session: {
        runtimeKind: "opencode",
      },
      runtimeSources: [
        { kind: "opencode", repoPath: "/repo" },
        { kind: "opencode", repoPath: "/repo/" },
      ],
    });

    expect(candidates).toEqual([{ runtimeKind: "opencode", repoPath: "/repo" }]);
  });
});
