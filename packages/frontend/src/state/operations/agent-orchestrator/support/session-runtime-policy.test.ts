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

  test("keeps explicit repository scope on restored session refs", async () => {
    const snapshot = createSettingsSnapshotFixture();
    const ref = await resolveRuntimeSessionContextRef(
      "/repo",
      {
        externalSessionId: "repository-session",
        runtimeKind: "codex",
        workingDirectory: "/repo",
        sessionScope: { kind: "repository" },
      },
      async () => snapshot,
    );

    expect(ref.sessionScope).toEqual({ kind: "repository" });
    expect(ref.runtimePolicy).toEqual({
      kind: "codex",
      policy: expect.objectContaining({
        sandboxMode: snapshot.agentRuntimes.codex.defaults.sandboxMode,
      }),
    });
  });

  test("does not infer repository scope from missing workflow metadata", async () => {
    const ref = await resolveRuntimeSessionContextRef(
      "/repo",
      {
        externalSessionId: "unbound-session",
        runtimeKind: "opencode",
        workingDirectory: "/repo",
        sessionScope: null,
      },
      async () => createSettingsSnapshotFixture(),
    );

    expect(ref).not.toHaveProperty("sessionScope");
  });
});
