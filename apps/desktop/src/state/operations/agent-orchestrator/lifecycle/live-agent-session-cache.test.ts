import { describe, expect, mock, test } from "bun:test";
import type { LiveAgentSessionSnapshot } from "@openducktor/core";
import {
  createLiveAgentSessionSnapshotFixture,
  createLocalHttpRuntimeConnection,
  createStdioRuntimeConnection,
} from "../test-utils";
import {
  getLiveAgentSessionCacheKey,
  LiveAgentSessionCache,
  liveAgentSessionLookupKey,
  runtimeWorkingDirectoryKey,
} from "./live-agent-session-cache";

const localRuntimeConnection = createLocalHttpRuntimeConnection();

const stdioRuntimeConnection = createStdioRuntimeConnection("/tmp/runtime-root/");

const createSnapshot = (externalSessionId: string): LiveAgentSessionSnapshot =>
  createLiveAgentSessionSnapshotFixture({ externalSessionId });

describe("live-agent-session-cache", () => {
  test("builds cache keys from transport identity and normalized working directories", () => {
    const paddedLocalRuntimeConnection = createLocalHttpRuntimeConnection({
      endpoint: " http://127.0.0.1:4444 ",
    });

    expect(getLiveAgentSessionCacheKey("opencode", paddedLocalRuntimeConnection)).toBe(
      "opencode::local_http:http://127.0.0.1:4444",
    );
    expect(getLiveAgentSessionCacheKey("opencode", stdioRuntimeConnection)).toBe(
      "opencode::stdio::/tmp/runtime-root",
    );
    expect(runtimeWorkingDirectoryKey("opencode", "/tmp/repo/worktree/")).toBe(
      "opencode::/tmp/repo/worktree",
    );
    expect(
      liveAgentSessionLookupKey("opencode", stdioRuntimeConnection, "/tmp/repo/worktree/"),
    ).toBe("opencode::stdio::/tmp/runtime-root::/tmp/repo/worktree");
  });

  test("reuses preloaded single-directory snapshots without scanning", async () => {
    const preloadedSessions = [createSnapshot("external-1")];
    const listLiveAgentSessionSnapshots = mock(async () => [createSnapshot("external-2")]);
    const cache = new LiveAgentSessionCache(
      { listLiveAgentSessionSnapshots },
      new Map([
        [
          liveAgentSessionLookupKey("opencode", localRuntimeConnection, "/tmp/repo/worktree"),
          preloadedSessions,
        ],
      ]),
    );

    const first = await cache.load({
      runtimeKind: "opencode",
      runtimeConnection: localRuntimeConnection,
      directories: ["/tmp/repo/worktree/"],
    });
    const second = await cache.load({
      runtimeKind: "opencode",
      runtimeConnection: localRuntimeConnection,
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
      runtimeKind: "opencode",
      runtimeConnection: localRuntimeConnection,
      directories: ["/tmp/repo/b/", "", " /tmp/repo/a ", "/tmp/repo/b"],
    });
    const second = await cache.load({
      runtimeKind: "opencode",
      runtimeConnection: localRuntimeConnection,
      directories: ["/tmp/repo/a", "/tmp/repo/b"],
    });

    expect(first).toBe(scannedSessions);
    expect(second).toBe(scannedSessions);
    expect(listLiveAgentSessionSnapshots).toHaveBeenCalledTimes(1);
    expect(listLiveAgentSessionSnapshots).toHaveBeenCalledWith({
      runtimeKind: "opencode",
      runtimeConnection: localRuntimeConnection,
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
          liveAgentSessionLookupKey("opencode", localRuntimeConnection, "/tmp/repo/worktree"),
          [createSnapshot("external-1")],
        ],
      ]),
    );

    const loaded = await cache.load({
      runtimeKind: "opencode",
      runtimeConnection: localRuntimeConnection,
      directories: ["/tmp/repo/worktree", "/tmp/repo/other"],
    });

    expect(loaded).toBe(scannedSessions);
    expect(listLiveAgentSessionSnapshots).toHaveBeenCalledTimes(1);
  });

  test("omits directories from the adapter call when every directory normalizes away", async () => {
    const listLiveAgentSessionSnapshots = mock(async () => [createSnapshot("external-1")]);
    const cache = new LiveAgentSessionCache({ listLiveAgentSessionSnapshots });

    await cache.load({
      runtimeKind: "opencode",
      runtimeConnection: localRuntimeConnection,
      directories: ["", "   "],
    });

    expect(listLiveAgentSessionSnapshots).toHaveBeenCalledWith({
      runtimeKind: "opencode",
      runtimeConnection: localRuntimeConnection,
    });
  });
});
