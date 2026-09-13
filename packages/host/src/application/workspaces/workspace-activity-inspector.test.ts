import {
  agentSessionLiveSnapshotSchema,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type AgentSessionLiveSnapshot,
  type RuntimeInstanceSummary,
} from "@openducktor/contracts";
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { createWorkspaceActivityInspector } from "./workspace-activity-inspector";

const snapshot = (
  externalSessionId: string,
  activity: "idle" | "running",
): AgentSessionLiveSnapshot =>
  agentSessionLiveSnapshotSchema.parse({
    ref: {
      repoPath: "/repo",
      runtimeKind: "opencode",
      workingDirectory: "/repo/task-1",
      externalSessionId,
    },
    activity,
    title: externalSessionId,
    startedAt: "2026-01-01T00:00:00.000Z",
    pendingApprovals: [],
    pendingQuestions: [],
    contextUsage: null,
  });

const runtime = (runtimeId: string): RuntimeInstanceSummary => ({
  kind: "opencode",
  runtimeId,
  repoPath: "/repo",
  taskId: null,
  role: "workspace",
  workingDirectory: "/repo",
  runtimeRoute: { type: "local_http", endpoint: "http://127.0.0.1:43123" },
  startedAt: "2026-01-01T00:00:00.000Z",
  descriptor: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
});

const createInspector = ({
  onReleaseDevServers,
  onRelease,
  onStopRuntime,
  runtimes = [],
  sessions = [],
  stopRuntimeError,
}: {
  onReleaseDevServers?: (repoPath: string) => void;
  onRelease?: (externalSessionId: string) => void;
  onStopRuntime?: (runtimeId: string) => void;
  runtimes?: RuntimeInstanceSummary[];
  sessions?: AgentSessionLiveSnapshot[];
  stopRuntimeError?: HostOperationError;
} = {}) =>
  createWorkspaceActivityInspector({
    agentSessionLiveStateService: {
      list: () => Effect.succeed(sessions),
      releaseSession: (ref) =>
        Effect.sync(() => {
          onRelease?.(ref.externalSessionId);
        }),
    },
    devServerService: {
      inspectWorkspaceActivity: () => Effect.succeed({ activeTaskIds: [] }),
      releaseWorkspace: ({ repoPath }) =>
        Effect.sync(() => {
          onReleaseDevServers?.(repoPath);
        }),
    },
    runtimeRegistry: {
      listRuntimesByRepo: () => Effect.succeed(runtimes),
      stopRuntime: (runtimeId) => {
        onStopRuntime?.(runtimeId);
        return stopRuntimeError ? Effect.fail(stopRuntimeError) : Effect.succeed(true);
      },
    },
    terminalService: {
      inspectWorkspaceActivity: () =>
        Effect.succeed({ activeTerminalIds: [], unknownTerminalIds: [] }),
    },
  });

describe("workspace activity inspector", () => {
  test("does not block on idle agent sessions", async () => {
    const blockers = await Effect.runPromise(
      createInspector({ sessions: [snapshot("s1", "idle")] }).inspect("/repo"),
    );

    expect(blockers).toEqual([]);
  });

  test("blocks on a running agent session", async () => {
    const blockers = await Effect.runPromise(
      createInspector({ sessions: [snapshot("s1", "running")] }).inspect("/repo"),
    );

    expect(blockers).toEqual([{ kind: "agent-session", label: "agent session s1 is running" }]);
  });

  test("releases every live session for the workspace", async () => {
    const released: string[] = [];
    const inspector = createInspector({
      sessions: [snapshot("s1", "idle"), snapshot("s2", "running")],
      onRelease: (externalSessionId) => released.push(externalSessionId),
    });

    await Effect.runPromise(inspector.releaseWorkspaceSessions("/repo"));

    expect(released).toEqual(["s1", "s2"]);
  });

  test("stops every runtime for the workspace", async () => {
    const releasedDevServers: string[] = [];
    const stopped: string[] = [];
    const inspector = createInspector({
      onReleaseDevServers: (repoPath) => releasedDevServers.push(repoPath),
      runtimes: [runtime("runtime-1"), runtime("runtime-2")],
      onStopRuntime: (runtimeId) => stopped.push(runtimeId),
    });

    await Effect.runPromise(inspector.releaseWorkspaceRuntimes("/repo"));

    expect(releasedDevServers).toEqual(["/repo"]);
    expect(stopped).toEqual(["runtime-1", "runtime-2"]);
  });

  test("fails with the runtime id when a runtime stop fails", async () => {
    const inspector = createInspector({
      runtimes: [runtime("runtime-1")],
      stopRuntimeError: new HostOperationError({
        operation: "test.stopRuntime",
        message: "runtime is stuck",
      }),
    });

    const error = await Effect.runPromise(Effect.flip(inspector.releaseWorkspaceRuntimes("/repo")));

    expect(error.message).toContain("runtime-1");
    expect(error.message).toContain("/repo");
    expect(error.message).toContain("Retry removal");
  });
});
