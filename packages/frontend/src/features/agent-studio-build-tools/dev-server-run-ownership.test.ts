import { describe, expect, test } from "bun:test";
import type {
  DevServerGroupState,
  DevServerRunIdentity,
  DevServerScriptState,
} from "@openducktor/contracts";
import {
  areDevServerRunIdentitiesEqual,
  canApplyDevServerGroupState,
  canApplyDevServerRunIdentityToStore,
  canApplyDevServerScriptStateToStore,
  compareDevServerRunIdentity,
} from "./dev-server-run-ownership";

const runIdentity = (
  runId: string,
  generation: number,
  hostInstanceId = "host-1",
): DevServerRunIdentity => ({
  runId,
  runOrder: { hostInstanceId, generation },
});

const scriptState = (
  scriptId: string,
  identity: DevServerRunIdentity | null,
): DevServerScriptState => ({
  scriptId,
  name: scriptId,
  command: `run ${scriptId}`,
  status: identity === null ? "stopped" : "running",
  runIdentity: identity,
  pid: identity === null ? null : 1,
  startedAt: identity === null ? null : "2026-07-10T10:00:00.000Z",
  exitCode: null,
  lastError: null,
  bufferedTerminalChunks: [],
});

const ownershipStore = (entries: readonly (readonly [string, DevServerRunIdentity | null])[]) =>
  new Map(entries.map(([scriptId, identity]) => [scriptId, { runIdentity: identity }]));

describe("dev-server-run-ownership", () => {
  test("compares runs within one host and rejects foreign hosts", () => {
    const current = runIdentity("frontend:2", 2);

    expect(compareDevServerRunIdentity(current, runIdentity("frontend:3", 3))).toBe("newer");
    expect(compareDevServerRunIdentity(current, runIdentity("frontend:1", 1))).toBe("older");
    expect(compareDevServerRunIdentity(current, runIdentity("frontend:3", 3, "host-2"))).toBe(
      "foreign",
    );
  });

  test("rejects conflicting order metadata for one run id", () => {
    expect(() =>
      areDevServerRunIdentitiesEqual(runIdentity("frontend:1", 1), runIdentity("frontend:1", 2)),
    ).toThrow("conflicting order metadata");
  });

  test("rejects a foreign host before it can own one script or a group", () => {
    const store = ownershipStore([["frontend", runIdentity("frontend:1", 1)]]);
    const foreignIdentity = runIdentity("backend:1", 1, "host-2");
    const foreignScript = scriptState("backend", foreignIdentity);
    const foreignGroup: DevServerGroupState = {
      repoPath: "/repo",
      taskId: "task-7",
      worktreePath: "/worktree",
      scripts: [foreignScript],
      updatedAt: "2026-07-10T10:00:00.000Z",
    };

    expect(canApplyDevServerRunIdentityToStore(store, foreignIdentity)).toBe(false);
    expect(canApplyDevServerScriptStateToStore(store, foreignScript)).toBe(false);
    expect(canApplyDevServerGroupState(store, foreignGroup)).toBe(false);
  });

  test("accepts a newer run owned by the current host", () => {
    const store = ownershipStore([["frontend", runIdentity("frontend:1", 1)]]);

    expect(
      canApplyDevServerScriptStateToStore(
        store,
        scriptState("frontend", runIdentity("frontend:2", 2)),
      ),
    ).toBe(true);
  });
});
