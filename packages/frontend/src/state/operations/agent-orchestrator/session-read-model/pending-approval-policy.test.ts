import { describe, expect, test } from "bun:test";
import {
  createAgentSessionCollection,
  emptyAgentSessionCollection,
} from "@/state/agent-session-collection";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import { collectPendingApprovalPolicyActions } from "./pending-approval-policy";

describe("pending approval policy", () => {
  test("rejects a new mutating request for a read-only workflow role", () => {
    const next = createAgentSessionCollection([
      createAgentSessionFixture({
        pendingApprovals: [
          {
            requestId: "mutating-request",
            requestType: "command_execution",
            title: "Run command",
            mutation: "mutating",
          },
        ],
      }),
    ]);

    expect(
      collectPendingApprovalPolicyActions({
        previous: emptyAgentSessionCollection(),
        next,
        repoPath: "/repo",
      }),
    ).toEqual([
      {
        role: "spec",
        input: {
          repoPath: "/repo",
          runtimeKind: "opencode",
          workingDirectory: "/tmp/repo/worktree",
          externalSessionId: "external-1",
          requestId: "mutating-request",
          outcome: "reject",
        },
      },
    ]);
  });

  test("leaves an unknown request pending for human review", () => {
    const session = createAgentSessionFixture({
      pendingApprovals: [
        {
          requestId: "unknown-request",
          requestType: "command_execution",
          title: "Run command",
          mutation: "unknown",
        },
      ],
    });
    const next = createAgentSessionCollection([session]);

    expect(
      collectPendingApprovalPolicyActions({
        previous: emptyAgentSessionCollection(),
        next,
        repoPath: "/repo",
      }),
    ).toEqual([]);
    expect(session.pendingApprovals).toHaveLength(1);
  });
});
