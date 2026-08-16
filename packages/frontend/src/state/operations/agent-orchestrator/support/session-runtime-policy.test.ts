import { describe, expect, test } from "bun:test";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import {
  resolveAgentSessionRuntimePolicyFromSnapshot,
  resolveRuntimeSessionContextRef,
} from "./session-runtime-policy";

describe("session runtime policy", () => {
  test("uses the Codex default policy for repository scope", () => {
    const defaults = createSettingsSnapshotFixture();
    const snapshot = createSettingsSnapshotFixture({
      agentRuntimes: {
        ...defaults.agentRuntimes,
        codex: {
          ...defaults.agentRuntimes.codex,
          enabled: true,
          defaults: {
            sandboxMode: "workspace-write",
            approvalPolicy: "on-request",
            approvalsReviewer: "auto_review",
            commandNetworkAccess: true,
          },
          roleOverrides: {
            build: { sandboxMode: "danger-full-access" },
          },
        },
      },
    });

    expect(
      resolveAgentSessionRuntimePolicyFromSnapshot({
        runtimeKind: "codex",
        sessionScope: { kind: "repository" },
        snapshot,
      }),
    ).toEqual({
      kind: "codex",
      policy: {
        sandboxMode: "workspace-write",
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        approvalsReviewerApplies: true,
        commandNetworkAccess: true,
      },
    });
  });

  test("does not infer repository scope for an unbound session", async () => {
    const ref = await resolveRuntimeSessionContextRef(
      "/repo",
      {
        identity: {
          externalSessionId: "unbound-session",
          runtimeKind: "opencode",
          workingDirectory: "/repo",
        },
        sessionAssociation: { kind: "unbound" },
        selectedModel: null,
      },
      async () => createSettingsSnapshotFixture(),
    );

    expect(ref).not.toHaveProperty("sessionScope");
  });

  test("forwards repository scope from the session association", async () => {
    const ref = await resolveRuntimeSessionContextRef(
      "/repo",
      {
        identity: {
          externalSessionId: "repository-session",
          runtimeKind: "opencode",
          workingDirectory: "/repo",
        },
        sessionAssociation: { kind: "repository" },
        selectedModel: null,
      },
      async () => createSettingsSnapshotFixture(),
    );

    expect(ref.sessionScope).toEqual({ kind: "repository" });
  });

  test("forwards workflow scope from the session association", async () => {
    const ref = await resolveRuntimeSessionContextRef(
      "/repo",
      {
        identity: {
          externalSessionId: "workflow-session",
          runtimeKind: "opencode",
          workingDirectory: "/repo",
        },
        sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
        selectedModel: null,
      },
      async () => createSettingsSnapshotFixture(),
    );

    expect(ref.sessionScope).toEqual({ kind: "workflow", taskId: "task-1", role: "build" });
  });
});
