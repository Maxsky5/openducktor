import { describe, expect, mock, test } from "bun:test";
import { createLiveSessionTruthFixture } from "../test-utils";
import {
  getLiveAgentSessionCacheKey,
  LiveAgentSessionCache,
  liveAgentSessionLookupKey,
} from "./live-agent-session-cache";

const createTruth = (externalSessionId: string) =>
  createLiveSessionTruthFixture({ ref: { externalSessionId } });

describe("live-agent-session-cache", () => {
  test("builds cache keys from repo path, runtime kind, and normalized working directories", () => {
    expect(getLiveAgentSessionCacheKey("/tmp/repo/", "opencode")).toBe("/tmp/repo::opencode");
    expect(liveAgentSessionLookupKey("/tmp/repo", "opencode", "/tmp/repo/worktree/")).toBe(
      "/tmp/repo::opencode::/tmp/repo/worktree",
    );
  });

  test("reuses preloaded single-directory snapshots without scanning", async () => {
    const preloadedSessions = [createTruth("external-1")];
    const listLiveSessionTruths = mock(async () => [createTruth("external-2")]);
    const cache = new LiveAgentSessionCache(
      { listLiveSessionTruths },
      new Map([
        [
          liveAgentSessionLookupKey("/tmp/repo", "opencode", "/tmp/repo/worktree"),
          preloadedSessions,
        ],
      ]),
    );

    const first = await cache.load({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      directories: ["/tmp/repo/worktree/"],
    });
    const second = await cache.load({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      directories: ["/tmp/repo/worktree"],
    });

    expect(first).toBe(preloadedSessions);
    expect(second).toBe(preloadedSessions);
    expect(listLiveSessionTruths).not.toHaveBeenCalled();
  });

  test("normalizes, de-dupes, and sorts directory inputs before scanning and cache reuse", async () => {
    const scannedSessions = [createTruth("external-1")];
    const listLiveSessionTruths = mock(async () => scannedSessions);
    const cache = new LiveAgentSessionCache({ listLiveSessionTruths });

    const first = await cache.load({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      directories: ["/tmp/repo/b/", "", " /tmp/repo/a ", "/tmp/repo/b"],
    });
    const second = await cache.load({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      directories: ["/tmp/repo/a", "/tmp/repo/b"],
    });

    expect(first).toBe(scannedSessions);
    expect(second).toBe(scannedSessions);
    expect(listLiveSessionTruths).toHaveBeenCalledTimes(1);
    expect(listLiveSessionTruths).toHaveBeenCalledWith({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      directories: ["/tmp/repo/a", "/tmp/repo/b"],
    });
  });

  test("bypasses preloaded single-directory data when scanning multiple directories", async () => {
    const scannedSessions = [createTruth("external-2")];
    const listLiveSessionTruths = mock(async () => scannedSessions);
    const cache = new LiveAgentSessionCache(
      { listLiveSessionTruths },
      new Map([
        [
          liveAgentSessionLookupKey("/tmp/repo", "opencode", "/tmp/repo/worktree"),
          [createTruth("external-1")],
        ],
      ]),
    );

    const loaded = await cache.load({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      directories: ["/tmp/repo/worktree", "/tmp/repo/other"],
    });

    expect(loaded).toBe(scannedSessions);
    expect(listLiveSessionTruths).toHaveBeenCalledTimes(1);
  });

  test("rejects empty directory scans instead of widening to all sessions", async () => {
    const listLiveSessionTruths = mock(async () => [createTruth("external-1")]);
    const cache = new LiveAgentSessionCache({ listLiveSessionTruths });

    await expect(
      cache.load({
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        directories: ["", "   "],
      }),
    ).rejects.toThrow("Cannot scan live agent sessions without a valid working directory.");

    expect(listLiveSessionTruths).not.toHaveBeenCalled();
  });
});
