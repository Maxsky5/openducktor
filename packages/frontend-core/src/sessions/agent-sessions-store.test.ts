import { describe, expect, test } from "bun:test";
import { createAgentSessionFixture } from "../test-support/shared-test-fixtures";
import { createAgentSessionsStore } from "./agent-sessions-store";

const sessionWithApproval = (externalSessionId: string) =>
  createAgentSessionFixture({
    externalSessionId,
    pendingApprovals: [
      {
        requestId: `${externalSessionId}-approval`,
        requestType: "runtime_tool",
        title: "Allow tool",
      },
    ],
  });

const identityOf = (session: ReturnType<typeof createAgentSessionFixture>) => ({
  externalSessionId: session.externalSessionId,
  runtimeKind: session.runtimeKind,
  workingDirectory: session.workingDirectory,
});

describe("agent sessions store visible pending input", () => {
  test("keeps one stable snapshot for each session while views of two sessions read in turn", () => {
    const store = createAgentSessionsStore("/repo");
    const first = sessionWithApproval("first");
    const second = sessionWithApproval("second");
    store.replaceSession(first);
    store.replaceSession(second);

    const firstSnapshot = store.getVisiblePendingInputSnapshot(identityOf(first));
    const secondSnapshot = store.getVisiblePendingInputSnapshot(identityOf(second));

    expect(store.getVisiblePendingInputSnapshot(identityOf(first))).toBe(firstSnapshot);
    expect(store.getVisiblePendingInputSnapshot(identityOf(second))).toBe(secondSnapshot);
    expect(firstSnapshot.pendingApprovals.map((request) => request.requestId)).toEqual([
      "first-approval",
    ]);
  });

  test("reads the pending input again after the session collection changes", () => {
    const store = createAgentSessionsStore("/repo");
    const session = sessionWithApproval("first");
    store.replaceSession(session);
    const before = store.getVisiblePendingInputSnapshot(identityOf(session));

    store.replaceSession({ ...session, pendingApprovals: [] });

    const after = store.getVisiblePendingInputSnapshot(identityOf(session));
    expect(after).not.toBe(before);
    expect(after.pendingApprovals).toEqual([]);
  });
});
