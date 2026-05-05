import { describe, expect, mock, test } from "bun:test";
import { createAgentSessionPresenceSnapshotFixture, createDeferred } from "../test-utils";
import {
  AgentSessionPresenceCache,
  agentSessionPresenceLookupKey,
  getAgentSessionPresenceCacheKey,
} from "./session-presence-cache";

const createPresence = (externalSessionId: string) =>
  createAgentSessionPresenceSnapshotFixture({ ref: { externalSessionId } });

describe("session-presence-cache", () => {
  test("builds cache keys from repo path, runtime kind, and normalized working directories", () => {
    expect(getAgentSessionPresenceCacheKey("/tmp/repo/", "opencode")).toBe("/tmp/repo::opencode");
    expect(agentSessionPresenceLookupKey("/tmp/repo", "opencode", "/tmp/repo/worktree/")).toBe(
      "/tmp/repo::opencode::/tmp/repo/worktree",
    );
  });

  test("reuses preloaded single-directory snapshots without scanning", async () => {
    const preloadedSessions = [createPresence("external-1")];
    const listSessionPresence = mock(async () => [createPresence("external-2")]);
    const cache = new AgentSessionPresenceCache(
      { listSessionPresence },
      new Map([
        [
          agentSessionPresenceLookupKey("/tmp/repo", "opencode", "/tmp/repo/worktree"),
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
    expect(listSessionPresence).not.toHaveBeenCalled();
  });

  test("normalizes, de-dupes, and sorts directory inputs before scanning and cache reuse", async () => {
    const scannedSessions = [createPresence("external-1")];
    const listSessionPresence = mock(async () => scannedSessions);
    const cache = new AgentSessionPresenceCache({ listSessionPresence });

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
    expect(listSessionPresence).toHaveBeenCalledTimes(1);
    expect(listSessionPresence).toHaveBeenCalledWith({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      directories: ["/tmp/repo/a", "/tmp/repo/b"],
    });
  });

  test("coalesces concurrent same-key scans", async () => {
    const scannedSessions = [createPresence("external-1")];
    const scanDeferred = createDeferred<typeof scannedSessions>();
    const listSessionPresence = mock(async () => scanDeferred.promise);
    const cache = new AgentSessionPresenceCache({ listSessionPresence });

    const firstLoad = cache.load({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      directories: ["/tmp/repo/worktree/"],
    });
    const secondLoad = cache.load({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      directories: ["/tmp/repo/worktree"],
    });

    expect(listSessionPresence).toHaveBeenCalledTimes(1);

    scanDeferred.resolve(scannedSessions);
    const [first, second] = await Promise.all([firstLoad, secondLoad]);
    const third = await cache.load({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      directories: ["/tmp/repo/worktree"],
    });

    expect(first).toBe(scannedSessions);
    expect(second).toBe(scannedSessions);
    expect(third).toBe(scannedSessions);
    expect(listSessionPresence).toHaveBeenCalledTimes(1);
  });

  test("does not cache failed in-flight scans", async () => {
    const scannedSessions = [createPresence("external-1")];
    let attempts = 0;
    const listSessionPresence = mock(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("scan failed");
      }
      return scannedSessions;
    });
    const cache = new AgentSessionPresenceCache({ listSessionPresence });
    const input = {
      repoPath: "/tmp/repo",
      runtimeKind: "opencode" as const,
      directories: ["/tmp/repo/worktree"],
    };

    await expect(cache.load(input)).rejects.toThrow("scan failed");
    await expect(cache.load(input)).resolves.toBe(scannedSessions);

    expect(listSessionPresence).toHaveBeenCalledTimes(2);
  });

  test("bypasses preloaded single-directory data when scanning multiple directories", async () => {
    const scannedSessions = [createPresence("external-2")];
    const listSessionPresence = mock(async () => scannedSessions);
    const cache = new AgentSessionPresenceCache(
      { listSessionPresence },
      new Map([
        [
          agentSessionPresenceLookupKey("/tmp/repo", "opencode", "/tmp/repo/worktree"),
          [createPresence("external-1")],
        ],
      ]),
    );

    const loaded = await cache.load({
      repoPath: "/tmp/repo",
      runtimeKind: "opencode",
      directories: ["/tmp/repo/worktree", "/tmp/repo/other"],
    });

    expect(loaded).toBe(scannedSessions);
    expect(listSessionPresence).toHaveBeenCalledTimes(1);
  });

  test("rejects empty directory scans instead of widening to all sessions", async () => {
    const listSessionPresence = mock(async () => [createPresence("external-1")]);
    const cache = new AgentSessionPresenceCache({ listSessionPresence });

    await expect(
      cache.load({
        repoPath: "/tmp/repo",
        runtimeKind: "opencode",
        directories: ["", "   "],
      }),
    ).rejects.toThrow("Cannot scan session presence without a valid working directory.");

    expect(listSessionPresence).not.toHaveBeenCalled();
  });
});
