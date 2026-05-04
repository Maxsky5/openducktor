import { describe, expect, test } from "bun:test";
import {
  classifyLiveAgentSessionSnapshot,
  toLiveAgentSessionRuntimeStatus,
} from "./live-session-classification";

describe("live-session-classification", () => {
  test("classifies pending questions before approvals and runtime status", () => {
    const classification = classifyLiveAgentSessionSnapshot({
      status: { type: "busy" },
      pendingApprovals: [{ requestId: "approval-1" }],
      pendingQuestions: [{ requestId: "question-1" }],
    });

    expect(classification).toBe("waiting_for_question");
    expect(toLiveAgentSessionRuntimeStatus(classification)).toBe("idle");
  });

  test("classifies pending approvals before runtime status", () => {
    const classification = classifyLiveAgentSessionSnapshot({
      status: { type: "busy" },
      pendingApprovals: [{ requestId: "approval-1" }],
      pendingQuestions: [],
    });

    expect(classification).toBe("waiting_for_permission");
    expect(toLiveAgentSessionRuntimeStatus(classification)).toBe("idle");
  });

  test("classifies retry as retrying and runtime-running", () => {
    const classification = classifyLiveAgentSessionSnapshot({
      status: { type: "retry", attempt: 2, message: "try again", nextEpochMs: 1234 },
      pendingApprovals: [],
      pendingQuestions: [],
    });

    expect(classification).toBe("retrying");
    expect(toLiveAgentSessionRuntimeStatus(classification)).toBe("running");
  });

  test("classifies busy as running", () => {
    const classification = classifyLiveAgentSessionSnapshot({
      status: { type: "busy" },
      pendingApprovals: [],
      pendingQuestions: [],
    });

    expect(classification).toBe("running");
    expect(toLiveAgentSessionRuntimeStatus(classification)).toBe("running");
  });

  test("classifies idle without pending input as idle", () => {
    const classification = classifyLiveAgentSessionSnapshot({
      status: { type: "idle" },
      pendingApprovals: [],
      pendingQuestions: [],
    });

    expect(classification).toBe("idle");
    expect(toLiveAgentSessionRuntimeStatus(classification)).toBe("idle");
  });
});
