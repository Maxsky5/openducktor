import { describe, expect, test } from "bun:test";
import type { ActiveCodexTurn } from "./codex-app-server-shared";
import { CodexPendingInputState } from "./codex-pending-input-state";

const approvalRequest = (requestId: string) => ({
  requestId,
  requestType: "permission_grant" as const,
  title: "Approve read",
});

const questionRequest = (requestId: string) => ({
  requestId,
  questions: [{ header: "Confirm", question: "Proceed?", options: [] }],
});

describe("CodexPendingInputState", () => {
  test("indexes pending approvals and questions by owning session", () => {
    const pendingInput = new CodexPendingInputState();

    pendingInput.addApproval({
      runtimeId: "runtime-1",
      threadId: "thread-1",
      request: approvalRequest("approval-1"),
    });
    pendingInput.addQuestion({
      runtimeId: "runtime-1",
      threadId: "thread-1",
      request: questionRequest("question-1"),
      questionIds: ["question-item-1"],
      input: { requestId: "question-1" },
    });

    expect(pendingInput.pendingApprovalsForSession("thread-1")).toEqual([
      approvalRequest("approval-1"),
    ]);
    expect(pendingInput.pendingQuestionsForSession("thread-1")).toEqual([
      questionRequest("question-1"),
    ]);
    expect(pendingInput.pendingApprovalsForSession("thread-2")).toEqual([]);
    expect(pendingInput.pendingQuestionsForSession("thread-2")).toEqual([]);
  });

  test("resolves one request without clearing unrelated pending input", () => {
    const pendingInput = new CodexPendingInputState();
    pendingInput.addApproval({
      runtimeId: "runtime-1",
      threadId: "thread-1",
      request: approvalRequest("approval-1"),
    });
    pendingInput.addApproval({
      runtimeId: "runtime-1",
      threadId: "thread-2",
      request: approvalRequest("approval-2"),
    });

    pendingInput.resolveApproval("approval-1");

    expect(pendingInput.approval("approval-1")).toBeUndefined();
    expect(pendingInput.pendingApprovalsForSession("thread-1")).toEqual([]);
    expect(pendingInput.pendingApprovalsForSession("thread-2")).toEqual([
      approvalRequest("approval-2"),
    ]);
  });

  test("requires pending requests to belong to the replying session", () => {
    const pendingInput = new CodexPendingInputState();
    pendingInput.addApproval({
      runtimeId: "runtime-1",
      threadId: "thread-1",
      request: approvalRequest("approval-1"),
    });
    pendingInput.addQuestion({
      runtimeId: "runtime-1",
      threadId: "thread-1",
      request: questionRequest("question-1"),
      questionIds: ["question-item-1"],
      input: { requestId: "question-1" },
    });

    expect(pendingInput.requireApprovalForSession("approval-1", "thread-1")).toMatchObject({
      threadId: "thread-1",
    });
    expect(pendingInput.requireQuestionForSession("question-1", "thread-1")).toMatchObject({
      threadId: "thread-1",
    });
    expect(() => pendingInput.requireApprovalForSession("approval-1", "thread-2")).toThrow(
      "belongs to session 'thread-1', not 'thread-2'",
    );
    expect(() => pendingInput.requireQuestionForSession("question-1", "thread-2")).toThrow(
      "belongs to session 'thread-1', not 'thread-2'",
    );
  });

  test("mirrors child pending input to the parent while preserving reply ownership", () => {
    const pendingInput = new CodexPendingInputState();
    const route = {
      parentExternalSessionId: "parent-thread",
      childExternalSessionId: "child-thread",
      subagentCorrelationKey: "codex-subagent:parent-thread:child-thread",
    };
    pendingInput.addApproval({
      runtimeId: "runtime-1",
      threadId: "child-thread",
      request: approvalRequest("approval-1"),
      route,
    });
    pendingInput.addQuestion({
      runtimeId: "runtime-1",
      threadId: "child-thread",
      request: questionRequest("question-1"),
      questionIds: ["question-item-1"],
      input: { requestId: "question-1" },
      route,
    });

    expect(pendingInput.pendingApprovalsForSession("parent-thread")).toEqual([]);
    expect(pendingInput.pendingQuestionsForSession("parent-thread")).toEqual([]);
    expect(pendingInput.pendingApprovalEventsForSession("parent-thread")).toEqual([
      { request: approvalRequest("approval-1"), route },
    ]);
    expect(pendingInput.pendingQuestionEventsForSession("parent-thread")).toEqual([
      { request: questionRequest("question-1"), route },
    ]);
    expect(pendingInput.requireApprovalForSession("approval-1", "parent-thread")).toMatchObject({
      threadId: "child-thread",
    });
    expect(pendingInput.requireQuestionForSession("question-1", "parent-thread")).toMatchObject({
      threadId: "child-thread",
    });
    expect(pendingInput.requireApprovalForSession("approval-1", "child-thread")).toMatchObject({
      threadId: "child-thread",
    });

    pendingInput.resolveApproval("approval-1");
    pendingInput.resolveQuestion("question-1");

    expect(pendingInput.pendingApprovalEventsForSession("parent-thread")).toEqual([]);
    expect(pendingInput.pendingQuestionEventsForSession("parent-thread")).toEqual([]);
  });

  test("adds a learned child route to existing owner-scoped pending input", () => {
    const pendingInput = new CodexPendingInputState();
    const route = {
      parentExternalSessionId: "parent-thread",
      childExternalSessionId: "child-thread",
      subagentCorrelationKey: "codex-subagent:parent-thread:child-thread",
    };
    pendingInput.addApproval({
      runtimeId: "runtime-1",
      threadId: "child-thread",
      request: approvalRequest("approval-1"),
    });
    pendingInput.addQuestion({
      runtimeId: "runtime-1",
      threadId: "child-thread",
      request: questionRequest("question-1"),
      questionIds: ["question-item-1"],
      input: { requestId: "question-1" },
    });

    expect(pendingInput.pendingApprovalEventsForSession("parent-thread")).toEqual([]);
    expect(pendingInput.pendingQuestionEventsForSession("parent-thread")).toEqual([]);

    expect(pendingInput.applyRouteToPendingInput(route)).toEqual({
      approvals: [expect.objectContaining({ request: approvalRequest("approval-1"), route })],
      questions: [expect.objectContaining({ request: questionRequest("question-1"), route })],
    });

    expect(pendingInput.approval("approval-1")).toMatchObject({ route });
    expect(pendingInput.question("question-1")).toMatchObject({ route });
    expect(pendingInput.pendingApprovalEventsForSession("parent-thread")).toEqual([
      { request: approvalRequest("approval-1"), route },
    ]);
    expect(pendingInput.pendingQuestionEventsForSession("parent-thread")).toEqual([
      { request: questionRequest("question-1"), route },
    ]);
  });

  test("does not bind parent active turns to mirrored child pending input", () => {
    const pendingInput = new CodexPendingInputState();
    const route = {
      parentExternalSessionId: "parent-thread",
      childExternalSessionId: "child-thread",
      subagentCorrelationKey: "codex-subagent:parent-thread:child-thread",
    };
    const activeTurn = {
      session: { threadId: "parent-thread" },
    } as unknown as ActiveCodexTurn;

    pendingInput.addQuestion({
      runtimeId: "runtime-1",
      threadId: "child-thread",
      request: questionRequest("question-1"),
      questionIds: ["question-item-1"],
      input: { requestId: "question-1" },
      route,
    });

    pendingInput.bindActiveTurn("parent-thread", activeTurn);

    expect(pendingInput.resolveQuestion("question-1")).toBeUndefined();
  });

  test("clearing a parent mirror preserves child pending input turn ownership", () => {
    const pendingInput = new CodexPendingInputState();
    const route = {
      parentExternalSessionId: "parent-thread",
      childExternalSessionId: "child-thread",
      subagentCorrelationKey: "codex-subagent:parent-thread:child-thread",
    };
    const activeTurn = {
      session: { threadId: "child-thread" },
    } as unknown as ActiveCodexTurn;

    pendingInput.addQuestion({
      runtimeId: "runtime-1",
      threadId: "child-thread",
      request: questionRequest("question-1"),
      questionIds: ["question-item-1"],
      input: { requestId: "question-1" },
      route,
    });

    pendingInput.bindActiveTurn("child-thread", activeTurn);
    pendingInput.clearSession("parent-thread");

    expect(pendingInput.resolveQuestion("question-1")).toBe(activeTurn);
  });

  test("clears all pending input for one session only", () => {
    const pendingInput = new CodexPendingInputState();
    pendingInput.addApproval({
      runtimeId: "runtime-1",
      threadId: "thread-1",
      request: approvalRequest("approval-1"),
    });
    pendingInput.addQuestion({
      runtimeId: "runtime-1",
      threadId: "thread-1",
      request: questionRequest("question-1"),
      questionIds: ["question-item-1"],
      input: { requestId: "question-1" },
    });
    pendingInput.addApproval({
      runtimeId: "runtime-1",
      threadId: "thread-2",
      request: approvalRequest("approval-2"),
    });

    pendingInput.clearSession("thread-1");

    expect(pendingInput.pendingApprovalsForSession("thread-1")).toEqual([]);
    expect(pendingInput.pendingQuestionsForSession("thread-1")).toEqual([]);
    expect(pendingInput.pendingApprovalsForSession("thread-2")).toEqual([
      approvalRequest("approval-2"),
    ]);
  });
});
