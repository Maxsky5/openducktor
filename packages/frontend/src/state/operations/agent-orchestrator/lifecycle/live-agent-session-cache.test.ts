import { describe, expect, mock, test } from "bun:test";
import type { LiveAgentSessionSnapshot } from "@openducktor/core";
import { createLiveAgentSessionSnapshotFixture } from "../test-utils";
import {
  getLiveAgentSessionCacheKey,
  LiveAgentSessionCache,
  liveAgentSessionLookupKey,
  RuntimeWorktreePreloadIndex,
  runtimeWorkingDirectoryKey,
} from "./live-agent-session-cache";

const createSnapshot = (externalSessionId: string): LiveAgentSessionSnapshot =>
  createLiveAgentSessionSnapshotFixture({ externalSessionId });

describe("live-agent-session-cache", () => {
  test("builds cache keys from repo path, runtime kind, and normalized working directories", () => {
    expect(getLiveAgentSessionCacheKey("/tmp/repo/", "opencode")).toBe("/tmp/repo::opencode");
    expect(runtimeWorkingDirectoryKey("/tmp/repo/", "opencode", "/tmp/repo/worktree/")).toBe(
      "/tmp/repo::opencode::/tmp/repo/worktree",
    );
    const preloadIndex = new RuntimeWorktreePreloadIndex();
    preloadIndex.add("/tmp/repo", "opencode", "/tmp/runtime-root/");
    expect(preloadIndex.hasAny("/tmp/repo", "opencode", "/tmp/runtime-root/")).toBe(true);
    expect(preloadIndex.hasAny("/tmp/repo", "opencode", "/tmp/other")).toBe(false);
    expect(preloadIndex.findCandidates("/tmp/repo", "opencode", "/tmp/runtime-root/")).toEqual([
      {
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        workingDirectory: "/tmp/runtime-root/",
      },
    ]);
    expect(liveAgentSessionLookupKey("/tmp/repo", "opencode", "/tmp/repo/worktree/")).toBe(
      "/tmp/repo::opencode::/tmp/repo/worktree",
    );
  });

  test("indexes distinct repo-scoped runtime directories sharing a working directory", () => {
    const preloadIndex = new RuntimeWorktreePreloadIndex();
    preloadIndex.add("/tmp/repo-a", "opencode", "/tmp/runtime-root");
    preloadIndex.add("/tmp/repo-b", "opencode", "/tmp/runtime-root");

    expect(preloadIndex.size).toBe(2);
    expect(preloadIndex.findCandidates("/tmp/repo-a", "opencode", "/tmp/runtime-root/")).toEqual([
      { repoPath: "/tmp/repo-a", runtimeKind: "opencode", workingDirectory: "/tmp/runtime-root" },
    ]);
  });

  test("reuses preloaded single-directory snapshots without scanning", async () => {
    const preloadedSessions = [createSnapshot("external-1")];
    const listLiveAgentSessionSnapshots = mock(async () => [createSnapshot("external-2")]);
    const cache = new LiveAgentSessionCache(
      { listLiveAgentSessionSnapshots },
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
    expect(listLiveAgentSessionSnapshots).not.toHaveBeenCalled();
  });

  test("normalizes, de-dupes, and sorts directory inputs before scanning and cache reuse", async () => {
    const scannedSessions = [createSnapshot("external-1")];
    const listLiveAgentSessionSnapshots = mock(async () => scannedSessions);
    const cache = new LiveAgentSessionCache({ listLiveAgentSessionSnapshots });

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
    expect(listLiveAgentSessionSnapshots).toHaveBeenCalledTimes(1);
    expect(listLiveAgentSessionSnapshots).toHaveBeenCalledWith({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      directories: ["/tmp/repo/a", "/tmp/repo/b"],
    });
  });

  test("bypasses preloaded single-directory data when scanning multiple directories", async () => {
    const scannedSessions = [createSnapshot("external-2")];
    const listLiveAgentSessionSnapshots = mock(async () => scannedSessions);
    const cache = new LiveAgentSessionCache(
      { listLiveAgentSessionSnapshots },
      new Map([
        [
          liveAgentSessionLookupKey("/tmp/repo", "opencode", "/tmp/repo/worktree"),
          [createSnapshot("external-1")],
        ],
      ]),
    );

    const loaded = await cache.load({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      directories: ["/tmp/repo/worktree", "/tmp/repo/other"],
    });

    expect(loaded).toBe(scannedSessions);
    expect(listLiveAgentSessionSnapshots).toHaveBeenCalledTimes(1);
  });

  test("omits directories from the adapter call when every directory normalizes away", async () => {
    const listLiveAgentSessionSnapshots = mock(async () => [createSnapshot("external-1")]);
    const cache = new LiveAgentSessionCache({ listLiveAgentSessionSnapshots });

    await cache.load({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      directories: ["", "   "],
    });

    expect(listLiveAgentSessionSnapshots).toHaveBeenCalledWith({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
    });
  });
});
