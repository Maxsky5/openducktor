import "../../test-support/dom-environment";
import { describe, expect, test } from "bun:test";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  type AgentSessionGoalControlInput,
} from "@openducktor/contracts";
import { createActiveWorkspaceWrapper } from "../../test-support/active-workspace-wrapper";
import { enableReactActEnvironment } from "../../test-support/react-act-environment";
import { createHookHarness } from "../../test-support/react-hook-harness";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import { useAgentSessionGoalRow } from "./use-agent-session-goal-row";

enableReactActEnvironment();

const session = {
  externalSessionId: "session-1",
  runtimeKind: "codex" as const,
  workingDirectory: "/repo",
  sessionAssociation: { kind: "repository" as const, workspaceId: "workspace-a" },
  goal: { objective: "Ship the feature", status: "active" as const },
};

describe("useAgentSessionGoalRow", () => {
  test("runs a goal action and shows the runtime reason when it fails", async () => {
    const calls: AgentSessionGoalControlInput[] = [];
    const connection = createTestClientConnection({
      client: {
        agentSessionGoalControl: async (input: AgentSessionGoalControlInput) => {
          calls.push(input);
          throw new Error("goals feature is disabled");
        },
      },
    });
    const harness = createHookHarness(
      useAgentSessionGoalRow,
      { repoPath: "/repo", session, runtimeDescriptor: CODEX_RUNTIME_DESCRIPTOR },
      { wrapper: createActiveWorkspaceWrapper(connection) },
    );
    try {
      await harness.mount();
      expect(harness.getLatest()).toMatchObject({
        statusLabel: "Active",
        actions: ["pause", "clear"],
        pendingAction: null,
      });
      await harness.run(() => harness.getLatest()?.onAction("pause"));
      await harness.waitFor((state) => state?.error !== null);

      expect(calls).toEqual([
        {
          repoPath: "/repo",
          runtimeKind: "codex",
          workingDirectory: "/repo",
          externalSessionId: "session-1",
          sessionScope: { kind: "repository", workspaceId: "workspace-a" },
          action: "pause",
        },
      ]);
      expect(harness.getLatest()).toMatchObject({
        pendingAction: null,
        error: "goals feature is disabled",
        // The row keeps the reported goal until the runtime reports a change.
        statusLabel: "Active",
      });
    } finally {
      await harness.unmount();
    }
  });
});
