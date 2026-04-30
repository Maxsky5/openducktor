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
      },
      runtimeSources: [
        {
          kind: "opencode",
          repoPath: "/repo",
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

  test("ignores unrelated runtimes", () => {
    const baseline = selectRuntimeAttachmentCandidates({
      repoPath: "/repo",
      session: {
        runtimeKind: "opencode",
      },
      runtimeSources: [
        {
          kind: "opencode",
          repoPath: "/repo",
        },
      ],
    });

    const withUnrelatedChanges = selectRuntimeAttachmentCandidates({
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
          repoPath: "/unrelated-repo",
        },
        {
          kind: "test-runtime",
          repoPath: "/repo",
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
      },
      runtimeSources: [
        {
          kind: "opencode",
          repoPath: "/repo",
        },
      ],
    });

    const withEquivalentPathFormatting = selectRuntimeAttachmentCandidates({
      repoPath: "/repo/",
      session: {
        runtimeKind: "opencode",
      },
      runtimeSources: [
        {
          kind: "opencode",
          repoPath: "/repo/",
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
            repoPath: "/repo",
          },
        ],
        [
          {
            runtimeKind: "opencode",
            repoPath: "/repo",
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
          },
        ],
        [
          {
            runtimeKind: "opencode",
            repoPath: "/other-repo",
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
