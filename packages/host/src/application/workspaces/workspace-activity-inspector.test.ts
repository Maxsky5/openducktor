import {
  agentSessionLiveSnapshotSchema,
  type AgentSessionLiveSnapshot,
} from "@openducktor/contracts";
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
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

const createInspector = ({
  sessions = [],
  onRelease,
}: {
  sessions?: AgentSessionLiveSnapshot[];
  onRelease?: (externalSessionId: string) => void;
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
});
