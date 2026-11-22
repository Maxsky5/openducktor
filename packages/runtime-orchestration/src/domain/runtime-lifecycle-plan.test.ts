import { describe, expect, test } from "bun:test";
import type { AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { groupSessionsByWorkspace } from "./runtime-lifecycle-plan";

const snapshot = (
  externalSessionId: string,
  overrides: Partial<AgentSessionLiveSnapshot> = {},
): AgentSessionLiveSnapshot => ({
  ref: {
    repoPath: "/repo",
    runtimeKind: "opencode",
    workingDirectory: "/repo",
    externalSessionId,
  },
  activity: "running",
  title: externalSessionId,
  startedAt: "2026-11-21T10:00:00.000Z",
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
  ...overrides,
});

describe("groupSessionsByWorkspace", () => {
  test("marks only a session that waits on background tasks", () => {
    const [group] = groupSessionsByWorkspace(
      [{ workspaceId: "w1", workspaceName: "Repo", repoPath: "/repo" }],
      [
        snapshot("replying", { foregroundTurnActive: true }),
        snapshot("waiting", {
          foregroundTurnActive: false,
          backgroundTasks: [
            { taskId: "shell-1", kind: "command", title: "bun run dev", stop: { allowed: true } },
          ],
        }),
      ],
    );

    expect(group?.sessions.map((session) => session.waitingOnBackground)).toEqual([
      undefined,
      true,
    ]);
  });
});
