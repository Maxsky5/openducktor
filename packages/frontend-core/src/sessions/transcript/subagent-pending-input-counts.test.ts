import { describe, expect, test } from "bun:test";
import { agentSessionIdentityKey } from "../../lib/agent-session-identity";
import type { AgentSessionPendingInputSummary } from "../agent-session-snapshots";
import type { AgentQuestionRequest } from "../../types/agent-orchestrator";
import { countSubagentPendingInput } from "./subagent-pending-input-counts";

const parent = {
  externalSessionId: "parent",
  runtimeKind: "opencode",
  workingDirectory: "/repo",
} as const;
const child = { ...parent, externalSessionId: "child-1" } as const;
const childKey = agentSessionIdentityKey(child);

const summary = (pendingQuestionCount: number): AgentSessionPendingInputSummary => ({
  ...child,
  pendingApprovalCount: 0,
  pendingQuestionCount,
});

const mirrored = (requestId: string): AgentQuestionRequest => ({
  requestId,
  questions: [],
  source: {
    kind: "subagent",
    parentExternalSessionId: "parent",
    childExternalSessionId: "child-1",
  },
});

const countQuestions = (
  sessions: AgentSessionPendingInputSummary[],
  requests: AgentQuestionRequest[],
) =>
  countSubagentPendingInput(sessions, (session) => session.pendingQuestionCount, parent, requests);

describe("countSubagentPendingInput", () => {
  test("counts the pending input that a child session reports without a parent mirror", () => {
    expect(countQuestions([summary(2)], [])).toEqual({ [childKey]: 2 });
  });

  test("counts the requests that the parent mirrors for a Subagent session", () => {
    expect(countQuestions([], [mirrored("q-1"), { requestId: "q-2", questions: [] }])).toEqual({
      [childKey]: 1,
    });
  });

  test("keeps the larger count when the parent mirrors the child requests", () => {
    expect(countQuestions([summary(1)], [mirrored("q-1"), mirrored("q-2")])).toEqual({
      [childKey]: 2,
    });
    expect(countQuestions([summary(3)], [mirrored("q-1")])).toEqual({ [childKey]: 3 });
  });
});
