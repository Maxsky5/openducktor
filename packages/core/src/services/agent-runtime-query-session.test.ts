import { expect, test } from "bun:test";
import type { AgentSessionLiveRef, AgentSessionScope } from "@openducktor/contracts";
import { assertAgentRuntimeQuerySession } from "./agent-runtime-query-session";

const ref: AgentSessionLiveRef = {
  repoPath: "/repo",
  runtimeKind: "opencode",
  workingDirectory: "/repo/task",
  externalSessionId: "session-1",
};
const scope: AgentSessionScope = { kind: "workflow", taskId: "task-1", role: "build" };

test("passive validation leaves unbound discovery unchanged", () => {
  const association = Object.freeze({ kind: "unbound" } as const);
  const retained = Object.freeze({ ...ref });
  for (const sessionScope of [undefined, { kind: "repository" } as const, scope]) {
    expect(() =>
      assertAgentRuntimeQuerySession({ ...ref, sessionScope }, retained, association),
    ).not.toThrow();
  }
  expect(association).toEqual({ kind: "unbound" });
  expect(retained).toEqual(ref);
});

for (const [field, value] of [
  ["repoPath", "/other-repo"],
  ["runtimeKind", "codex"],
  ["workingDirectory", "/repo/other-task"],
  ["externalSessionId", "other-session"],
] as const) {
  test(`rejects conflicting ${field} even when discovery is unbound`, () => {
    expect(() =>
      assertAgentRuntimeQuerySession(
        { ...ref, sessionScope: scope },
        { ...ref, [field]: value },
        { kind: "unbound" },
      ),
    ).toThrow(expect.objectContaining({ code: "scope_mismatch" }));
  });
}

test("retains and checks bound scope claims", () => {
  for (const association of [
    { kind: "repository" },
    { kind: "workflow", taskId: "task-2", role: "build" },
    { kind: "workflow", taskId: "task-1", role: "qa" },
  ] as const) {
    expect(() =>
      assertAgentRuntimeQuerySession({ ...ref, sessionScope: scope }, ref, association),
    ).toThrow(expect.objectContaining({ code: "scope_mismatch" }));
  }
  expect(() =>
    assertAgentRuntimeQuerySession({ ...ref, sessionScope: scope }, ref, scope),
  ).not.toThrow();
  expect(() => assertAgentRuntimeQuerySession(ref, ref, scope)).not.toThrow();
});
